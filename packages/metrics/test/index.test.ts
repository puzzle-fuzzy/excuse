import { describe, expect, it } from 'bun:test'
import { MetricsCollector } from '../src'

describe('@excuse/metrics', () => {
  it('records request counts, latency, and server errors', () => {
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

  it('keeps only the configured latency window', () => {
    const metrics = new MetricsCollector({ latencyWindowSize: 2 })

    metrics.recordRequest(200, 10)
    metrics.recordRequest(200, 30)
    metrics.recordRequest(200, 50)

    expect(metrics.snapshot(0, 0).latency.avgMs).toBe(40)
  })

  it('can reset counters', () => {
    const metrics = new MetricsCollector()

    metrics.recordRequest(500, 10)
    metrics.recordError()
    metrics.reset()

    expect(metrics.snapshot(0, 0).requests.total).toBe(0)
    expect(metrics.snapshot(0, 0).errors).toBe(0)
  })

  it('records a generation status breakdown in the snapshot', () => {
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

    // reset clears the generation breakdown too
    metrics.reset()
    expect(metrics.snapshot(0, 0).generation.byStatus).toEqual({})
  })
})
