import type { ProviderCallStats } from '@excuse/metrics'
import { MetricsCollector } from '@excuse/metrics'
import { createLogger } from '@excuse/shared'

const logger = createLogger('metrics')
const metrics = new MetricsCollector()

/**
 * Provider 连续失败追踪器（模型级别）
 *
 * 当同一模型连续失败 3 次时记录警告日志。
 * 注：当前 observer 不含 accountId，无法做用户级别通知；
 * 用户级别的 system 通知留给后续迭代（需改造 observer 接口）。
 */
const CONSECUTIVE_FAILURE_THRESHOLD = 3
const consecutiveFailures = new Map<string, number>()

// ===== 记录方法 =====

/** 记录一次请求的延迟和状态码 */
export function recordRequest(status: number, durationMs: number) {
  metrics.recordRequest(status, durationMs)
}

/** 记录一次错误（非 HTTP 请求错误，如 SSE 断连、DB 操作失败） */
export function recordError() {
  metrics.recordError()
}

/**
 * 记录一次生成任务状态变更（server 进程内可见的终态/中间态）。
 * 仅 server 进程的指标快照（`GET /api/health/metrics`）会反映；
 * worker 异步任务的终态发生在独立进程，无法聚合到此处。
 */
export function recordGenerationStatus(status: string) {
  metrics.recordGenerationStatus(status)
}

/**
 * 记录一次 DashScope provider 调用结果（成功/失败 + 耗时）。
 *
 * 由 `registerProviderCallObserver` 在 server 启动时挂到 DashScopeClient 上，
 * 所有 chatCompletion / generateImage / submitVideoTask 调用结束后自动触发；
 * 调用方一般不直接调用本函数。
 */
export function recordProviderCall(model: string, durationMs: number, success: boolean) {
  metrics.recordProviderCall(model, durationMs, success)

  // 连续失败追踪
  if (success) {
    consecutiveFailures.delete(model)
  }
  else {
    const count = (consecutiveFailures.get(model) ?? 0) + 1
    consecutiveFailures.set(model, count)
    if (count === CONSECUTIVE_FAILURE_THRESHOLD) {
      logger.warn({ model, consecutiveFailures: count }, `Provider ${model} has failed ${count} times consecutively`)
    }
  }
}

// ===== 查询方法 =====

/** 获取当前指标快照 */
export function getMetrics(onlineUsers: number, uptime: number) {
  return metrics.snapshot(onlineUsers, uptime)
}

/**
 * 当前 server 进程内观察到的 provider 调用统计（按 model 分组）。
 *
 * 与 `getMetrics` 区别：本函数只读 `providerCalls` 字段（用于 admin 后台合并
 * generation_records 聚合），不参与 Prometheus 输出。worker 进程的 provider
 * 调用不会聚合到这里（跨进程聚合留给 Prometheus federation）。
 */
export function getProviderCallsSnapshot(): Record<string, ProviderCallStats> {
  return metrics.snapshot(0, 0).providerCalls
}

/** 重置所有指标（测试用） */
export function resetMetrics() {
  metrics.reset()
  consecutiveFailures.clear()
}
