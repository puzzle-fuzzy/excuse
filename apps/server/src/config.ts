import type { OSSConfig } from '@excuse/provider'

/**
 * 服务端全局配置类型
 *
 * 所有路由、模块通过 ServerConfig 获取运行时参数，
 * 而不是直接读取 process.env，便于测试注入和环境隔离。
 */
export interface ServerConfig {
  port: number
  databaseUrl: string
  dashscopeApiKey: string
  dashscopeBaseUrl: string
  storageRoot: string
  frontendUrl: string
  workerPollIntervalMs: number
  jwtSecret: string
  jwtExpiresIn: string
  oss: OSSConfig | undefined
  /** Prometheus `/metrics` 端点访问 token；未设置时仅允许回环地址访问 */
  metricsAccessToken?: string
  /** 允许访问 `/metrics` 的 IP CIDR 列表；默认 `['127.0.0.1/32', '::1/128']` */
  metricsAllowedCidrs: string[]
}

/**
 * 从环境变量加载并校验服务端配置
 *
 * - 开发环境使用内置默认值，无需 .env 即可启动
 * - 生产环境强制校验 DATABASE_URL / DASHSCOPE_API_KEY / JWT_SECRET
 * - OSS 配置可选，缺省时使用本地文件存储
 */
export function loadConfig(): ServerConfig {
  const config = {
    port: Number(process.env.PORT) || 5007,
    databaseUrl: process.env.DATABASE_URL || 'postgres://excuse:excuse_dev@localhost:5433/excuse',
    dashscopeApiKey: process.env.DASHSCOPE_API_KEY || '',
    dashscopeBaseUrl: process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/api/v1',
    storageRoot: process.env.STORAGE_ROOT || './uploads',
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:8007',
    workerPollIntervalMs: Number(process.env.WORKER_POLL_INTERVAL_MS) || 5000,
    jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
    oss: loadOSSConfig(),
    metricsAccessToken: process.env.METRICS_ACCESS_TOKEN || undefined,
    metricsAllowedCidrs: (process.env.METRICS_ALLOWED_CIDRS || '127.0.0.1/32,::1/128')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
  }

  if (process.env.NODE_ENV === 'production') {
    const missing: string[] = []
    if (!process.env.DATABASE_URL)
      missing.push('DATABASE_URL')
    if (!config.dashscopeApiKey)
      missing.push('DASHSCOPE_API_KEY')
    if (!process.env.JWT_SECRET || config.jwtSecret.length < 32)
      missing.push('JWT_SECRET (at least 32 characters)')

    if (missing.length > 0) {
      throw new Error(`Missing required environment variables in production: ${missing.join(', ')}`)
    }
  }

  return config
}

/**
 * 加载阿里云 OSS 配置
 *
 * 四个必需变量（ACCESS_KEY_ID / SECRET / BUCKET / REGION）全部存在时才启用 OSS，
 * 否则返回 undefined，回退到本地磁盘存储。
 */
function loadOSSConfig(): OSSConfig | undefined {
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET
  const bucket = process.env.OSS_BUCKET
  const region = process.env.OSS_REGION

  if (!accessKeyId || !accessKeySecret || !bucket || !region) {
    return undefined
  }

  return {
    accessKeyId,
    accessKeySecret,
    bucket,
    region,
    endpoint: process.env.OSS_ENDPOINT || undefined,
    uploadPrefix: process.env.OSS_UPLOAD_PREFIX || 'uploads',
    generatedPrefix: process.env.OSS_GENERATED_PREFIX || 'generated',
  }
}
