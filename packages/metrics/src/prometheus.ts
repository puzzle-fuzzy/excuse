import type { MetricsSnapshot } from './index'
import { aggregateProviderMetrics } from './provider-derived'

/**
 * Prometheus metric family 描述
 *
 * 一个 family 对应 Prometheus exposition format 中的「一组同 name 的样本」，
 * 序列化时先输出 `# HELP` + `# TYPE` 头部，再逐行输出 `samples`。
 */
export interface PrometheusMetric {
  /** metric 名称，匹配 `[a-zA-Z_:][a-zA-Z0-9_:]*` */
  name: string
  /** 帮助文本，写入 `# HELP` 行 */
  help: string
  /** 类型：counter / gauge / histogram / summary */
  type: 'counter' | 'gauge' | 'histogram' | 'summary'
  /** 样本列表；空数组时仅输出 HELP + TYPE 头部 */
  samples: Array<{
    /** label 集合；省略则输出裸 `name value` 行 */
    labels?: Record<string, string | number>
    /** 样本数值 */
    value: number
  }>
}

/**
 * 把 PrometheusMetric[] 序列化为 Prometheus text exposition format（v0.0.4）。
 *
 * 规则：
 * - 每个 family 先写 `# HELP name help` + `# TYPE name type`，再逐行写样本。
 * - 同一 family 的样本若带 labels，按 label **name 字典序**输出（便于客户端缓存命中）。
 * - label value 转义：`"` → `\"`、`\` → `\\`、`\n` → `\\n`。
 * - 数值：NaN/Infinity 用 Prometheus 标准写法（`NaN` / `+Inf` / `-Inf`）；其他直接用 `String(value)`。
 * - family 之间空一行分隔，便于肉眼阅读（Prometheus parser 不要求）。
 * - 纯函数：无副作用、无 IO，仅靠入参推导输出字符串。
 */
export function serializePrometheus(metrics: PrometheusMetric[]): string {
  const blocks: string[] = []

  for (const metric of metrics) {
    const lines: string[] = []
    lines.push(`# HELP ${metric.name} ${metric.help}`)
    lines.push(`# TYPE ${metric.name} ${metric.type}`)

    for (const sample of metric.samples) {
      const labelPart = formatLabels(sample.labels)
      const valuePart = formatValue(sample.value)
      lines.push(`${metric.name}${labelPart} ${valuePart}`)
    }

    blocks.push(lines.join('\n'))
  }

  return `${blocks.join('\n\n')}\n`
}

/**
 * 把 MetricsSnapshot 转成 PrometheusMetric[]，方便 route 层直接调 `serializePrometheus`。
 *
 * 映射策略（metric name 统一加 `excuse_` 前缀）：
 * - `requests.total` + `requests.byStatus{status=...}` → counter `excuse_http_requests_total`
 *   - 注意：total 与 byStatus 合并到同一 family 的多个 sample；
 *     total 输出为裸 `excuse_http_requests_total <total>`，byStatus 各输出一条带 `status` label 的样本。
 * - `latency.{p50,p95,p99,avgMs}` → gauge `excuse_http_latency_seconds{quantile=...}`（ms → s）
 * - `sse.onlineUsers` → gauge `excuse_sse_online_users`
 * - `generation.byStatus{status=...}` → counter `excuse_generation_total{status=...}`
 * - `errors` → counter `excuse_errors_total`
 * - `uptime` → gauge `excuse_uptime_seconds`
 *
 * 输出顺序固定（不依赖 Object key 顺序），便于下游测试断言稳定。
 */
export function snapshotToPrometheus(snapshot: MetricsSnapshot): PrometheusMetric[] {
  const requestSamples: PrometheusMetric['samples'] = [
    { value: snapshot.requests.total },
  ]
  for (const [code, count] of Object.entries(snapshot.requests.byStatus)) {
    requestSamples.push({ labels: { status: code }, value: count })
  }

  const generationSamples: PrometheusMetric['samples'] = []
  for (const [status, count] of Object.entries(snapshot.generation.byStatus)) {
    generationSamples.push({ labels: { status }, value: count })
  }

  return [
    {
      name: 'excuse_http_requests_total',
      help: 'Total HTTP requests received by the server (counter).',
      type: 'counter',
      samples: requestSamples,
    },
    {
      name: 'excuse_http_latency_seconds',
      help: 'HTTP request latency in seconds, sliding-window quantiles (p50/p95/p99/avg).',
      type: 'gauge',
      samples: [
        { labels: { quantile: '0.5' }, value: msToSeconds(snapshot.latency.p50) },
        { labels: { quantile: '0.95' }, value: msToSeconds(snapshot.latency.p95) },
        { labels: { quantile: '0.99' }, value: msToSeconds(snapshot.latency.p99) },
        { labels: { quantile: 'avg' }, value: msToSeconds(snapshot.latency.avgMs) },
      ],
    },
    {
      name: 'excuse_sse_online_users',
      help: 'Current number of online users with an active SSE connection.',
      type: 'gauge',
      samples: [{ value: snapshot.sse.onlineUsers }],
    },
    {
      name: 'excuse_generation_total',
      help: 'Generation task counts observed in the server process, by status.',
      type: 'counter',
      samples: generationSamples,
    },
    {
      name: 'excuse_errors_total',
      help: 'Total errors observed (explicit recordError() calls + HTTP 5xx responses).',
      type: 'counter',
      samples: [{ value: snapshot.errors }],
    },
    {
      name: 'excuse_uptime_seconds',
      help: 'Server process uptime in seconds.',
      type: 'gauge',
      samples: [{ value: snapshot.uptime }],
    },
    ...aggregateProviderMetrics(snapshot.providerCalls),
  ]
}

// ─── 内部 helper ──────────────────────────────────────────────────────────

function formatLabels(labels: Record<string, string | number> | undefined): string {
  if (!labels)
    return ''
  const keys = Object.keys(labels).sort()
  if (keys.length === 0)
    return ''
  const pairs = keys.map(k => `${k}="${escapeLabelValue(String(labels[k]))}"`)
  return `{${pairs.join(',')}}`
}

function escapeLabelValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/"/g, '\\"')
}

function formatValue(value: number): string {
  if (Number.isNaN(value))
    return 'NaN'
  if (value === Infinity)
    return '+Inf'
  if (value === -Infinity)
    return '-Inf'
  return String(value)
}

function msToSeconds(ms: number): number {
  return ms / 1000
}
