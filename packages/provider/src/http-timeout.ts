/**
 * Provider HTTP 超时控制。
 *
 * 见 docs/TODO.md §1.1：DashScope / ASR 全链路 fetch 此前**无任何超时**，provider
 * 端 hang 会导致请求连接常驻、流式 ReadableStream 永不 close（连接泄漏）、worker
 * task 永不完成（text/image 无超时守卫，仅 video 有 4h 业务超时）。
 *
 * 两类超时：
 * - **同步调用**（chat / image / audio / video submit / queryTask / cancelTask）：
 *   整体 fetch 超时（`AbortSignal.timeout`，默认 60s）。
 * - **流式调用**（chatCompletionStream）：连接 + 每个 chunk 之间的**空闲超时**
 *   （默认 30s，每个 chunk 到达后重置）——流式可能持续数分钟，不能用整体超时一刀切。
 *
 * 超时/中断抛出的错误最终在 client 的 catch 中被识别为 `code: 'TIMEOUT'` /
 * `'ECONNRESET'`，写进 `FailedProviderResult.code`，由 canvas-runtime 以
 * `cause.code` 透传给 `@excuse/task-engine.classifyTaskError`，从而进入可重试分类。
 */

/** 同步 provider 调用的默认整体超时（ms）。 */
export const DEFAULT_HTTP_TIMEOUT_MS = 60_000
/** 流式 provider 调用的默认空闲超时（ms，每 chunk 到达后重置）。 */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 30_000

/**
 * 为同步 fetch 构造一个超时 AbortSignal。
 *
 * `ms` 为 undefined / 非正时返回 undefined（不施加超时，保持旧行为），便于测试
 * 与「显式禁用超时」的场景。
 */
export function timeoutSignal(ms: number | undefined): AbortSignal | undefined {
  if (!ms || ms <= 0)
    return undefined
  return AbortSignal.timeout(ms)
}

/**
 * 判断一个错误是否源自超时 / 中断（`AbortSignal.timeout` 触发或手动 abort）。
 *
 * 识别 `AbortError`（手动 abort）与 `TimeoutError`（`AbortSignal.timeout`），
 * 并沿 `error.cause` 链查找 —— fetch 的 rejection 有时把 DOMException 包在 cause 里。
 */
export function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error))
    return false
  const names = [error.name, (error as { cause?: { name?: string } }).cause?.name]
  return names.includes('AbortError') || names.includes('TimeoutError')
}

/**
 * 流式读取超时控制器。
 *
 * - `signal`：传给 `fetch`，覆盖「连接建立 + 首字节」阶段。
 * - `schedule()`：在每次成功读取 chunk 后调用，重置空闲计时。
 * - `clear()`：流结束后清理计时器（避免悬挂 timer）。
 *
 * 一旦空闲超过 `idleMs` 无任何 chunk 到达，即 `abort` 一个 `TimeoutError`，使
 * `reader.read()` reject、流中断并向上抛出可被 `isAbortError` 识别的错误。
 */
export interface StreamTimeoutController {
  signal: AbortSignal
  /** 重置空闲计时（每个 chunk 到达后调用）。 */
  schedule: () => void
  /** 清理计时器（流正常结束或异常退出时调用）。 */
  clear: () => void
}

/**
 * 构造一个流式读取超时控制器。构造时即启动一次计时，覆盖连接 + 首字节阶段。
 *
 * `idleMs` 为 undefined / 非正时返回 no-op 控制器（不施加超时）。
 */
export function createStreamTimeoutController(idleMs: number | undefined): StreamTimeoutController {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined

  const fire = (): void => {
    let reason: unknown
    try {
      // 优先用 TimeoutError，便于 isAbortError 识别
      reason = new DOMException('provider stream idle timeout', 'TimeoutError')
    }
    catch {
      reason = undefined // 无 DOMException 的运行时回退
    }
    try {
      controller.abort(reason ?? undefined)
    }
    catch {
      controller.abort()
    }
  }

  const schedule = (): void => {
    if (timer)
      clearTimeout(timer)
    if (idleMs && idleMs > 0)
      timer = setTimeout(fire, idleMs)
  }

  const clear = (): void => {
    if (timer)
      clearTimeout(timer)
    timer = undefined
  }

  // 立即启动一次：覆盖「连接建立 + 首字节」
  schedule()

  return { signal: controller.signal, schedule, clear }
}
