import type { PrometheusMetric } from './prometheus'

export interface CanvasPhaseStatInput {
  phase: string
  status: string
  count: number
  durationP50Ms: number
  durationP95Ms: number
  durationAvgMs: number
}

export interface TaskQueueStatInput {
  domain: string
  status: string
  count: number
}

export function aggregateCanvasPhaseMetrics(rows: CanvasPhaseStatInput[]): PrometheusMetric[] {
  const phaseTotalSamples: PrometheusMetric['samples'] = rows.map(row => ({
    labels: { phase: row.phase, status: row.status },
    value: row.count,
  }))

  const succeededByPhase = new Map<string, CanvasPhaseStatInput>()
  for (const row of rows) {
    if (row.status === 'succeeded')
      succeededByPhase.set(row.phase, row)
  }

  const durationSamples: PrometheusMetric['samples'] = []
  for (const [phase, row] of succeededByPhase) {
    durationSamples.push({ labels: { phase, quantile: '0.5' }, value: msToSeconds(row.durationP50Ms) })
    durationSamples.push({ labels: { phase, quantile: '0.95' }, value: msToSeconds(row.durationP95Ms) })
    durationSamples.push({ labels: { phase, quantile: 'avg' }, value: msToSeconds(row.durationAvgMs) })
  }

  return [
    {
      name: 'excuse_canvas_phase_total',
      help: 'Canvas pipeline run counts by phase and status within the query window.',
      type: 'counter',
      samples: phaseTotalSamples,
    },
    {
      name: 'excuse_canvas_phase_duration_seconds',
      help: 'Canvas pipeline phase duration in seconds (p50/p95/avg), succeeded runs only.',
      type: 'gauge',
      samples: durationSamples,
    },
  ]
}

export function aggregateTaskQueueMetrics(rows: TaskQueueStatInput[]): PrometheusMetric[] {
  const samples: PrometheusMetric['samples'] = rows.map(row => ({
    labels: { domain: row.domain, status: row.status },
    value: row.count,
  }))

  return [
    {
      name: 'excuse_task_queue_depth',
      help: 'Unified task queue depth by domain and status (instantaneous count, all-time cumulative per status).',
      type: 'gauge',
      samples,
    },
  ]
}

export interface ProviderHealthStatInput {
  model: string
  /** 当前是否阻断新调用（status degraded 且仍在冷却窗口内）—— 由调用方用 isDegraded 判定后传入 */
  blocking: boolean
  consecutiveFailures: number
}

/**
 * Provider 模型降级（断路器）指标。
 *
 * - `excuse_provider_model_degraded{model}` = 1：仅输出当前正在阻断的模型
 *   （Prometheus 约定：缺失即 0；模型恢复后旧 sample 在下次 scrape 自然 stale）。
 * - `excuse_provider_consecutive_failures{model}`：每个 tracked 模型的连续失败计数。
 *
 * 仅由 server `/metrics` 输出（健康状态是 DB 共享的，worker 不重复输出避免 federation 双计）。
 */
export function aggregateProviderHealthMetrics(rows: ProviderHealthStatInput[]): PrometheusMetric[] {
  const degradedSamples: PrometheusMetric['samples'] = rows
    .filter(row => row.blocking)
    .map(row => ({ labels: { model: row.model }, value: 1 }))

  const consecutiveSamples: PrometheusMetric['samples'] = rows.map(row => ({
    labels: { model: row.model },
    value: row.consecutiveFailures,
  }))

  return [
    {
      name: 'excuse_provider_model_degraded',
      help: '1 when the provider model is currently degraded (blocking new calls within its cooldown). Absent = healthy.',
      type: 'gauge',
      samples: degradedSamples,
    },
    {
      name: 'excuse_provider_consecutive_failures',
      help: 'Recent consecutive provider failures per model (resets to 0 on any success).',
      type: 'gauge',
      samples: consecutiveSamples,
    },
  ]
}

function msToSeconds(ms: number): number {
  return ms / 1000
}
