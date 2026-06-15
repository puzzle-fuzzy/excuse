import type { ProviderCallStats } from '@excuse/metrics'
import { MetricsCollector } from '@excuse/metrics'

/**
 * Worker 进程内 metrics 收集器。
 *
 * 与 server 的 `apps/server/src/services/metrics.ts` 平行：每个进程持有独立的
 * `MetricsCollector` 实例。worker 启动时通过 `registerProviderCallObserver`
 * 把 DashScopeClient 调用接入本收集器（见 `apps/worker/src/index.ts`），
 * 随后 worker `/metrics` 端点序列化输出。
 *
 * 跨进程聚合由 Prometheus 多 target 抓取完成（server:5007 + worker:5100），
 * 两个进程同名 metric 由 Prometheus 自动 `instance` label 区分。
 *
 * 精简版：不含 server 的连续失败追踪（worker 侧无 admin UI 消费该信号）。
 */
const metrics = new MetricsCollector()

/** 记录一次 DashScope provider 调用结果（成功/失败 + 耗时）。由 observer 调用。 */
export function recordProviderCall(model: string, durationMs: number, success: boolean): void {
  metrics.recordProviderCall(model, durationMs, success)
}

/** 当前 worker 进程内观察到的 provider 调用统计（按 model 分组），供 /metrics 序列化。 */
export function getProviderCallsSnapshot(): Record<string, ProviderCallStats> {
  return metrics.snapshot(0, 0).providerCalls
}

/** 重置全部计数（测试用）。 */
export function resetWorkerMetrics(): void {
  metrics.reset()
}
