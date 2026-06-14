import { MetricsCollector } from '@excuse/metrics'

const metrics = new MetricsCollector()

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

// ===== 查询方法 =====

/** 获取当前指标快照 */
export function getMetrics(onlineUsers: number, uptime: number) {
  return metrics.snapshot(onlineUsers, uptime)
}

/** 重置所有指标（测试用） */
export function resetMetrics() {
  metrics.reset()
}
