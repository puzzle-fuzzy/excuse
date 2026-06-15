import type { ProviderCallStats } from './index'
import type { PrometheusMetric } from './prometheus'

/**
 * 把 provider 调用统计映射为 Prometheus metric family：
 * - counter `excuse_provider_calls_total{model, status}`：每个 model 的 success/failed 计数。
 * - gauge `excuse_provider_latency_seconds{model, quantile}`：每个 model 的 p50/p95/avg latency（秒）。
 *
 * 输入是 `MetricsSnapshot.providerCalls`（keyed by model）。
 * Pure 函数：无副作用、无 IO。
 *
 * 空 durations（无调用样本）时不产生 latency 样本 —— Prometheus 端 scrape 间隔内无调用则无 timeseries，正常行为；
 * calls_total 仍会输出 success=0/failed=0 的样本，便于下游 dashboard 知道该 model 在本进程内已被注册。
 */
export function aggregateProviderMetrics(
  providerCalls: Record<string, ProviderCallStats>,
): PrometheusMetric[] {
  const callsSamples: PrometheusMetric['samples'] = []
  const latencySamples: PrometheusMetric['samples'] = []

  for (const [model, stats] of Object.entries(providerCalls)) {
    callsSamples.push({ labels: { model, status: 'success' }, value: stats.success })
    callsSamples.push({ labels: { model, status: 'failed' }, value: stats.failed })

    if (stats.durations.length > 0) {
      const sorted = [...stats.durations].sort((a, b) => a - b)
      const p50 = percentile(sorted, 0.5)
      const p95 = percentile(sorted, 0.95)
      const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length

      latencySamples.push({ labels: { model, quantile: '0.5' }, value: msToSeconds(p50) })
      latencySamples.push({ labels: { model, quantile: '0.95' }, value: msToSeconds(p95) })
      latencySamples.push({ labels: { model, quantile: 'avg' }, value: msToSeconds(avg) })
    }
  }

  return [
    {
      name: 'excuse_provider_calls_total',
      help: 'Provider (DashScope) call counts by model and status (success/failed), in-process since last restart.',
      type: 'counter',
      samples: callsSamples,
    },
    {
      name: 'excuse_provider_latency_seconds',
      help: 'Provider (DashScope) call latency in seconds (p50/p95/avg) by model, sliding window over recent calls.',
      type: 'gauge',
      samples: latencySamples,
    },
  ]
}

/**
 * Nearest-rank percentile：从已升序排序的数组中取第 p 百分位（p ∈ [0,1]）。
 * 公式：idx = ceil(p * n) - 1，clamp 到 [0, n-1]；空数组返回 0。
 * 与 `MetricsSnapshot.latency` 用的 `percentile(sorted, 50/95/99)` 同方法。
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0)
    return 0
  const idx = Math.ceil(p * sorted.length) - 1
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))]!
}

function msToSeconds(ms: number): number {
  return ms / 1000
}

/**
 * 合并两个进程的 provider 调用统计（如 server + worker 跨进程聚合）。
 *
 * 按 model 聚合：success/failed 计数相加，`durations` 原始样本拼接 —— 保留原始样本以便
 * 下游对合并后的集合重新计算精确 p50/p95（已聚合的 quantile 无法跨进程正确合并，
 * 故必须传原始 durations 而非已算好的分位数）。
 *
 * Pure 函数：无副作用、无 IO；不修改入参，返回新对象。
 *
 * 典型用法：admin 后台聚合 server 进程内 metrics + worker `/provider-calls` 快照。
 */
export function mergeProviderCalls(
  a: Record<string, ProviderCallStats>,
  b: Record<string, ProviderCallStats>,
): Record<string, ProviderCallStats> {
  const merged: Record<string, ProviderCallStats> = {}
  for (const [model, stats] of Object.entries(a)) {
    merged[model] = { success: stats.success, failed: stats.failed, durations: [...stats.durations] }
  }
  for (const [model, stats] of Object.entries(b)) {
    const existing = merged[model]
    if (existing) {
      existing.success += stats.success
      existing.failed += stats.failed
      existing.durations = [...existing.durations, ...stats.durations]
    }
    else {
      merged[model] = { success: stats.success, failed: stats.failed, durations: [...stats.durations] }
    }
  }
  return merged
}
