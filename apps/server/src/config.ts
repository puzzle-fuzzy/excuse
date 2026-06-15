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
  /**
   * Worker health/metrics 服务地址（如 `http://localhost:5100`）。
   * admin 后台「Provider」tab 据此 fetch worker `/provider-calls` 快照，
   * 与 server 进程内 metrics 合并得到跨进程 p50/p95（canvas 全链路在 worker 执行）。
   * 未配置（undefined）时 admin latency 仅反映 server 进程内调用。
   */
  workerMetricsUrl?: string
  /** 允许访问内部管理后台的用户 ID 列表；未配置时后台接口默认拒绝 */
  adminUserIds?: string[]
}

const DEFAULT_JWT_SECRET = 'dev-secret-change-in-production'

function isPublicMetricsCidrs(cidrs: string[]): boolean {
  return cidrs.some(cidr => cidr === '0.0.0.0/0' || cidr === '::/0' || cidr === '*')
}

export function validateProductionConfig(config: ServerConfig, env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production')
    return

  const errors: string[] = []
  if (!env.DATABASE_URL)
    errors.push('DATABASE_URL is required')
  if (!config.dashscopeApiKey)
    errors.push('DASHSCOPE_API_KEY is required')
  if (!env.FRONTEND_URL)
    errors.push('FRONTEND_URL is required')
  if (!env.JWT_SECRET)
    errors.push('JWT_SECRET is required')
  else if (config.jwtSecret === DEFAULT_JWT_SECRET)
    errors.push('JWT_SECRET must not use the development default')
  else if (config.jwtSecret.length < 32)
    errors.push('JWT_SECRET must be at least 32 characters')
  if (isPublicMetricsCidrs(config.metricsAllowedCidrs) && !config.metricsAccessToken)
    errors.push('METRICS_ACCESS_TOKEN is required when METRICS_ALLOWED_CIDRS exposes public networks')

  if (errors.length > 0)
    throw new Error(`Invalid production configuration: ${errors.join(', ')}`)
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
    jwtSecret: process.env.JWT_SECRET || DEFAULT_JWT_SECRET,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
    oss: loadOSSConfig(),
    metricsAccessToken: process.env.METRICS_ACCESS_TOKEN || undefined,
    metricsAllowedCidrs: (process.env.METRICS_ALLOWED_CIDRS || '127.0.0.1/32,::1/128')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
    workerMetricsUrl: process.env.WORKER_METRICS_URL || undefined,
    adminUserIds: (process.env.ADMIN_USER_IDS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
  }

  validateProductionConfig(config)

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
