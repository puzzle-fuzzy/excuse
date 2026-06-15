import type { OSSConfig } from '@excuse/provider'

export interface WorkerConfig {
  /** DashScope API Key */
  dashscopeApiKey: string
  /** DashScope API Base URL */
  dashscopeBaseUrl: string
  /** 本地文件存储根目录 */
  storageRoot: string
  /** 轮询间隔（毫秒） */
  pollIntervalMs: number
  /** 任务超时时间（毫秒） */
  staleTimeoutMs: number
  /** Claim 锁定时长（毫秒） — Worker claim task 后的锁过期时间 */
  claimTtlMs: number
  /** Orphan sweep 间隔（毫秒） — 后台扫描过期 lock 的频率 */
  sweepIntervalMs: number
  /** OSS 配置（可选） */
  oss: OSSConfig | undefined
  /** /metrics 端点访问 token（可选）；配置后所有访问必须带 Bearer（与 server 一致） */
  metricsAccessToken: string | undefined
  /** /metrics 端点允许的 CIDR / IP 列表（默认仅回环） */
  metricsAllowedCidrs: string[]
}

function isPublicMetricsCidrs(cidrs: string[]): boolean {
  return cidrs.some(cidr => cidr === '0.0.0.0/0' || cidr === '::/0' || cidr === '*')
}

export function validateProductionConfig(config: WorkerConfig, env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production')
    return

  const errors: string[] = []
  if (!env.DATABASE_URL)
    errors.push('DATABASE_URL is required')
  if (!config.dashscopeApiKey)
    errors.push('DASHSCOPE_API_KEY is required')
  if (isPublicMetricsCidrs(config.metricsAllowedCidrs) && !config.metricsAccessToken)
    errors.push('METRICS_ACCESS_TOKEN is required when METRICS_ALLOWED_CIDRS exposes public networks')

  if (errors.length > 0)
    throw new Error(`Invalid production configuration: ${errors.join(', ')}`)
}

/**
 * 从环境变量读取并构建 Worker 配置
 */
export function loadConfig(): WorkerConfig {
  const claimTtlMs = Number(process.env.WORKER_CLAIM_TTL_MS) || 30_000
  const config = {
    dashscopeApiKey: process.env.DASHSCOPE_API_KEY || '',
    dashscopeBaseUrl: process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/api/v1',
    storageRoot: process.env.STORAGE_ROOT || './uploads',
    pollIntervalMs: Number(process.env.WORKER_POLL_INTERVAL_MS) || 5000,
    staleTimeoutMs: Number(process.env.WORKER_STALE_TIMEOUT_MS) || 4 * 60 * 60 * 1000, // 4h
    claimTtlMs,
    sweepIntervalMs: Number(process.env.WORKER_SWEEP_INTERVAL_MS) || 60_000,
    oss: loadOSSConfig(),
    metricsAccessToken: process.env.METRICS_ACCESS_TOKEN || undefined,
    metricsAllowedCidrs: (process.env.METRICS_ALLOWED_CIDRS || '127.0.0.1/32,::1/128').split(',').map(s => s.trim()).filter(Boolean),
  }

  validateProductionConfig(config)

  return config
}

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
