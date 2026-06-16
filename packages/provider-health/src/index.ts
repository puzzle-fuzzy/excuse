import type { ProviderModelHealth, ProviderModelHealthStatus } from '@excuse/shared'

/**
 * @excuse/provider-health —— 纯规则包（无 IO 依赖）
 *
 * Provider 模型连续失败自动降级（断路器）的纯策略层：
 *   1. `applyProviderOutcome` —— 根据一次 provider 调用结果（成功/失败），
 *      在「当前模型健康状态」上计算新状态与是否发生跳变。半开（half-open）语义：
 *      冷却窗口过期后允许一次真实探测，成功立即恢复，失败沿用累计计数重新降级。
 *   2. `isDegraded` / `degradedRemainingMs` —— 给调用方（guard / admin / metrics）判定。
 *
 * 设计约束：本包只导出纯函数，禁止 import @excuse/db、@excuse/provider 或 apps/*。
 * DB / provider / app 负责读写持久化与注入 `now`；策略规则收口在此，便于单测覆盖。
 *
 * 调用方：
 *   - `packages/db` 的 provider-model-health repository 用 `applyProviderOutcome` 计算写值。
 *   - `apps/server` / `apps/worker` 的 guard 用 `isDegraded` 在调用前快速失败。
 */
export type { ProviderModelHealth, ProviderModelHealthStatus } from '@excuse/shared'

/** 降级策略配置。阈值与冷却窗口可由 app 从环境变量覆盖。 */
export interface DegradationConfig {
  /** 连续失败多少次后降级 */
  failureThreshold: number
  /** 降级冷却窗口（ms）；窗口内新任务快速失败，窗口过期后半开探测 */
  cooldownMs: number
}

/** 默认策略：连续失败 3 次降级，冷却 2 分钟。 */
export const DEFAULT_DEGRADATION_CONFIG: DegradationConfig = {
  failureThreshold: 3,
  cooldownMs: 2 * 60 * 1000,
}

/**
 * 从环境变量文本解析降级配置 —— server / worker 共用，保证两进程同口径。
 *
 * 缺省 / 非法值回落到 DEFAULT_DEGRADATION_CONFIG；返回值始终合法。
 */
export function resolveDegradationConfig(env: Record<string, string | undefined> = {}): DegradationConfig {
  const failureThreshold = Number.parseInt(env.PROVIDER_DEGRADATION_FAILURE_THRESHOLD ?? '', 10)
  const cooldownMs = Number.parseInt(env.PROVIDER_DEGRADATION_COOLDOWN_MS ?? '', 10)
  return {
    failureThreshold: Number.isFinite(failureThreshold) && failureThreshold > 0 ? failureThreshold : DEFAULT_DEGRADATION_CONFIG.failureThreshold,
    cooldownMs: Number.isFinite(cooldownMs) && cooldownMs > 0 ? cooldownMs : DEFAULT_DEGRADATION_CONFIG.cooldownMs,
  }
}

/** 一次 provider 调用的结果（observer 上报）。`ts` 为 epoch 毫秒，由调用方注入。 */
export interface ProviderOutcome {
  model: string
  success: boolean
  /** 失败时的错误摘要（成功时忽略） */
  errorMessage?: string
  /** 调用结束的 epoch 毫秒；policy 用它作为时间基准 */
  ts: number
}

export interface ApplyOutcomeResult {
  record: ProviderModelHealth
  /** 状态机跳变（healthy→degraded 或 degraded→healthy）；未跳变时为 undefined */
  transitionedTo?: ProviderModelHealthStatus
}

/** 构造一条全新的健康记录（DB 中尚不存在该 model 时使用）。 */
export function freshModelHealth(model: string, ts: number): ProviderModelHealth {
  return {
    model,
    status: 'healthy',
    consecutiveFailures: 0,
    totalFailures: 0,
    totalSuccesses: 0,
    degradedUntil: null,
    lastFailureAt: null,
    lastSuccessAt: null,
    lastErrorMessage: null,
    degradedReason: null,
    updatedAt: ts,
  }
}

/**
 * 模型当前是否处于降级（阻断新调用）状态。
 *
 * 必须同时满足：status==='degraded' 且仍在 degradedUntil 冷却窗口内。
 * 冷却窗口过期（status 仍为 degraded）视为半开（half-open），不再阻断 ——
 * 下一次调用会真正打到 provider，其结果经 `applyProviderOutcome` 决定恢复或重新降级。
 */
export function isDegraded(record: ProviderModelHealth | null, now: number): boolean {
  if (!record || record.status !== 'degraded')
    return false
  if (record.degradedUntil === null)
    return false
  return now < record.degradedUntil
}

/** 距离降级恢复还剩多少毫秒；非降级状态返回 0。 */
export function degradedRemainingMs(record: ProviderModelHealth | null, now: number): number {
  if (!isDegraded(record, now) || record === null || record.degradedUntil === null)
    return 0
  return Math.max(0, record.degradedUntil - now)
}

/**
 * 纯函数：根据一次 provider 调用结果计算模型健康状态的新值。
 *
 * 规则：
 *  - 成功：consecutiveFailures 清零，status 回到 healthy，清 degradedUntil。
 *    若此前 status==='degraded'（含半开探测成功），记为 degraded→healthy 跳变。
 *  - 失败：consecutiveFailures +1，totalFailures +1，更新 lastFailureAt / lastErrorMessage。
 *    达到阈值（>= failureThreshold）且当前「未在降级窗口内」时：置 degraded，
 *    degradedUntil = ts + cooldownMs，记为 healthy→degraded 跳变。
 *    仍在降级窗口内的重复失败不延长冷却窗口（避免失败风暴无限推迟恢复）。
 *
 * @param state 当前持久化状态（DB 行映射）；null 表示该 model 首次出现
 * @param outcome 本次调用结果
 * @param config 降级策略
 */
export function applyProviderOutcome(
  state: ProviderModelHealth | null,
  outcome: ProviderOutcome,
  config: DegradationConfig = DEFAULT_DEGRADATION_CONFIG,
): ApplyOutcomeResult {
  const { model, success, errorMessage, ts } = outcome
  const prev = state ?? freshModelHealth(model, ts)

  if (success) {
    const recovered = prev.status === 'degraded'
    const record: ProviderModelHealth = {
      ...prev,
      consecutiveFailures: 0,
      totalSuccesses: prev.totalSuccesses + 1,
      status: 'healthy',
      degradedUntil: null,
      degradedReason: null,
      lastSuccessAt: ts,
      updatedAt: ts,
    }
    return { record, transitionedTo: recovered ? 'healthy' : undefined }
  }

  // ── 失败路径 ──
  const consecutiveFailures = prev.consecutiveFailures + 1
  const previouslyBlocking = isDegraded(prev, ts)
  const open = consecutiveFailures >= config.failureThreshold

  let status = prev.status
  let degradedUntil = prev.degradedUntil
  let degradedReason = prev.degradedReason
  let transitionedTo: ProviderModelHealthStatus | undefined

  if (open) {
    status = 'degraded'
    // 仅在「首次跳变」或「半开探测再次失败」时刷新冷却窗口；
    // 仍在冷却期内的重复失败保持原窗口不变。
    if (!previouslyBlocking) {
      degradedUntil = ts + config.cooldownMs
      degradedReason = `连续失败 ${consecutiveFailures} 次`
      transitionedTo = 'degraded'
    }
  }
  else {
    // 未达阈值视为健康（短暂抖动不降级）
    status = 'healthy'
    degradedUntil = null
    degradedReason = null
  }

  const record: ProviderModelHealth = {
    ...prev,
    consecutiveFailures,
    totalFailures: prev.totalFailures + 1,
    lastFailureAt: ts,
    lastErrorMessage: errorMessage ?? prev.lastErrorMessage,
    status,
    degradedUntil,
    degradedReason,
    updatedAt: ts,
  }
  return { record, transitionedTo }
}
