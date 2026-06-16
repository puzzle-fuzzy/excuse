import type { ProviderModelHealth } from '@excuse/db'
import type { DegradationConfig } from '@excuse/provider-health'
import { listProviderModelHealth, recordProviderOutcome } from '@excuse/db'
import { ModelDegradedError } from '@excuse/provider'
import { degradedRemainingMs, isDegraded, resolveDegradationConfig } from '@excuse/provider-health'
import { createLogger } from '@excuse/shared'

const logger = createLogger('provider-health')

/**
 * Worker 进程内模型健康状态缓存 —— 与 server 的 services/provider-health.ts 平行。
 *
 * Canvas 全链路（文本/图片/视频）的 provider 调用发生在 worker，因此 worker 也需
 * 注册 guard + outcome observer。健康状态读写同一张 provider_model_health 表，
 * 跨进程共享。guard 以本进程缓存为准（3s TTL）；启动时 warm。
 */
const CACHE_TTL_MS_DEFAULT = 3000
const cache = new Map<string, { record: ProviderModelHealth | null, expiresAt: number }>()

let config: DegradationConfig = resolveDegradationConfig(process.env)
let cacheTtlMs = CACHE_TTL_MS_DEFAULT

export function configureProviderHealth(opts: { config?: DegradationConfig, cacheTtlMs?: number } = {}): void {
  if (opts.config)
    config = opts.config
  if (opts.cacheTtlMs !== undefined)
    cacheTtlMs = opts.cacheTtlMs
  clearProviderHealthCache()
}

export function getDegradationConfig(): DegradationConfig {
  return config
}

export function clearProviderHealthCache(): void {
  cache.clear()
}

export async function warmProviderHealthCache(): Promise<void> {
  try {
    const records = await listProviderModelHealth()
    const now = Date.now()
    for (const record of records)
      cache.set(record.model, { record, expiresAt: now + cacheTtlMs })
  }
  catch (err) {
    logger.warn({ err }, 'warmProviderHealthCache failed, guard will warm lazily')
  }
}

/**
 * Provider 调用前置 guard（同步，注册到 registerProviderCallGuard）。
 * 降级冷却窗口内的模型调用在此快速失败（抛 ModelDegradedError），任务由 task-engine
 * 分类为可重试 provider_error，冷却过期后重试有机会恢复。
 */
export function providerCallGuard(model: string): void {
  const now = Date.now()
  const hit = cache.get(model)
  if (hit && hit.expiresAt > now && isDegraded(hit.record, now))
    throw new ModelDegradedError(model, degradedRemainingMs(hit.record, now))
}

export async function recordProviderCallOutcome(model: string, success: boolean): Promise<void> {
  try {
    const result = await recordProviderOutcome(model, success, undefined, config)
    if (result?.transitionedTo) {
      logger.warn(
        { model, transitionedTo: result.transitionedTo, consecutiveFailures: result.record.consecutiveFailures },
        result.transitionedTo === 'degraded'
          ? `Provider model ${model} 已自动降级`
          : `Provider model ${model} 已恢复`,
      )
    }
    if (result)
      cache.set(model, { record: result.record, expiresAt: Date.now() + cacheTtlMs })
  }
  catch (err) {
    logger.error({ err, model }, 'recordProviderCallOutcome failed')
  }
}

export function __setProviderHealthCacheForTesting(model: string, record: ProviderModelHealth | null, ttlMs = cacheTtlMs): void {
  cache.set(model, { record, expiresAt: Date.now() + ttlMs })
}
