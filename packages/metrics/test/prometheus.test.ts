import type { MetricsSnapshot, PrometheusMetric } from '../src'
import { describe, expect, it } from 'bun:test'
import { serializePrometheus, snapshotToPrometheus } from '../src'

describe('serializePrometheus', () => {
  it('输出单个 counter family 的 HELP / TYPE / 样本', () => {
    const metrics: PrometheusMetric[] = [
      {
        name: 'http_requests_total',
        help: 'Total HTTP requests.',
        type: 'counter',
        samples: [
          { labels: { method: 'GET' }, value: 12 },
          { labels: { method: 'POST' }, value: 34 },
        ],
      },
    ]

    const out = serializePrometheus(metrics)

    expect(out).toContain('# HELP http_requests_total Total HTTP requests.')
    expect(out).toContain('# TYPE http_requests_total counter')
    expect(out).toContain('http_requests_total{method="GET"} 12')
    expect(out).toContain('http_requests_total{method="POST"} 34')
  })

  it('label 按名字字典序输出', () => {
    const out = serializePrometheus([
      {
        name: 'foo',
        help: 'h',
        type: 'gauge',
        samples: [{ labels: { zeta: '1', alpha: '2', mid: '3' }, value: 1 }],
      },
    ])

    expect(out).toContain('foo{alpha="2",mid="3",zeta="1"} 1')
  })

  it('label value 中的 "、\\、换行被转义', () => {
    const out = serializePrometheus([
      {
        name: 'logs',
        help: 'h',
        type: 'gauge',
        samples: [{ labels: { msg: 'a"b\\c\nd' }, value: 1 }],
      },
    ])

    expect(out).toContain('logs{msg="a\\"b\\\\c\\nd"} 1')
  })

  it('数值格式：整数 / 浮点 / 0 / 负数', () => {
    const out = serializePrometheus([
      {
        name: 'm',
        help: 'h',
        type: 'gauge',
        samples: [
          { labels: { t: 'int' }, value: 42 },
          { labels: { t: 'float' }, value: 3.14 },
          { labels: { t: 'zero' }, value: 0 },
          { labels: { t: 'neg' }, value: -7 },
        ],
      },
    ])

    expect(out).toContain('m{t="int"} 42')
    expect(out).toContain('m{t="float"} 3.14')
    expect(out).toContain('m{t="zero"} 0')
    expect(out).toContain('m{t="neg"} -7')
  })

  it('NaN / Infinity 输出 Prometheus 标准记号', () => {
    const out = serializePrometheus([
      {
        name: 'edge',
        help: 'h',
        type: 'gauge',
        samples: [
          { labels: { t: 'nan' }, value: Number.NaN },
          { labels: { t: 'pos' }, value: Number.POSITIVE_INFINITY },
          { labels: { t: 'neg' }, value: Number.NEGATIVE_INFINITY },
        ],
      },
    ])

    expect(out).toContain('edge{t="nan"} NaN')
    expect(out).toContain('edge{t="pos"} +Inf')
    expect(out).toContain('edge{t="neg"} -Inf')
  })

  it('空 samples 仍输出 HELP + TYPE 头部', () => {
    const out = serializePrometheus([
      {
        name: 'empty_metric',
        help: 'no samples yet',
        type: 'counter',
        samples: [],
      },
    ])

    expect(out).toContain('# HELP empty_metric no samples yet')
    expect(out).toContain('# TYPE empty_metric counter')
    // 不应该出现裸 `empty_metric ` 行（无样本）
    expect(out).not.toMatch(/^empty_metric\s/m)
  })

  it('多 family 顺序保持输入顺序', () => {
    const out = serializePrometheus([
      {
        name: 'first',
        help: 'a',
        type: 'counter',
        samples: [{ value: 1 }],
      },
      {
        name: 'second',
        help: 'b',
        type: 'gauge',
        samples: [{ value: 2 }],
      },
      {
        name: 'third',
        help: 'c',
        type: 'counter',
        samples: [{ value: 3 }],
      },
    ])

    const firstIdx = out.indexOf('# HELP first')
    const secondIdx = out.indexOf('# HELP second')
    const thirdIdx = out.indexOf('# HELP third')

    expect(firstIdx).toBeGreaterThan(-1)
    expect(secondIdx).toBeGreaterThan(firstIdx)
    expect(thirdIdx).toBeGreaterThan(secondIdx)
  })

  it('无 label 的样本输出为裸 `name value` 行', () => {
    const out = serializePrometheus([
      {
        name: 'no_labels',
        help: 'h',
        type: 'gauge',
        samples: [{ value: 5 }],
      },
    ])

    expect(out).toContain('no_labels 5')
    expect(out).not.toContain('no_labels{')
  })
})

describe('snapshotToPrometheus', () => {
  const snapshot: MetricsSnapshot = {
    requests: {
      total: 100,
      byStatus: { 200: 90, 500: 10 },
    },
    latency: {
      p50: 100,
      p95: 500,
      p99: 1000,
      avgMs: 200,
    },
    sse: { onlineUsers: 7 },
    generation: { byStatus: { succeeded: 50, failed: 3, processing: 2 } },
    errors: 12,
    uptime: 3600,
  }

  const metrics = snapshotToPrometheus(snapshot)
  const out = serializePrometheus(metrics)

  it('输出 excuse_http_requests_total counter（含 total 裸样本 + status 分桶）', () => {
    expect(out).toContain('# HELP excuse_http_requests_total')
    expect(out).toContain('# TYPE excuse_http_requests_total counter')
    expect(out).toContain('excuse_http_requests_total 100')
    expect(out).toContain('excuse_http_requests_total{status="200"} 90')
    expect(out).toContain('excuse_http_requests_total{status="500"} 10')
  })

  it('latency 转 gauge 并把 ms 转换为 seconds', () => {
    expect(out).toContain('# TYPE excuse_http_latency_seconds gauge')
    expect(out).toContain('excuse_http_latency_seconds{quantile="0.5"} 0.1')
    expect(out).toContain('excuse_http_latency_seconds{quantile="0.95"} 0.5')
    expect(out).toContain('excuse_http_latency_seconds{quantile="0.99"} 1')
    expect(out).toContain('excuse_http_latency_seconds{quantile="avg"} 0.2')
  })

  it('SSE 在线用户数输出为 excuse_sse_online_users', () => {
    expect(out).toContain('excuse_sse_online_users 7')
  })

  it('generation 按 status 分桶输出 excuse_generation_total', () => {
    expect(out).toContain('excuse_generation_total{status="succeeded"} 50')
    expect(out).toContain('excuse_generation_total{status="failed"} 3')
    expect(out).toContain('excuse_generation_total{status="processing"} 2')
  })

  it('errors 输出为 excuse_errors_total', () => {
    expect(out).toContain('excuse_errors_total 12')
  })

  it('uptime 输出为 excuse_uptime_seconds', () => {
    expect(out).toContain('excuse_uptime_seconds 3600')
  })

  it('空 byStatus 不输出 status label 样本（仅保留 total 裸样本）', () => {
    const emptyMetrics = snapshotToPrometheus({
      ...snapshot,
      requests: { total: 0, byStatus: {} },
      generation: { byStatus: {} },
    })
    const emptyOut = serializePrometheus(emptyMetrics)

    // total 样本仍然存在
    expect(emptyOut).toContain('excuse_http_requests_total 0')
    // 不应出现带 status label 的请求样本
    expect(emptyOut).not.toMatch(/excuse_http_requests_total\{status=/)
    // generation family 应该有 HELP+TYPE 但无样本
    expect(emptyOut).toContain('# HELP excuse_generation_total')
    expect(emptyOut).toContain('# TYPE excuse_generation_total counter')
    expect(emptyOut).not.toMatch(/excuse_generation_total\{status=/)
  })
})
