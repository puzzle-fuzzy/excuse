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

  if (process.env.NODE_ENV === 'production') {
    const missing: string[] = []
    if (!process.env.DATABASE_URL)
      missing.push('DATABASE_URL')
    if (!config.dashscopeApiKey)
      missing.push('DASHSCOPE_API_KEY')

    if (missing.length > 0) {
      throw new Error(`Missing required environment variables in production: ${missing.join(', ')}`)
    }
  }

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
