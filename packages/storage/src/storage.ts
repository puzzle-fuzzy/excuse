import type { StorageConfig } from './types'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { logger } from '@excuse/shared'
import OSS from 'ali-oss'

/**
 * 文件存储服务
 * - OSS 已配置：上传到阿里云 OSS，同时保留本地副本
 * - OSS 未配置：仅保存到本地目录
 */
export class AssetStorage {
  private config: StorageConfig
  private ossClient: OSS | null = null

  constructor(config: StorageConfig) {
    this.config = config
    if (config.oss) {
      this.initOSS(config.oss)
    }
  }

  // ── OSS 初始化 ────────────────────────────────────────

  private initOSS(oss: NonNullable<StorageConfig['oss']>) {
    this.ossClient = new OSS({
      accessKeyId: oss.accessKeyId,
      accessKeySecret: oss.accessKeySecret,
      bucket: oss.bucket,
      region: oss.region,
      endpoint: oss.endpoint || undefined,
    })
  }

  get isOSSEnabled(): boolean {
    return this.ossClient !== null
  }

  // ── 核心上传方法 ──────────────────────────────────────

  /**
   * 上传 buffer 到 OSS（generated 前缀）+ 本地副本
   * @returns OSS 公开 URL，OSS 不可用时返回本地路径
   */
  async uploadGenerated(buffer: Buffer, fileName: string, contentType?: string): Promise<string> {
    // 总是保存本地副本
    await this.saveLocal(buffer, fileName)

    if (!this.ossClient) {
      return this.getLocalPublicUrl(fileName)
    }

    const prefix = this.config.oss?.generatedPrefix || 'generated'
    const key = `${prefix}/${fileName}`

    try {
      await this.ossClient.put(key, buffer, {
        headers: contentType ? { 'Content-Type': contentType } : undefined,
      })
      return this.getOSSPublicUrl(key)
    }
    catch (err) {
      logger.warn({ err, key, prefix: 'generated' }, 'OSS upload failed, falling back to local')
      return this.getLocalPublicUrl(fileName)
    }
  }

  /**
   * 上传 buffer 到 OSS（upload 前缀）+ 本地副本
   * 用于用户主动上传的文件（参考图等）
   */
  async uploadUserFile(buffer: Buffer, fileName: string, contentType?: string): Promise<string> {
    await this.saveLocal(buffer, fileName)

    if (!this.ossClient) {
      return this.getLocalPublicUrl(fileName)
    }

    const prefix = this.config.oss?.uploadPrefix || 'uploads'
    const key = `${prefix}/${fileName}`

    try {
      await this.ossClient.put(key, buffer, {
        headers: contentType ? { 'Content-Type': contentType } : undefined,
      })
      return this.getOSSPublicUrl(key)
    }
    catch (err) {
      logger.warn({ err, key, prefix: 'upload' }, 'OSS upload failed, falling back to local')
      return this.getLocalPublicUrl(fileName)
    }
  }

  // ── 下载 + 上传一体化方法 ─────────────────────────────

  /**
   * 下载远程文件并上传到 OSS + 保存本地
   * @param url 远程 URL（DashScope 临时 URL，24h 过期）
   * @param fileName 最终文件名（含子目录）
   * @returns OSS 公开 URL 或本地路径
   */
  async downloadAndUpload(url: string, fileName: string): Promise<string> {
    const buffer = await this.downloadToBuffer(url)
    const ext = AssetStorage.getExtensionFromUrl(url)
    const contentType = AssetStorage.inferContentType(ext)
    return this.uploadGenerated(buffer, fileName, contentType)
  }

  /**
   * 批量下载远程 URL，上传到 OSS，返回公开 URL 列表
   *
   * 用于 DashScope 生成结果（图片/视频）的下载保存。
   * 单个 URL 下载失败时保留原始临时 URL 作为兜底。
   *
   * @param urls 远程文件 URL 数组
   * @param subDir 子目录（如 taskId）
   * @param prefix 文件名前缀（如 'img_0', 'video'）
   * @returns 公开访问 URL 数组
   */
  async downloadAndMap(urls: string[], subDir: string, prefix: string): Promise<string[]> {
    const result: string[] = []
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i]!
      try {
        const ext = AssetStorage.getExtensionFromUrl(url)
        const fileName = `${subDir}/${AssetStorage.generateFileName(`${prefix}_${i}`, ext)}`
        const publicUrl = await this.downloadAndUpload(url, fileName)
        result.push(publicUrl)
      }
      catch {
        result.push(url) // 下载失败则保留原 URL
      }
    }
    return result
  }

  // ── 保存上传的文件 ────────────────────────────────────

  async saveUploadedFile(file: File, subDir: string): Promise<{ storagePath: string, publicUrl: string }> {
    const ext = file.name.split('.').pop() || 'bin'
    const baseName = AssetStorage.generateFileName('upload', ext)
    const fileName = `${subDir}/${baseName}`
    const buffer = Buffer.from(await file.arrayBuffer())
    const contentType = file.type || AssetStorage.inferContentType(ext)

    const publicUrl = await this.uploadUserFile(buffer, fileName, contentType)

    return {
      storagePath: fileName,
      publicUrl,
    }
  }

  // ── URL 工具方法 ──────────────────────────────────────

  /**
   * 删除存储中的文件（本地 + OSS）
   */
  async deleteFile(storagePath: string): Promise<void> {
    // Delete local file
    const localPath = join(this.config.storageRoot, storagePath)
    try {
      await unlink(localPath)
    }
    catch (err) {
      // File may not exist locally if OSS-only, ignore ENOENT
      const code = (err as NodeJS.ErrnoException)?.code
      if (code !== 'ENOENT')
        logger.warn({ err, storagePath }, 'Failed to delete local file')
    }

    // Delete from OSS if enabled
    if (this.ossClient) {
      // Determine prefix based on which upload method was used.
      // uploadUserFile uses uploadPrefix, uploadGenerated uses generatedPrefix.
      // We try both to ensure we delete the correct key.
      const uploadPrefix = this.config.oss?.uploadPrefix || 'uploads'
      const generatedPrefix = this.config.oss?.generatedPrefix || 'generated'
      const keysToDelete = [
        `${uploadPrefix}/${storagePath}`,
        `${generatedPrefix}/${storagePath}`,
      ]
      for (const key of keysToDelete) {
        try {
          await this.ossClient.delete(key)
        }
        catch (err) {
          // Key may not exist under this prefix, log only non-404 errors
          const message = (err as Error)?.message || ''
          if (!message.includes('NoSuchKey'))
            logger.warn({ err, key }, 'Failed to delete OSS file')
        }
      }
    }
  }

  /**
   * 检查 URL 是否为 OSS URL
   */
  isOSSUrl(url: string): boolean {
    if (!this.config.oss)
      return false
    return url.includes(`${this.config.oss.bucket}.aliyuncs.com`)
  }

  /**
   * 解析存储 URL 到本地文件系统路径（storageRoot 下的本地副本）。
   *
   * uploadGenerated/uploadUserFile 总是经 saveLocal 写本地副本，故即使是 OSS 公开 URL，
   * 本地也存在同名副本。assemble 等需要在本地对已存储资产做 FFmpeg 处理的场景可据此
   * 直接拿到本地路径，避免重复下载。
   *
   * @returns 本地绝对路径；URL 无法解析为已存储资产时返回 null（调用方应回退 downloadToFile）
   */
  localCopyPath(url: string): string | null {
    const fileName = this.extractStorageFileName(url)
    if (!fileName)
      return null
    return join(this.config.storageRoot, fileName)
  }

  /**
   * 下载远程 URL 到本地文件路径。
   *
   * 用于 localCopyPath 无法解析（如纯 OSS 无本地副本、或第三方 URL）时的回退。
   * @returns destPath（写入后的本地路径）
   */
  async downloadToFile(url: string, destPath: string): Promise<string> {
    const buffer = await this.downloadToBuffer(url)
    await mkdir(dirname(destPath), { recursive: true })
    await writeFile(destPath, buffer)
    return destPath
  }

  /**
   * 从存储 URL 提取相对 fileName（去掉 public base / OSS host+prefix）。
   * 无法识别的 URL 返回 null。
   */
  private extractStorageFileName(url: string): string | null {
    // 本地 web 路径：<publicBasePath>/<fileName>
    const base = this.config.publicBasePath || '/api/uploads'
    if (url.startsWith(`${base}/`))
      return url.slice(base.length + 1)

    // OSS 公开 URL：https://<bucket>.<region>.aliyuncs.com/<prefix>/<fileName>
    if (this.config.oss && url.includes(`${this.config.oss.bucket}.aliyuncs.com`)) {
      const afterHost = url.replace(/^https?:\/\/[^/]+\//, '')
      const prefixes = [
        this.config.oss.generatedPrefix || 'generated',
        this.config.oss.uploadPrefix || 'uploads',
      ]
      for (const prefix of prefixes) {
        if (afterHost.startsWith(`${prefix}/`))
          return afterHost.slice(prefix.length + 1)
      }
      return afterHost
    }

    return null
  }

  // ── 私有辅助方法 ──────────────────────────────────────

  private async downloadToBuffer(url: string): Promise<Buffer> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60_000) // 60s timeout

    try {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) {
        throw new Error(`Failed to download: ${response.status} ${response.statusText}`)
      }

      // Check Content-Length if available
      const contentLength = response.headers.get('content-length')
      const MAX_DOWNLOAD_SIZE = 100 * 1024 * 1024 // 100MB
      if (contentLength && Number(contentLength) > MAX_DOWNLOAD_SIZE) {
        throw new Error(`Remote file too large: ${contentLength} bytes (max ${MAX_DOWNLOAD_SIZE})`)
      }

      const chunks: Uint8Array[] = []
      let totalSize = 0
      const reader = response.body?.getReader()
      if (!reader)
        throw new Error('No response body')

      for (;;) {
        const { done, value } = await reader.read()
        if (done)
          break
        totalSize += value.length
        if (totalSize > MAX_DOWNLOAD_SIZE) {
          reader.cancel()
          throw new Error(`Download exceeded ${MAX_DOWNLOAD_SIZE / 1024 / 1024}MB limit`)
        }
        chunks.push(value)
      }

      return Buffer.concat(chunks)
    }
    finally {
      clearTimeout(timeout)
    }
  }

  private async saveLocal(buffer: Buffer, fileName: string): Promise<void> {
    // Path traversal prevention: ensure resolved path stays within storageRoot
    const storageRoot = resolve(this.config.storageRoot)
    const safeFileName = fileName.replace(/\.\./g, '').replace(/\\/g, '')
    const fullPath = resolve(storageRoot, safeFileName)
    if (!fullPath.startsWith(storageRoot)) {
      throw new Error(`Path traversal detected: ${fileName}`)
    }
    const dir = dirname(fullPath)
    await mkdir(dir, { recursive: true })
    await writeFile(fullPath, buffer)
  }

  private getLocalPublicUrl(fileName: string): string {
    const base = this.config.publicBasePath || '/api/uploads'
    return `${base}/${fileName}`
  }

  private getOSSPublicUrl(key: string): string {
    const oss = this.config.oss!
    return `https://${oss.bucket}.${oss.region}.aliyuncs.com/${key}`
  }

  // ── 静态工具方法 ──────────────────────────────────────

  static getExtensionFromUrl(url: string): string {
    try {
      const pathname = new URL(url).pathname
      const ext = pathname.split('.').pop()?.toLowerCase()
      if (ext && ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'webm', 'mp3', 'wav'].includes(ext)) {
        return ext
      }
    }
    catch {}
    return 'bin'
  }

  static generateFileName(prefix: string, ext: string): string {
    const timestamp = Date.now()
    const random = Math.random().toString(36).slice(2, 8)
    return `${prefix}_${timestamp}_${random}.${ext}`
  }

  static inferContentType(ext: string): string | undefined {
    const map: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      mp4: 'video/mp4',
      webm: 'video/webm',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
    }
    return map[ext]
  }
}
