/**
 * OSS 配置形状 — 与 @excuse/provider OSSConfig 结构兼容
 */
export interface OSSConfigShape {
  accessKeyId: string
  accessKeySecret: string
  bucket: string
  region: string
  endpoint?: string
  uploadPrefix?: string
  generatedPrefix?: string
}

/**
 * 加载阿里云 OSS 配置
 *
 * 四个必需变量（ACCESS_KEY_ID / SECRET / BUCKET / REGION）全部存在时才启用 OSS，
 * 否则返回 undefined，回退到本地磁盘存储。
 */
export function loadOSSConfig(env: NodeJS.ProcessEnv = process.env): OSSConfigShape | undefined {
  const accessKeyId = env.OSS_ACCESS_KEY_ID
  const accessKeySecret = env.OSS_ACCESS_KEY_SECRET
  const bucket = env.OSS_BUCKET
  const region = env.OSS_REGION

  if (!accessKeyId || !accessKeySecret || !bucket || !region) {
    return undefined
  }

  return {
    accessKeyId,
    accessKeySecret,
    bucket,
    region,
    endpoint: env.OSS_ENDPOINT || undefined,
    uploadPrefix: env.OSS_UPLOAD_PREFIX || 'uploads',
    generatedPrefix: env.OSS_GENERATED_PREFIX || 'generated',
  }
}

/**
 * 判断 CIDR 列表是否包含公网开放条目
 */
export function isPublicMetricsCidrs(cidrs: string[]): boolean {
  return cidrs.some(cidr => cidr === '0.0.0.0/0' || cidr === '::/0' || cidr === '*')
}
