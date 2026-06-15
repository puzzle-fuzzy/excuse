import type { MetricsSnapshot } from '@excuse/metrics'
import { describe, expect, it, mock } from 'bun:test'
import { Elysia } from 'elysia'
import { createMetricsRoutes } from '../src/routes/metrics'
import { makeTestConfig } from './helpers/test-factory'

/** 结构类型 — 避免与 Elysia 携带路由元数据的全泛型实例冲突 */
interface Handleable {
  handle: (req: Request) => Promise<Response>
}

/**
 * `/metrics` 端点测试
 *
 * 用 `app.handle(new Request(...))` 直接构造请求，便于通过 `x-forwarded-for` 注入 remote IP。
 * Mock `getMetrics` 返回固定 snapshot，避免依赖运行时状态。
 */

const FIXED_SNAPSHOT: MetricsSnapshot = {
  requests: {
    total: 42,
    byStatus: { 200: 38, 500: 4 },
  },
  latency: {
    p50: 100,
    p95: 500,
    p99: 1000,
    avgMs: 200,
  },
  sse: { onlineUsers: 3 },
  generation: { byStatus: { succeeded: 7, failed: 1 } },
  providerCalls: {
    'qwen-max': { success: 5, failed: 1, durations: [1000, 1100, 1200, 1300, 1400, 500] },
    'wanx2.1-t2v-turbo': { success: 2, failed: 0, durations: [5000, 6000] },
    'failed-only-model': { success: 0, failed: 3, durations: [] },
  },
  errors: 4,
  uptime: 600,
}

mock.module('../src/services/metrics', () => ({
  getMetrics: mock(() => FIXED_SNAPSHOT),
  recordRequest: mock(() => {}),
  recordError: mock(() => {}),
  recordGenerationStatus: mock(() => {}),
  recordProviderCall: mock(() => {}),
  resetMetrics: mock(() => {}),
}))

mock.module('../src/services/sse-manager', () => ({
  getOnlineUserCount: mock(() => 3),
}))

const DB_FIXTURE_PHASE = [
  { phase: 'analyze', status: 'succeeded', count: 5, durationP50Ms: 1000, durationP95Ms: 2000, durationAvgMs: 1200 },
  { phase: 'analyze', status: 'failed', count: 1, durationP50Ms: 0, durationP95Ms: 0, durationAvgMs: 0 },
  { phase: 'characters', status: 'succeeded', count: 3, durationP50Ms: 3000, durationP95Ms: 5000, durationAvgMs: 3500 },
]
const DB_FIXTURE_QUEUE = [
  { domain: 'canvas', status: 'queued', count: 3 },
  { domain: 'canvas', status: 'running', count: 1 },
  { domain: 'generate', status: 'queued', count: 2 },
]

mock.module('@excuse/db', () => ({
  getCanvasPhaseStats: mock(() => Promise.resolve(DB_FIXTURE_PHASE)),
  getTaskQueueStats: mock(() => Promise.resolve(DB_FIXTURE_QUEUE)),
}))

function buildApp(overrides: Parameters<typeof makeTestConfig>[0] = {}) {
  const config = makeTestConfig(overrides)
  return new Elysia().use(createMetricsRoutes(config))
}

function fetchMetrics(app: Handleable, init: { ip?: string, auth?: string } = {}) {
  const headers: Record<string, string> = {}
  if (init.ip)
    headers['x-forwarded-for'] = init.ip
  if (init.auth !== undefined)
    headers.authorization = init.auth
  return app.handle(new Request('http://localhost/metrics', { headers }))
}

describe('GET /metrics', () => {
  it('回环 IP + 无 token 配置 → 200 + Prometheus 格式', async () => {
    const res = await fetchMetrics(buildApp(), { ip: '127.0.0.1' })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/plain')
    expect(res.headers.get('content-type')).toContain('version=0.0.4')

    const body = await res.text()
    expect(body).toContain('# HELP excuse_http_requests_total')
    expect(body).toContain('# TYPE excuse_http_requests_total counter')
    expect(body).toContain('excuse_http_requests_total{status="200"} 38')
    expect(body).toContain('excuse_http_requests_total{status="500"} 4')
    expect(body).toContain('excuse_http_latency_seconds{quantile="0.5"} 0.1')
    expect(body).toContain('excuse_sse_online_users 3')
    expect(body).toContain('excuse_generation_total{status="succeeded"} 7')
    expect(body).toContain('excuse_errors_total 4')
    expect(body).toContain('excuse_uptime_seconds 600')
  })

  it('::1 IPv6 回环 → 200', async () => {
    const res = await fetchMetrics(buildApp(), { ip: '::1' })
    expect(res.status).toBe(200)
  })

  it('非回环 IP + 无 token 配置 → 403', async () => {
    const res = await fetchMetrics(buildApp(), { ip: '1.2.3.4' })
    expect(res.status).toBe(403)
    expect(await res.text()).toBe('Forbidden')
  })

  it('非回环 IP + token 配置 + 正确 Bearer → 200', async () => {
    const res = await fetchMetrics(
      buildApp({ metricsAccessToken: 'secret-token' }),
      { ip: '1.2.3.4', auth: 'Bearer secret-token' },
    )
    expect(res.status).toBe(200)
    expect((await res.text()).length).toBeGreaterThan(0)
  })

  it('非回环 IP + token 配置 + 错误 Bearer → 401', async () => {
    const res = await fetchMetrics(
      buildApp({ metricsAccessToken: 'secret-token' }),
      { ip: '1.2.3.4', auth: 'Bearer wrong-token' },
    )
    expect(res.status).toBe(401)
  })

  it('非回环 IP + token 配置 + 缺 Authorization → 401', async () => {
    const res = await fetchMetrics(
      buildApp({ metricsAccessToken: 'secret-token' }),
      { ip: '1.2.3.4' },
    )
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain('Bearer')
  })

  it('自定义 allowedCidrs 放行非回环 IP', async () => {
    const res = await fetchMetrics(
      buildApp({ metricsAllowedCidrs: ['10.0.0.5/32'] }),
      { ip: '10.0.0.5' },
    )
    expect(res.status).toBe(200)
  })

  it('未带 x-forwarded-for → 403（无法判定来源 IP 时拒绝）', async () => {
    const app = buildApp()
    const res = await app.handle(new Request('http://localhost/metrics'))
    expect(res.status).toBe(403)
  })

  it('输出包含全部核心 metric family 的 HELP + TYPE', async () => {
    const res = await fetchMetrics(buildApp(), { ip: '127.0.0.1' })
    const body = await res.text()
    for (const name of [
      'excuse_http_requests_total',
      'excuse_http_latency_seconds',
      'excuse_sse_online_users',
      'excuse_generation_total',
      'excuse_errors_total',
      'excuse_uptime_seconds',
    ]) {
      expect(body).toContain(`# HELP ${name}`)
      expect(body).toMatch(new RegExp(`# TYPE ${name} (counter|gauge)`))
    }
  })
})

describe('GET /metrics — DB-derived metrics', () => {
  it('输出含 excuse_canvas_phase_total{phase="analyze",status="succeeded"} 5', async () => {
    const res = await fetchMetrics(buildApp(), { ip: '127.0.0.1' })
    const body = await res.text()

    expect(body).toContain('# HELP excuse_canvas_phase_total')
    expect(body).toContain('# TYPE excuse_canvas_phase_total counter')
    expect(body).toContain('excuse_canvas_phase_total{phase="analyze",status="succeeded"} 5')
    expect(body).toContain('excuse_canvas_phase_total{phase="analyze",status="failed"} 1')
    expect(body).toContain('excuse_canvas_phase_total{phase="characters",status="succeeded"} 3')
  })

  it('输出含 excuse_canvas_phase_duration_seconds quantile 样本', async () => {
    const res = await fetchMetrics(buildApp(), { ip: '127.0.0.1' })
    const body = await res.text()

    expect(body).toContain('# HELP excuse_canvas_phase_duration_seconds')
    expect(body).toContain('# TYPE excuse_canvas_phase_duration_seconds gauge')
    expect(body).toContain('excuse_canvas_phase_duration_seconds{phase="analyze",quantile="0.5"} 1')
    expect(body).toContain('excuse_canvas_phase_duration_seconds{phase="analyze",quantile="0.95"} 2')
    expect(body).toContain('excuse_canvas_phase_duration_seconds{phase="analyze",quantile="avg"} 1.2')
    // failed phase 不出现在 duration 里
    expect(body).not.toContain('phase="analyze",quantile="0.5"} 0')
  })

  it('输出含 excuse_task_queue_depth{domain="canvas",status="queued"} 3', async () => {
    const res = await fetchMetrics(buildApp(), { ip: '127.0.0.1' })
    const body = await res.text()

    expect(body).toContain('# HELP excuse_task_queue_depth')
    expect(body).toContain('# TYPE excuse_task_queue_depth gauge')
    expect(body).toContain('excuse_task_queue_depth{domain="canvas",status="queued"} 3')
    expect(body).toContain('excuse_task_queue_depth{domain="canvas",status="running"} 1')
    expect(body).toContain('excuse_task_queue_depth{domain="generate",status="queued"} 2')
  })

  it('DB 异常兜底：既有 in-memory metric 仍正常输出', async () => {
    const failMock = mock(() => Promise.reject(new Error('DB down')))
    mock.module('@excuse/db', () => ({
      getCanvasPhaseStats: failMock,
      getTaskQueueStats: failMock,
    }))

    const res = await fetchMetrics(buildApp(), { ip: '127.0.0.1' })
    const body = await res.text()

    // 既有 in-memory family 完好
    expect(body).toContain('# HELP excuse_http_requests_total')
    expect(body).toContain('# HELP excuse_http_latency_seconds')
    expect(body).toContain('# HELP excuse_sse_online_users')
    expect(body).toContain('# HELP excuse_generation_total')
    expect(body).toContain('# HELP excuse_errors_total')
    expect(body).toContain('# HELP excuse_uptime_seconds')

    // DB-derived family 仍有 HELP+TYPE 头部（空 samples）
    expect(body).toContain('# HELP excuse_canvas_phase_total')
    expect(body).toContain('# TYPE excuse_canvas_phase_total counter')
    expect(body).toContain('# HELP excuse_task_queue_depth')
    expect(body).toContain('# TYPE excuse_task_queue_depth gauge')

    // 恢复正常 mock 供后续用例
    mock.module('@excuse/db', () => ({
      getCanvasPhaseStats: mock(() => Promise.resolve(DB_FIXTURE_PHASE)),
      getTaskQueueStats: mock(() => Promise.resolve(DB_FIXTURE_QUEUE)),
    }))
  })

  it('既有 in-memory family 在新输出中全部保留', async () => {
    const res = await fetchMetrics(buildApp(), { ip: '127.0.0.1' })
    const body = await res.text()
    for (const name of [
      'excuse_http_requests_total',
      'excuse_http_latency_seconds',
      'excuse_sse_online_users',
      'excuse_generation_total',
      'excuse_errors_total',
      'excuse_uptime_seconds',
    ]) {
      expect(body).toContain(`# HELP ${name}`)
      expect(body).toMatch(new RegExp(`# TYPE ${name} (counter|gauge)`))
    }
  })
})

describe('GET /metrics — provider metrics', () => {
  it('输出含 excuse_provider_calls_total 按 model/status 分桶', async () => {
    const res = await fetchMetrics(buildApp(), { ip: '127.0.0.1' })
    const body = await res.text()

    expect(body).toContain('# HELP excuse_provider_calls_total')
    expect(body).toContain('# TYPE excuse_provider_calls_total counter')

    // qwen-max: 5 成功 + 1 失败
    expect(body).toContain('excuse_provider_calls_total{model="qwen-max",status="success"} 5')
    expect(body).toContain('excuse_provider_calls_total{model="qwen-max",status="failed"} 1')
    // wanx2.1-t2v-turbo: 2 成功 + 0 失败
    expect(body).toContain('excuse_provider_calls_total{model="wanx2.1-t2v-turbo",status="success"} 2')
    expect(body).toContain('excuse_provider_calls_total{model="wanx2.1-t2v-turbo",status="failed"} 0')
    // failed-only-model: 0 成功 + 3 失败
    expect(body).toContain('excuse_provider_calls_total{model="failed-only-model",status="success"} 0')
    expect(body).toContain('excuse_provider_calls_total{model="failed-only-model",status="failed"} 3')
  })

  it('输出含 excuse_provider_latency_seconds p50/p95/avg 样本', async () => {
    const res = await fetchMetrics(buildApp(), { ip: '127.0.0.1' })
    const body = await res.text()

    expect(body).toContain('# HELP excuse_provider_latency_seconds')
    expect(body).toContain('# TYPE excuse_provider_latency_seconds gauge')

    // qwen-max durations: [1000, 1100, 1200, 1300, 1400, 500] → sorted: [500, 1000, 1100, 1200, 1300, 1400] (n=6)
    // p50 nearest-rank: idx = ceil(0.5*6)-1 = 2 → 1100ms → 1.1s
    // p95 nearest-rank: idx = ceil(0.95*6)-1 = 5 → 1400ms → 1.4s
    // avg = 6500/6 ≈ 1083.33ms → 1.083333s
    expect(body).toContain('excuse_provider_latency_seconds{model="qwen-max",quantile="0.5"} 1.1')
    expect(body).toContain('excuse_provider_latency_seconds{model="qwen-max",quantile="0.95"} 1.4')
    expect(body).toContain('excuse_provider_latency_seconds{model="qwen-max",quantile="avg"}')

    // wanx2.1-t2v-turbo durations: [5000, 6000] → p50=p95=avg=5000/6000/5500 → 5/6/5.5
    expect(body).toContain('excuse_provider_latency_seconds{model="wanx2.1-t2v-turbo",quantile="0.5"} 5')
    expect(body).toContain('excuse_provider_latency_seconds{model="wanx2.1-t2v-turbo",quantile="0.95"} 6')
  })

  it('空 durations 的 model 不输出 latency 样本（calls 仍输出）', async () => {
    const res = await fetchMetrics(buildApp(), { ip: '127.0.0.1' })
    const body = await res.text()

    // failed-only-model 在 calls 中
    expect(body).toContain('excuse_provider_calls_total{model="failed-only-model"')
    // 但 latency 样本不包含 failed-only-model
    expect(body).not.toMatch(/excuse_provider_latency_seconds\{model="failed-only-model"/)
  })
})
