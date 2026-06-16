import type { ProviderModelHealth } from '@excuse/db'
import type { DegradationConfig } from '@excuse/provider-health'
import { listProviderModelHealth, recordProviderOutcome } from '@excuse/db'
import { ModelDegradedError } from '@excuse/provider'
import { degradedRemainingMs, isDegraded, resolveDegradationConfig } from '@excuse/provider-health'
import { createLogger } from '@excuse/shared'

const logger = createLogger('provider-health')

/**
 * 进程内模型健康状态缓存 —— 给同步 provider guard 读。
 *
 * guard 注册到 `registerProviderCallGuard`，签名是同步的 `(model) => void`，无法在
 * 调用前 await DB。因此 guard 以本缓存为准：缓存命中且降级则抛 ModelDegradedError。
 * 缓存来源：① 进程启动时 warm（拉取全部 provider_model_health）；② 每次 provider
 * 调用结束的 observer 写回最新记录。短 TTL（默认 3s）保证恢复及时反映。
 */
const CACHE_TTL_MS_DEFAULT = 3000
const cache = new Map<string, { record: ProviderModelHealth | null, expiresAt: number }>()

let config: DegradationConfig = resolveDegradationConfig(process.env)
let cacheTtlMs = CACHE_TTL_MS_DEFAULT

/** 注入降级策略与缓存 TTL（测试 / 启动覆盖用）。 */
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

/** 启动时拉取全部模型健康记录填充缓存（best-effort，DB 不可用时静默）。 */
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
 *
 * 以进程内缓存判定模型是否降级；缓存未命中（冷启动 / 该 model 从未出现过）时不阻断，
 * 调用放行后由 observer 写回缓存。降级状态变化缓慢（分钟级），3s TTL 足以覆盖。
 */
export function providerCallGuard(model: string): void {
  const now = Date.now()
  const hit = cache.get(model)
  if (hit && hit.expiresAt > now && isDegraded(hit.record, now))
    throw new ModelDegradedError(model, degradedRemainingMs(hit.record, now))
}

/**
 * 记录一次 provider 调用结果到 DB（observer 回调）。
 *
 * 状态跳变（healthy→degraded / degraded→healthy）时记录日志，并始终刷新缓存，
 * 让 guard 立即看到最新状态。任何异常被吞掉，不影响主调用流程（observer 契约）。
 */
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

/** 仅供测试：直接注入缓存条目，绕过 DB 测 guard 判定。 */
export function __setProviderHealthCacheForTesting(model: string, record: ProviderModelHealth | null, ttlMs = cacheTtlMs): void {
  cache.set(model, { record, expiresAt: Date.now() + ttlMs })
}
