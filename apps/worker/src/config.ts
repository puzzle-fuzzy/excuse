import {
  parseMetricsConfig,
  parsePositiveIntEnv,
  parseProviderConfig,
  parseProviderTimeoutConfig,
  parseStorageConfig,
  validateProductionBase,
} from '@excuse/shared'

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
  /** ASR 字幕任务超时时间（毫秒） — 超时后标记 failed 并通知（默认 1h，ASR 远快于视频） */
  asrStaleTimeoutMs: number
  /** Claim 锁定时长（毫秒） — Worker claim task 后的锁过期时间 */
  claimTtlMs: number
  /** Orphan sweep 间隔（毫秒） — 后台扫描过期 lock 的频率 */
  sweepIntervalMs: number
  /** OSS 配置（可选） */
  oss: import('@excuse/storage').OSSConfig | undefined
  /** /metrics 端点访问 token（可选）；配置后所有访问必须带 Bearer（与 server 一致） */
  metricsAccessToken: string | undefined
  /** /metrics 端点允许的 CIDR / IP 列表（默认仅回环） */
  metricsAllowedCidrs: string[]
  /** Provider 同步调用整体超时（ms），默认 60000 */
  providerHttpTimeoutMs: number
  /** Provider 流式调用空闲超时（ms），默认 30000 */
  providerStreamIdleTimeoutMs: number
}

export function validateProductionConfig(config: WorkerConfig, env: NodeJS.ProcessEnv = process.env): void {
  validateProductionBase(config, env)
}

/**
 * 从环境变量读取并构建 Worker 配置
 */
export function loadConfig(): WorkerConfig {
  const provider = parseProviderConfig()
  const metrics = parseMetricsConfig()
  const timeout = parseProviderTimeoutConfig()
  const storage = parseStorageConfig()

  const config = {
    dashscopeApiKey: provider.dashscopeApiKey,
    dashscopeBaseUrl: provider.dashscopeBaseUrl,
    storageRoot: storage.storageRoot,
    pollIntervalMs: parsePositiveIntEnv('WORKER_POLL_INTERVAL_MS', 5000).value,
    staleTimeoutMs: parsePositiveIntEnv('WORKER_STALE_TIMEOUT_MS', 4 * 60 * 60 * 1000).value,
    asrStaleTimeoutMs: parsePositiveIntEnv('WORKER_ASR_STALE_TIMEOUT_MS', 60 * 60 * 1000).value,
    claimTtlMs: parsePositiveIntEnv('WORKER_CLAIM_TTL_MS', 30_000).value,
    sweepIntervalMs: parsePositiveIntEnv('WORKER_SWEEP_INTERVAL_MS', 60_000).value,
    oss: storage.oss as import('@excuse/storage').OSSConfig | undefined,
    metricsAccessToken: metrics.accessToken,
    metricsAllowedCidrs: metrics.allowedCidrs,
    providerHttpTimeoutMs: timeout.providerHttpTimeoutMs,
    providerStreamIdleTimeoutMs: timeout.providerStreamIdleTimeoutMs,
  }

  validateProductionConfig(config)

  return config
}
