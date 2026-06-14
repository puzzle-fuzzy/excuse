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
