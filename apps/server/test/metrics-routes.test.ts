import type { MetricsSnapshot } from '@excuse/metrics'
import { describe, expect, it, mock } from 'bun:test'
import { Elysia } from 'elysia'
import { createMetricsRoutes, isAllowedIp } from '../src/routes/metrics'
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
  errors: 4,
  uptime: 600,
}

mock.module('../src/services/metrics', () => ({
  getMetrics: mock(() => FIXED_SNAPSHOT),
  recordRequest: mock(() => {}),
  recordError: mock(() => {}),
  recordGenerationStatus: mock(() => {}),
  resetMetrics: mock(() => {}),
}))

mock.module('../src/services/sse-manager', () => ({
  getOnlineUserCount: mock(() => 3),
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

describe('isAllowedIp', () => {
  it('默认回环白名单接受 127.x.x.x', () => {
    expect(isAllowedIp('127.0.0.1', ['127.0.0.0/8'])).toBe(true)
    expect(isAllowedIp('127.255.255.255', ['127.0.0.0/8'])).toBe(true)
  })

  it('默认回环白名单接受 ::1', () => {
    expect(isAllowedIp('::1', ['::1/128'])).toBe(true)
  })

  it('非白名单 IP 拒绝', () => {
    expect(isAllowedIp('8.8.8.8', ['127.0.0.0/8', '::1/128'])).toBe(false)
  })

  it('完整 IPv4 /32 等值匹配', () => {
    expect(isAllowedIp('10.0.0.5', ['10.0.0.5/32'])).toBe(true)
    expect(isAllowedIp('10.0.0.6', ['10.0.0.5/32'])).toBe(false)
  })

  it('无前缀 CIDR 按精确 IP 等值匹配', () => {
    expect(isAllowedIp('10.0.0.5', ['10.0.0.5'])).toBe(true)
    expect(isAllowedIp('10.0.0.6', ['10.0.0.5'])).toBe(false)
  })

  it('不支持的 IPv4 段（/24）→ 即使命中前缀也拒绝', () => {
    expect(isAllowedIp('10.0.0.5', ['10.0.0.0/24'])).toBe(false)
  })

  it('空字符串 IP 拒绝', () => {
    expect(isAllowedIp('', ['127.0.0.0/8'])).toBe(false)
  })
})
