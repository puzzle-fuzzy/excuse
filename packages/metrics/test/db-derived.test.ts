import type { PrometheusMetric } from '../src'
import { describe, expect, it } from 'bun:test'
import { aggregateCanvasPhaseMetrics, aggregateProviderHealthMetrics, aggregateTaskQueueMetrics } from '../src'

function metricByName(metrics: PrometheusMetric[], name: string): PrometheusMetric | undefined {
  return metrics.find(m => m.name === name)
}

describe('aggregateCanvasPhaseMetrics', () => {
  it('空输入返回 2 个 metric family，各 samples=[]', () => {
    const result = aggregateCanvasPhaseMetrics([])
    expect(result).toHaveLength(2)

    const totalMetric = metricByName(result, 'excuse_canvas_phase_total')
    expect(totalMetric).toBeDefined()
    expect(totalMetric!.help).toBeTruthy()
    expect(totalMetric!.type).toBe('counter')
    expect(totalMetric!.samples).toEqual([])

    const durationMetric = metricByName(result, 'excuse_canvas_phase_duration_seconds')
    expect(durationMetric).toBeDefined()
    expect(durationMetric!.help).toBeTruthy()
    expect(durationMetric!.type).toBe('gauge')
    expect(durationMetric!.samples).toEqual([])
  })

  it('单条 succeeded → phase_total 含 1 样本 + duration 含 3 quantile 样本', () => {
    const result = aggregateCanvasPhaseMetrics([
      { phase: 'analyze', status: 'succeeded', count: 5, durationP50Ms: 1000, durationP95Ms: 2000, durationAvgMs: 1200 },
    ])

    const totalMetric = metricByName(result, 'excuse_canvas_phase_total')!
    expect(totalMetric.samples).toHaveLength(1)
    expect(totalMetric.samples[0]).toEqual({ labels: { phase: 'analyze', status: 'succeeded' }, value: 5 })

    const durationMetric = metricByName(result, 'excuse_canvas_phase_duration_seconds')!
    expect(durationMetric.samples).toHaveLength(3)
    expect(durationMetric.samples).toContainEqual({ labels: { phase: 'analyze', quantile: '0.5' }, value: 1 })
    expect(durationMetric.samples).toContainEqual({ labels: { phase: 'analyze', quantile: '0.95' }, value: 2 })
    expect(durationMetric.samples).toContainEqual({ labels: { phase: 'analyze', quantile: 'avg' }, value: 1.2 })
  })

  it('succeeded + failed 混合 → duration 仅取 succeeded', () => {
    const result = aggregateCanvasPhaseMetrics([
      { phase: 'analyze', status: 'succeeded', count: 3, durationP50Ms: 500, durationP95Ms: 800, durationAvgMs: 600 },
      { phase: 'analyze', status: 'failed', count: 2, durationP50Ms: 0, durationP95Ms: 0, durationAvgMs: 0 },
    ])

    const totalMetric = metricByName(result, 'excuse_canvas_phase_total')!
    expect(totalMetric.samples).toHaveLength(2)
    expect(totalMetric.samples).toContainEqual({ labels: { phase: 'analyze', status: 'succeeded' }, value: 3 })
    expect(totalMetric.samples).toContainEqual({ labels: { phase: 'analyze', status: 'failed' }, value: 2 })

    const durationMetric = metricByName(result, 'excuse_canvas_phase_duration_seconds')!
    expect(durationMetric.samples).toHaveLength(3)
    // duration 样本只用 succeeded
    for (const sample of durationMetric.samples) {
      expect(sample.labels!.phase).toBe('analyze')
    }
    expect(durationMetric.samples).toContainEqual({ labels: { phase: 'analyze', quantile: '0.5' }, value: 0.5 })
  })

  it('缺失 succeeded 的 phase → duration metric family samples 为空', () => {
    const result = aggregateCanvasPhaseMetrics([
      { phase: 'analyze', status: 'failed', count: 1, durationP50Ms: 0, durationP95Ms: 0, durationAvgMs: 0 },
      { phase: 'analyze', status: 'cancelled', count: 1, durationP50Ms: 0, durationP95Ms: 0, durationAvgMs: 0 },
    ])

    const totalMetric = metricByName(result, 'excuse_canvas_phase_total')!
    expect(totalMetric.samples).toHaveLength(2)

    const durationMetric = metricByName(result, 'excuse_canvas_phase_duration_seconds')!
    expect(durationMetric.samples).toEqual([])
  })

  it('多 phase 混合 → 每个 succeeded phase 输出 3 条 duration', () => {
    const result = aggregateCanvasPhaseMetrics([
      { phase: 'analyze', status: 'succeeded', count: 1, durationP50Ms: 100, durationP95Ms: 200, durationAvgMs: 150 },
      { phase: 'characters', status: 'succeeded', count: 2, durationP50Ms: 300, durationP95Ms: 400, durationAvgMs: 350 },
      { phase: 'locations', status: 'succeeded', count: 1, durationP50Ms: 500, durationP95Ms: 600, durationAvgMs: 550 },
    ])

    const totalMetric = metricByName(result, 'excuse_canvas_phase_total')!
    expect(totalMetric.samples).toHaveLength(3)

    const durationMetric = metricByName(result, 'excuse_canvas_phase_duration_seconds')!
    expect(durationMetric.samples).toHaveLength(9) // 3 phases * 3 quantiles
  })

  it('单位转换：duration 输入毫秒，输出秒', () => {
    const result = aggregateCanvasPhaseMetrics([
      { phase: 'analyze', status: 'succeeded', count: 1, durationP50Ms: 12345, durationP95Ms: 67890, durationAvgMs: 40000 },
    ])

    const durationMetric = metricByName(result, 'excuse_canvas_phase_duration_seconds')!
    expect(durationMetric.samples).toContainEqual({ labels: { phase: 'analyze', quantile: '0.5' }, value: 12.345 })
    expect(durationMetric.samples).toContainEqual({ labels: { phase: 'analyze', quantile: '0.95' }, value: 67.89 })
    expect(durationMetric.samples).toContainEqual({ labels: { phase: 'analyze', quantile: 'avg' }, value: 40 })
  })

  it('每个返回 metric 都有 name / help / type / samples 且 type ∈ [counter, gauge]', () => {
    const result = aggregateCanvasPhaseMetrics([
      { phase: 'analyze', status: 'succeeded', count: 1, durationP50Ms: 100, durationP95Ms: 200, durationAvgMs: 150 },
    ])

    for (const metric of result) {
      expect(metric).toHaveProperty('name')
      expect(metric).toHaveProperty('help')
      expect(metric).toHaveProperty('type')
      expect(metric).toHaveProperty('samples')
      expect(['counter', 'gauge']).toContain(metric.type)
      expect(typeof metric.name).toBe('string')
      expect(metric.name.length).toBeGreaterThan(0)
    }
  })
})

describe('aggregateTaskQueueMetrics', () => {
  it('空输入返回 1 个 metric family，samples=[]', () => {
    const result = aggregateTaskQueueMetrics([])
    expect(result).toHaveLength(1)

    const metric = result[0]!
    expect(metric.name).toBe('excuse_task_queue_depth')
    expect(metric.help).toBeTruthy()
    expect(metric.type).toBe('gauge')
    expect(metric.samples).toEqual([])
  })

  it('单条 → 1 sample', () => {
    const result = aggregateTaskQueueMetrics([
      { domain: 'canvas', status: 'queued', count: 3 },
    ])

    expect(result[0]!.samples).toHaveLength(1)
    expect(result[0]!.samples[0]).toEqual({ labels: { domain: 'canvas', status: 'queued' }, value: 3 })
  })

  it('多 domain × status → 每行一条样本', () => {
    const result = aggregateTaskQueueMetrics([
      { domain: 'canvas', status: 'queued', count: 5 },
      { domain: 'canvas', status: 'running', count: 2 },
      { domain: 'generate', status: 'queued', count: 10 },
      { domain: 'generate', status: 'failed', count: 1 },
      { domain: 'subtitle', status: 'succeeded', count: 8 },
    ])

    expect(result[0]!.samples).toHaveLength(5)
    expect(result[0]!.samples).toContainEqual({ labels: { domain: 'canvas', status: 'queued' }, value: 5 })
    expect(result[0]!.samples).toContainEqual({ labels: { domain: 'canvas', status: 'running' }, value: 2 })
    expect(result[0]!.samples).toContainEqual({ labels: { domain: 'generate', status: 'queued' }, value: 10 })
    expect(result[0]!.samples).toContainEqual({ labels: { domain: 'subtitle', status: 'succeeded' }, value: 8 })
  })

  it('type 为 gauge', () => {
    const result = aggregateTaskQueueMetrics([
      { domain: 'canvas', status: 'queued', count: 1 },
    ])
    expect(result[0]!.type).toBe('gauge')
  })

  it('每个返回 metric 都含 name / help / type / samples', () => {
    const result = aggregateTaskQueueMetrics([
      { domain: 'gateway', status: 'retrying', count: 2 },
    ])

    for (const metric of result) {
      expect(metric).toHaveProperty('name')
      expect(metric).toHaveProperty('help')
      expect(metric).toHaveProperty('type')
      expect(metric).toHaveProperty('samples')
    }
  })
})

describe('aggregateProviderHealthMetrics', () => {
  it('空输入返回 2 个 metric family，各 samples=[]', () => {
    const result = aggregateProviderHealthMetrics([])
    expect(result).toHaveLength(2)
    for (const metric of result) {
      expect(metric.help).toBeTruthy()
      expect(metric.type).toBe('gauge')
      expect(metric.samples).toEqual([])
    }
    expect(result.map(m => m.name)).toEqual([
      'excuse_provider_model_degraded',
      'excuse_provider_consecutive_failures',
    ])
  })

  it('仅 blocking 模型进入 degraded metric（=1），所有模型进入 consecutive metric', () => {
    const result = aggregateProviderHealthMetrics([
      { model: 'qwen-max', blocking: true, consecutiveFailures: 5 },
      { model: 'wanx-imgen', blocking: false, consecutiveFailures: 1 },
    ])

    const degraded = metricByName(result, 'excuse_provider_model_degraded')!
    expect(degraded.samples).toHaveLength(1)
    expect(degraded.samples[0]).toEqual({ labels: { model: 'qwen-max' }, value: 1 })

    const consecutive = metricByName(result, 'excuse_provider_consecutive_failures')!
    expect(consecutive.samples).toHaveLength(2)
    expect(consecutive.samples).toContainEqual({ labels: { model: 'qwen-max' }, value: 5 })
    expect(consecutive.samples).toContainEqual({ labels: { model: 'wanx-imgen' }, value: 1 })
  })

  it('全部健康时 degraded metric 无样本（缺失即 0）', () => {
    const result = aggregateProviderHealthMetrics([
      { model: 'qwen-max', blocking: false, consecutiveFailures: 0 },
      { model: 'wanx-imgen', blocking: false, consecutiveFailures: 2 },
    ])
    expect(metricByName(result, 'excuse_provider_model_degraded')!.samples).toEqual([])
    expect(metricByName(result, 'excuse_provider_consecutive_failures')!.samples).toHaveLength(2)
  })
})
