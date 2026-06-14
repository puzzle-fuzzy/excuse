import type { PrometheusMetric } from '../src'
import type { ProviderCallStats } from '../src'
import { describe, expect, it } from 'bun:test'
import { aggregateProviderMetrics } from '../src'

function metricByName(metrics: PrometheusMetric[], name: string): PrometheusMetric | undefined {
  return metrics.find(m => m.name === name)
}

describe('aggregateProviderMetrics', () => {
  it('空输入返回 2 个 metric family，各 samples=[]', () => {
    const result = aggregateProviderMetrics({})
    expect(result).toHaveLength(2)

    const callsMetric = metricByName(result, 'excuse_provider_calls_total')
    expect(callsMetric).toBeDefined()
    expect(callsMetric!.help).toBeTruthy()
    expect(callsMetric!.type).toBe('counter')
    expect(callsMetric!.samples).toEqual([])

    const latencyMetric = metricByName(result, 'excuse_provider_latency_seconds')
    expect(latencyMetric).toBeDefined()
    expect(latencyMetric!.help).toBeTruthy()
    expect(latencyMetric!.type).toBe('gauge')
    expect(latencyMetric!.samples).toEqual([])
  })

  it('单 model 全部成功 → calls 有 success/failed 两条 + latency 3 条 quantile', () => {
    const stats: Record<string, ProviderCallStats> = {
      'qwen-max': { success: 5, failed: 0, durations: [1000, 1200, 1100, 1300, 1400] },
    }

    const result = aggregateProviderMetrics(stats)

    const callsMetric = metricByName(result, 'excuse_provider_calls_total')!
    expect(callsMetric.samples).toContainEqual({ labels: { model: 'qwen-max', status: 'success' }, value: 5 })
    expect(callsMetric.samples).toContainEqual({ labels: { model: 'qwen-max', status: 'failed' }, value: 0 })

    const latencyMetric = metricByName(result, 'excuse_provider_latency_seconds')!
    expect(latencyMetric.samples).toHaveLength(3)
    expect(latencyMetric.samples.some(s => s.labels!.model === 'qwen-max' && s.labels!.quantile === '0.5')).toBe(true)
    expect(latencyMetric.samples.some(s => s.labels!.model === 'qwen-max' && s.labels!.quantile === '0.95')).toBe(true)
    expect(latencyMetric.samples.some(s => s.labels!.model === 'qwen-max' && s.labels!.quantile === 'avg')).toBe(true)
  })

  it('单 model 全部失败且无 durations → calls 仍输出，latency 无样本', () => {
    const stats: Record<string, ProviderCallStats> = {
      'qwen-max': { success: 0, failed: 2, durations: [] },
    }

    const result = aggregateProviderMetrics(stats)

    const callsMetric = metricByName(result, 'excuse_provider_calls_total')!
    expect(callsMetric.samples).toContainEqual({ labels: { model: 'qwen-max', status: 'success' }, value: 0 })
    expect(callsMetric.samples).toContainEqual({ labels: { model: 'qwen-max', status: 'failed' }, value: 2 })

    const latencyMetric = metricByName(result, 'excuse_provider_latency_seconds')!
    expect(latencyMetric.samples).toEqual([])
  })

  it('多 model 混合 → calls 和 latency 样本按 model 各自展开', () => {
    const stats: Record<string, ProviderCallStats> = {
      'qwen-max': { success: 3, failed: 1, durations: [100, 200, 300] },
      'wanx2.1-t2v-turbo': { success: 2, failed: 0, durations: [5000, 6000] },
    }

    const result = aggregateProviderMetrics(stats)

    const callsMetric = metricByName(result, 'excuse_provider_calls_total')!
    // 2 models × 2 status = 4 samples
    expect(callsMetric.samples).toHaveLength(4)
    expect(callsMetric.samples).toContainEqual({ labels: { model: 'qwen-max', status: 'success' }, value: 3 })
    expect(callsMetric.samples).toContainEqual({ labels: { model: 'qwen-max', status: 'failed' }, value: 1 })
    expect(callsMetric.samples).toContainEqual({ labels: { model: 'wanx2.1-t2v-turbo', status: 'success' }, value: 2 })
    expect(callsMetric.samples).toContainEqual({ labels: { model: 'wanx2.1-t2v-turbo', status: 'failed' }, value: 0 })

    const latencyMetric = metricByName(result, 'excuse_provider_latency_seconds')!
    // 2 models × 3 quantiles = 6 samples
    expect(latencyMetric.samples).toHaveLength(6)
  })

  it('p50/p95 nearest-rank 计算正确', () => {
    // 已知 durations：[100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]（n=10）
    // p50 nearest-rank: idx = ceil(0.5 * 10) - 1 = 4 → sorted[4] = 500
    // p95 nearest-rank: idx = ceil(0.95 * 10) - 1 = 9 → sorted[9] = 1000
    // avg = 550
    const stats: Record<string, ProviderCallStats> = {
      'qwen-max': { success: 10, failed: 0, durations: [1000, 900, 800, 700, 600, 500, 400, 300, 200, 100] },
    }

    const result = aggregateProviderMetrics(stats)
    const latencyMetric = metricByName(result, 'excuse_provider_latency_seconds')!

    expect(latencyMetric.samples).toContainEqual({ labels: { model: 'qwen-max', quantile: '0.5' }, value: 0.5 })
    expect(latencyMetric.samples).toContainEqual({ labels: { model: 'qwen-max', quantile: '0.95' }, value: 1 })
    expect(latencyMetric.samples).toContainEqual({ labels: { model: 'qwen-max', quantile: 'avg' }, value: 0.55 })
  })

  it('毫秒 → 秒 单位转换', () => {
    const stats: Record<string, ProviderCallStats> = {
      'qwen-max': { success: 1, failed: 0, durations: [12345] },
    }

    const result = aggregateProviderMetrics(stats)
    const latencyMetric = metricByName(result, 'excuse_provider_latency_seconds')!

    // p50 = p95 = avg = 12345ms（单样本）
    expect(latencyMetric.samples).toContainEqual({ labels: { model: 'qwen-max', quantile: '0.5' }, value: 12.345 })
    expect(latencyMetric.samples).toContainEqual({ labels: { model: 'qwen-max', quantile: 'avg' }, value: 12.345 })
  })

  it('单样本 durations → p50 = p95 = avg', () => {
    const stats: Record<string, ProviderCallStats> = {
      'qwen-max': { success: 1, failed: 0, durations: [250] },
    }

    const result = aggregateProviderMetrics(stats)
    const latencyMetric = metricByName(result, 'excuse_provider_latency_seconds')!

    for (const sample of latencyMetric.samples) {
      expect(sample.value).toBe(0.25)
    }
  })

  it('每个 metric family 含 name / help / type / samples 且 type ∈ [counter, gauge]', () => {
    const result = aggregateProviderMetrics({
      'qwen-max': { success: 1, failed: 0, durations: [100] },
    })

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

  it('纯函数：不修改入参对象', () => {
    const input: Record<string, ProviderCallStats> = {
      'qwen-max': { success: 1, failed: 0, durations: [100, 200, 300] },
    }
    const inputSnapshot = JSON.parse(JSON.stringify(input))

    aggregateProviderMetrics(input)

    expect(input).toEqual(inputSnapshot)
  })
})
