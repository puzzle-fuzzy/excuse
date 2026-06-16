import type { UploadedFilePatch } from '@excuse/db'
import type { MutationOkResponse, UploadedFileDTO, UploadResponse } from '@excuse/shared'
import type { ServerConfig } from '../config'
import { createUploadedFile, deleteUploadedFileById, getUploadedFileById, getUploadedFileUsage, updateUploadedFile } from '@excuse/db'
import { AssetStorage } from '@excuse/provider'
import { SlidingWindowRateLimiter } from '@excuse/rate-limit'
import { createLogger } from '@excuse/shared'
import { Elysia, t } from 'elysia'
import { createRequireAuthPlugin } from '../plugins/auth'
import { audit } from '../services/audit'
import { ConflictError, ForbiddenError, NotFoundError, RateLimitError, ValidationError } from '../utils/app-errors'

const logger = createLogger('upload')

const ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  // 字幕功能支持的视频格式
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
]
const MAX_FILE_SIZE = 200 * 1024 * 1024 // 200MB（视频文件更大）

// 单用户上传频次限制：每分钟最多 10 次
const UPLOAD_RATE_LIMITER = new SlidingWindowRateLimiter()
const UPLOAD_RATE_LIMIT = { maxRequests: 10, windowMs: 60_000 }

/**
 * 通过文件头 magic bytes 校验真实 MIME 类型
 * 返回探测到的 MIME type 字符串，无法识别返回 null
 */
function detectMimeType(buffer: Uint8Array): string | null {
  const len = buffer.length
  if (len < 4)
    return null

  const head = Array.from(buffer.slice(0, Math.min(len, 16)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join(' ')

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (head.startsWith('89 50 4e 47 0d 0a 1a 0a'))
    return 'image/png'
  // JPEG: FF D8 FF
  if (head.startsWith('ff d8 ff'))
    return 'image/jpeg'
  // GIF87a: 47 49 46 38 37 61
  if (head.startsWith('47 49 46 38 37 61'))
    return 'image/gif'
  // GIF89a: 47 49 46 38 39 61
  if (head.startsWith('47 49 46 38 39 61'))
    return 'image/gif'
  // WebP: RIFF....WEBP (52 49 46 46 xx xx xx xx 57 45 42 50)
  if (head.startsWith('52 49 46 46') && len >= 12) {
    const webpTag = Array.from(buffer.slice(8, 12)).map(b => String.fromCharCode(b)).join('')
    if (webpTag === 'WEBP')
      return 'image/webp'
  }
  // WebM/Matroska: 1A 45 DF A3 (EBML)
  if (head.startsWith('1a 45 df a3'))
    return 'video/webm'
  // AVI: RIFF....AVI (52 49 46 46 xx xx xx xx 41 56 49 20)
  if (head.startsWith('52 49 46 46') && len >= 12) {
    const aviTag = Array.from(buffer.slice(8, 12)).map(b => String.fromCharCode(b)).join('')
    if (aviTag === 'AVI ')
      return 'video/x-msvideo'
  }
  // MP4/MOV/QuickTime: ftyp box (xx xx xx xx 66 74 79 70)
  if (head.includes('66 74 79 70')) {
    const ftypBrand = len >= 12
      ? Array.from(buffer.slice(8, 12)).map(b => String.fromCharCode(b)).join('')
      : ''
    // QuickTime: ftypqt 或 ftypisom
    if (ftypBrand === 'qt  ' || head.includes('71 74 20 20'))
      return 'video/quicktime'
    // MP4: ftypisom, ftypmp42, ftypavc1, etc.
    return 'video/mp4'
  }

  return null
}

/**
 * DB row → DTO 序列化（Date → string）
 *
 * 上传文件 DTO 必须包含 createdAt 等 Date 字段的字符串序列化，
 * 与 GenerationRecord / AuthUser 保持一致的模式。
 */
function serializeUploadedFile(record: {
  id: string
  accountId: string
  fileName: string
  fileSize: number
  mimeType: string
  storagePath: string
  publicUrl: string
  purpose: string
  metadata: Record<string, unknown> | null
  createdAt: Date
}): UploadedFileDTO {
  return {
    ...record,
    createdAt: record.createdAt.toISOString(),
  }
}

export function createUploadRoutes(config: ServerConfig) {
  const storage = new AssetStorage({
    storageRoot: config.storageRoot,
    oss: config.oss,
  })

  return new Elysia({ prefix: '/api' })
    .use(createRequireAuthPlugin(config))
    // 文件上传
    .post('/upload', async ({ body, userId }) => {
      const file = body.file
      if (!file) {
        throw new ValidationError('No file provided')
      }

      if (!ALLOWED_MIME_TYPES.includes(file.type)) {
        throw new ValidationError(`不支持的文件类型: ${file.type}，仅允许 PNG/JPEG/WebP/GIF/MP4/WebM/MOV/AVI`)
      }

      if (file.size > MAX_FILE_SIZE) {
        throw new ValidationError(`文件大小超过限制（最大 ${MAX_FILE_SIZE / 1024 / 1024}MB）`)
      }

      // Magic bytes 校验 —— 防止客户端伪造 MIME 声明
      const buffer = new Uint8Array(await file.arrayBuffer())
      const detectedType = detectMimeType(buffer)
      if (!detectedType) {
        throw new ValidationError('无法识别的文件类型，请检查文件内容')
      }

      // 客户端声明的 MIME 与 magic bytes 不符：拒绝上传
      // 但兼容 "video/quicktime" ↔ "video/mp4" 间的视频格式模糊匹配
      const clientType = file.type
      if (clientType !== detectedType) {
        // 放宽：客户端声明 video/quicktime 但实际是 MP4 容器视为允许
        const isVideoRelaxed = clientType.startsWith('video/') && detectedType.startsWith('video/')
        if (!isVideoRelaxed) {
          throw new ValidationError(`文件类型不匹配：声明 ${clientType}，实际 ${detectedType}`)
        }
      }

      // 单用户上传频次限制（per-account 维度，与全局限流分开）
      const rateCheck = UPLOAD_RATE_LIMITER.check({ userId, category: 'upload', maxRequests: UPLOAD_RATE_LIMIT.maxRequests, windowMs: UPLOAD_RATE_LIMIT.windowMs })
      if (!rateCheck.allowed) {
        throw new RateLimitError('上传过于频繁，请稍后再试', rateCheck.retryAfterSec)
      }

      const subDir = `ref_${Date.now()}`
      const { storagePath, publicUrl } = await storage.saveUploadedFile(new File([buffer], file.name, { type: detectedType }), subDir)

      const record = await createUploadedFile({
        accountId: userId,
        fileName: file.name,
        fileSize: file.size,
        mimeType: detectedType, // 用探测值而非客户端声明
        storagePath,
        publicUrl,
        purpose: 'reference',
      })

      return {
        success: true,
        data: serializeUploadedFile(record),
      } satisfies UploadResponse
    }, {
      body: t.Object({
        file: t.File({ description: '上传的文件' }),
      }),
      detail: {
        summary: '上传文件',
        description: '上传图片或视频文件（PNG/JPEG/WebP/GIF/MP4/WebM/MOV/AVI，最大 200MB），保存到存储并创建 DB 记录',
        tags: ['上传'],
        security: [{ bearerAuth: [] }],
      },
    })

    // 删除上传文件（安全语义：先检查使用 → 先删 DB → 后删存储）
    .delete('/upload/:id', async ({ params: { id }, userId }) => {
      const record = await getUploadedFileById(id)
      if (!record) {
        throw new NotFoundError('文件不存在')
      }
      if (record.accountId !== userId) {
        throw new ForbiddenError('无权删除该文件')
      }

      // 使用中保护：被字幕项目或生成记录引用时不允许删除
      const usage = await getUploadedFileUsage(userId, id)
      if (usage.subtitleProjectCount > 0 || usage.generationRecordCount > 0) {
        throw new ConflictError('该文件正在被字幕项目或生成记录使用，暂不能删除')
      }

      // 安全删除顺序：先删 DB 记录，再删存储文件
      // DB 删除成功后存储删除失败时只记录日志，不回滚 DB
      await deleteUploadedFileById(id)
      try {
        await storage.deleteFile(record.storagePath)
      }
      catch (err) {
        // 存储删除失败只记录日志，不回滚 DB 记录（DB 已删除）
        logger.error({ accountId: userId, targetId: id, storagePath: record.storagePath, err }, 'file delete: storage deletion failed after DB record removed')
      }

      audit('file_delete', { accountId: userId, targetId: id })

      return { success: true } satisfies MutationOkResponse
    }, {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        summary: '删除上传文件',
        description: '删除指定文件（需为文件所有者）。被字幕项目或生成记录使用的文件不能删除。先删除 DB 记录再删除存储文件。',
        tags: ['上传'],
        security: [{ bearerAuth: [] }],
      },
    })

    // 编辑上传文件（重命名/用途）
    .patch('/upload/:id', async ({ params: { id }, body, userId }) => {
      const record = await getUploadedFileById(id)
      if (!record) {
        throw new NotFoundError('文件不存在')
      }
      if (record.accountId !== userId) {
        throw new ForbiddenError('无权编辑该文件')
      }

      const patch: UploadedFilePatch = {}
      if (body.fileName !== undefined) {
        const trimmed = body.fileName.trim()
        if (!trimmed) {
          throw new ValidationError('文件名不能为空')
        }
        patch.fileName = trimmed
      }
      if (body.purpose !== undefined) {
        const trimmed = body.purpose.trim()
        if (!trimmed) {
          throw new ValidationError('用途不能为空')
        }
        patch.purpose = trimmed
      }

      const updated = await updateUploadedFile(id, userId, patch)
      if (!updated) {
        throw new NotFoundError('文件不存在')
      }

      audit('file_update', { accountId: userId, targetId: id })

      return {
        success: true,
        data: serializeUploadedFile(updated),
      } satisfies UploadResponse
    }, {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        fileName: t.Optional(t.String({ maxLength: 500 })),
        purpose: t.Optional(t.String({ maxLength: 50 })),
      }),
      detail: {
        summary: '编辑上传文件（重命名/用途）',
        description: '编辑指定上传文件的文件名或用途（需为文件所有者）。返回更新后的文件 DTO；空 patch 直接返回当前记录。',
        tags: ['上传'],
        security: [{ bearerAuth: [] }],
      },
    })
}
