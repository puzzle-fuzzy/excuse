import { describe, expect, it } from 'bun:test'
import { MetricsCollector } from '../src'

describe('@excuse/metrics', () => {
  it('记录请求数、延迟与服务端错误', () => {
    const metrics = new MetricsCollector()

    metrics.recordRequest(200, 10)
    metrics.recordRequest(200, 30)
    metrics.recordRequest(500, 50)
    metrics.recordError()

    expect(metrics.snapshot(2, 123)).toEqual({
      requests: {
        total: 3,
        byStatus: {
          200: 2,
          500: 1,
        },
      },
      latency: {
        p50: 30,
        p95: 50,
        p99: 50,
        avgMs: 30,
      },
      sse: {
        onlineUsers: 2,
      },
      generation: {
        byStatus: {},
      },
      providerCalls: {},
      errors: 2,
      uptime: 123,
    })
  })

  it('仅保留配置的延迟窗口', () => {
    const metrics = new MetricsCollector({ latencyWindowSize: 2 })

    metrics.recordRequest(200, 10)
    metrics.recordRequest(200, 30)
    metrics.recordRequest(200, 50)

    expect(metrics.snapshot(0, 0).latency.avgMs).toBe(40)
  })

  it('能够重置计数器', () => {
    const metrics = new MetricsCollector()

    metrics.recordRequest(500, 10)
    metrics.recordError()
    metrics.reset()

    expect(metrics.snapshot(0, 0).requests.total).toBe(0)
    expect(metrics.snapshot(0, 0).errors).toBe(0)
  })

  it('在快照中记录生成任务状态分布', () => {
    const metrics = new MetricsCollector()

    metrics.recordGenerationStatus('processing')
    metrics.recordGenerationStatus('succeeded')
    metrics.recordGenerationStatus('succeeded')
    metrics.recordGenerationStatus('failed')

    expect(metrics.snapshot(0, 0).generation.byStatus).toEqual({
      processing: 1,
      succeeded: 2,
      failed: 1,
    })

    // reset 也会清空生成任务状态分布
    metrics.reset()
    expect(metrics.snapshot(0, 0).generation.byStatus).toEqual({})
  })
})

describe('MetricsCollector.recordProviderCall', () => {
  it('累加 success/failed 计数 + durations 样本', () => {
    const metrics = new MetricsCollector()

    metrics.recordProviderCall('qwen-max', 100, true)
    metrics.recordProviderCall('qwen-max', 200, true)
    metrics.recordProviderCall('qwen-max', 50, false)

    const snap = metrics.snapshot(0, 0)
    expect(snap.providerCalls['qwen-max']).toEqual({
      success: 2,
      failed: 1,
      durations: [100, 200, 50],
    })
  })

  it('不同 model 独立计数', () => {
    const metrics = new MetricsCollector()

    metrics.recordProviderCall('qwen-max', 100, true)
    metrics.recordProviderCall('wanx2.1-t2v-turbo', 5000, true)
    metrics.recordProviderCall('wanx2.1-t2v-turbo', 6000, false)

    const snap = metrics.snapshot(0, 0)
    expect(snap.providerCalls['qwen-max']?.success).toBe(1)
    expect(snap.providerCalls['wanx2.1-t2v-turbo']?.success).toBe(1)
    expect(snap.providerCalls['wanx2.1-t2v-turbo']?.failed).toBe(1)
  })

  it('durations 超过窗口大小自动丢弃最旧样本', () => {
    const metrics = new MetricsCollector({ providerCallWindowSize: 3 })

    for (let i = 1; i <= 5; i++) {
      metrics.recordProviderCall('qwen-max', i * 100, true)
    }

    const snap = metrics.snapshot(0, 0)
    expect(snap.providerCalls['qwen-max']?.durations).toEqual([300, 400, 500])
    // success 计数仍是全部累计（5 次），不受窗口影响
    expect(snap.providerCalls['qwen-max']?.success).toBe(5)
  })

  it('snapshot 返回的 durations 数组与 collector 内部解耦（深拷贝）', () => {
    const metrics = new MetricsCollector()
    metrics.recordProviderCall('qwen-max', 100, true)

    const snap1 = metrics.snapshot(0, 0)
    snap1.providerCalls['qwen-max']!.durations.push(999)

    const snap2 = metrics.snapshot(0, 0)
    expect(snap2.providerCalls['qwen-max']?.durations).toEqual([100])
  })

  it('reset 清空 provider 调用统计', () => {
    const metrics = new MetricsCollector()
    metrics.recordProviderCall('qwen-max', 100, true)
    metrics.reset()

    expect(metrics.snapshot(0, 0).providerCalls).toEqual({})
  })

  it('空 collector snapshot 含 providerCalls: {}', () => {
    const metrics = new MetricsCollector()
    expect(metrics.snapshot(0, 0).providerCalls).toEqual({})
  })
})
