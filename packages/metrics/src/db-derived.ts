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

function msToSeconds(ms: number): number {
  return ms / 1000
}
