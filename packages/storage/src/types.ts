/** 阿里云 OSS 配置 */
export interface OSSConfig {
  accessKeyId: string
  accessKeySecret: string
  bucket: string
  region: string
  endpoint?: string
  /** OSS key 前缀 — user upload（如 "uploads"） */
  uploadPrefix?: string
  /** OSS key 前缀 — generated output（如 "generated"） */
  generatedPrefix?: string
}

/** 存储引擎配置 — 本地文件系统 ± OSS */
export interface StorageConfig {
  /** 本地存储根目录 */
  storageRoot: string
  /** 本地文件的公开 URL 基路径（如 "/api/uploads"） */
  publicBasePath?: string
  /** OSS 配置（可选；配置后自动启用 OSS 同步 + 回落本地） */
  oss?: OSSConfig
}

/** 存储操作结果 — 文件写完后返回的元信息 */
export interface StoredObjectResult {
  /** 存储相对路径（含子目录） */
  storagePath: string
  /** 公开可访问 URL（OSS 或本地） */
  publicUrl: string
  /** 原始 URL（OSS 直达，仅 OSS 模式有） */
  providerUrl?: string
  /** 文件 MIME 类型 */
  mimeType?: string
  /** 文件大小（字节） */
  sizeBytes?: number
  /** 文件校验值（如 MD5） */
  checksum?: string
}
