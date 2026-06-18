/**
 * @excuse/provider — Provider 调用全局 hook registry（observer + guard）
 *
 * 与 DashScopeClient / ASRClient 解耦的横切关注点：
 *   - observer：每次 provider 调用结束（成功/失败）后通知（用于 metrics 收集）
 *   - guard：每次 provider 调用前检查（用于断路器降级快速失败）
 *
 * 设计意图：
 * - `@excuse/provider` 不依赖 `@excuse/metrics`（runtime 包不能依赖 pure 单例）；
 *   由 app（如 server）启动时通过 register* 函数注入。
 * - 全局 hook 列表，所有 DashScopeClient 实例共享 —— 因 DashScopeClient 在 server / worker
 *   多个调用点分散实例化，没有集中初始化点；hook registry 让任意实例都能触发回调。
 * - hook 内部不应抛错（已 try/catch 兜底，但 hook 自身性能影响所有调用）。
 */

// ── Provider 调用观察者（metrics 收集）──────────────────────

export type ProviderCallObserver = (model: string, durationMs: number, success: boolean) => void

const providerCallObservers: ProviderCallObserver[] = []

/**
 * 注册一个 provider 调用观察者。返回反注册函数。
 *
 * 在 app 启动时（如 `apps/server/src/index.ts`）调用一次：
 *
 * ```ts
 * registerProviderCallObserver((model, durationMs, success) => {
 *   recordProviderCall(model, durationMs, success)
 * })
 * ```
 */
export function registerProviderCallObserver(observer: ProviderCallObserver): () => void {
  providerCallObservers.push(observer)
  return () => {
    const idx = providerCallObservers.indexOf(observer)
    if (idx >= 0)
      providerCallObservers.splice(idx, 1)
  }
}

/** 仅供测试用：清空所有 observer。 */
export function __resetProviderCallObservers(): void {
  providerCallObservers.length = 0
}

/**
 * 通知所有已注册的 provider 调用观察者（包内共享）。
 *
 * 由 DashScopeClient（chat/image/video submit）与 ASRClient（paraformer submit）
 * 在每次 provider 调用结束（成功/失败）时调用。observer 抛错不影响主流程。
 * 注：异步任务的轮询查询（queryTask）不计入 —— 与 video `queryTask` 一致，
 * 避免廉价轮询稀释模型真实 latency（见 ASRClient.submitTranscription）。
 */
export function notifyProviderCallObservers(model: string, durationMs: number, success: boolean): void {
  for (const observer of providerCallObservers) {
    try {
      observer(model, durationMs, success)
    }
    catch {
      // hook 抛错不影响主流程；测试环境下也会暴露在 observer 自身日志中。
    }
  }
}

// ── Provider 调用前置 guard（断路器降级）──────────────────────
//
// 与 observer 平行的全局 hook registry：DashScopeClient / ASRClient 在真正发起
// provider 调用前先跑一遍 guard。guard 通过抛 `ModelDegradedError` 阻断调用 ——
// 让处于降级冷却窗口内的模型快速失败，而不是让用户空等几十秒视频提交。
//
// 健康状态查询（读 DB）由 app 注入的 guard 实现负责；@excuse/provider 不依赖 DB。

/**
 * 模型降级错误 —— guard 在模型处于降级冷却窗口内时抛出。
 *
 * `code = 'MODEL_DEGRADED'` 供 @excuse/task-engine 分类为可重试的 provider_error
 * （让在途任务在冷却过期后有机会恢复，而非永久失败）。
 */
export class ModelDegradedError extends Error {
  readonly code = 'MODEL_DEGRADED' as const
  readonly model: string
  readonly retryAfterMs: number
  constructor(model: string, retryAfterMs: number) {
    const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000))
    super(`模型 ${model} 暂时不可用（连续失败已降级），请在约 ${seconds} 秒后重试`)
    this.name = 'ModelDegradedError'
    this.model = model
    this.retryAfterMs = retryAfterMs
  }
}

export type ProviderCallGuard = (model: string) => void

const providerCallGuards: ProviderCallGuard[] = []

/**
 * 注册一个 provider 调用前置 guard。返回反注册函数。
 *
 * guard 通过抛错（通常是 `ModelDegradedError`）阻断调用；不抛则放行。
 * 在 app 启动时（server / worker）调用一次，注入「读 DB 判定模型是否降级」的实现。
 */
export function registerProviderCallGuard(guard: ProviderCallGuard): () => void {
  providerCallGuards.push(guard)
  return () => {
    const idx = providerCallGuards.indexOf(guard)
    if (idx >= 0)
      providerCallGuards.splice(idx, 1)
  }
}

/** 仅供测试用：清空所有 guard。 */
export function __resetProviderCallGuards(): void {
  providerCallGuards.length = 0
}

/**
 * 跑所有前置 guard —— 任一 guard 抛错即阻断本次 provider 调用（错误向上传播）。
 *
 * 由 DashScopeClient / ASRClient 在发起真实调用前调用。无 guard 注册时为 no-op，
 * 行为与未接入降级策略时完全一致（测试 / 旧调用路径不受影响）。
 */
export function runProviderCallGuards(model: string): void {
  for (const guard of providerCallGuards) {
    guard(model)
  }
}
