import type { ProviderCallStats } from '@excuse/metrics'
import type { WorkerHealthState } from '../src/health'
import { describe, expect, it } from 'bun:test'
import { handleHealthRequest } from '../src/health'

/** 构造默认 worker 健康状态，测试按需覆盖。 */
function makeState(overrides: Partial<WorkerHealthState> = {}): WorkerHealthState {
  return {
    isPolling: true,
    lastPollAt: new Date('2026-06-15T00:00:00.000Z'),
    lastPollError: null,
    totalTasksProcessed: 4,
    startedAt: new Date('2026-06-15T00:00:00.000Z'),
    workerId: 'worker-local-1234',
    currentTaskId: 'task-abc',
    tasksClaimed: 5,
    orphanSweeps: 2,
    lastSweepAt: null,
    ...overrides,
  }
}

function metricsRequest(opts: { ip?: string, auth?: string } = {}): Request {
  const headers: Record<string, string> = {}
  if (opts.ip)
    headers['x-forwarded-for'] = opts.ip
  if (opts.auth !== undefined)
    headers.authorization = opts.auth
  return new Request('http://worker/metrics', { headers })
}

const FIXED_NOW = new Date('2026-06-15T01:00:00.000Z').getTime()

describe('handleHealthRequest — /health', () => {
  it('GET /health 返回 200 + JSON 运行状态', async () => {
    const state = makeState({ startedAt: new Date('2026-06-15T00:00:00.000Z') })
    const res = handleHealthRequest(new Request('http://worker/health'), state, { now: FIXED_NOW })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = await res.json()
    expect(body.workerId).toBe('worker-local-1234')
    expect(body.uptime).toBe(3600)
    expect(body.tasksClaimed).toBe(5)
    expect(body.currentTaskId).toBe('task-abc')
  })

  it('非 GET /health → 404', () => {
    const res = handleHealthRequest(new Request('http://worker/health', { method: 'POST' }), makeState())
    expect(res.status).toBe(404)
  })

  it('未知路径 → 404', () => {
    const res = handleHealthRequest(new Request('http://worker/unknown'), makeState())
    expect(res.status).toBe(404)
  })
})

describe('handleHealthRequest — /metrics 访问策略', () => {
  it('回环 IP + 无 token 配置 → 200 + Prometheus 格式', async () => {
    const res = handleHealthRequest(metricsRequest({ ip: '127.0.0.1' }), makeState(), { now: FIXED_NOW })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/plain')
    expect(res.headers.get('content-type')).toContain('version=0.0.4')
  })

  it('::1 IPv6 回环 → 200', () => {
    const res = handleHealthRequest(metricsRequest({ ip: '::1' }), makeState(), { now: FIXED_NOW })
    expect(res.status).toBe(200)
  })

  it('非回环 IP + 无 token 配置 → 403 Forbidden', async () => {
    const res = handleHealthRequest(metricsRequest({ ip: '1.2.3.4' }), makeState())
    expect(res.status).toBe(403)
    expect(await res.text()).toBe('Forbidden')
  })

  it('非回环 IP + token 配置 + 正确 Bearer → 200', () => {
    const res = handleHealthRequest(
      metricsRequest({ ip: '1.2.3.4', auth: 'Bearer secret-token' }),
      makeState(),
      { metricsAccessToken: 'secret-token' },
    )
    expect(res.status).toBe(200)
  })

  it('非回环 IP + token 配置 + 错误 Bearer → 401 + www-authenticate', () => {
    const res = handleHealthRequest(
      metricsRequest({ ip: '1.2.3.4', auth: 'Bearer wrong' }),
      makeState(),
      { metricsAccessToken: 'secret-token' },
    )
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain('Bearer')
  })

  it('未带 x-forwarded-for → 403', () => {
    const res = handleHealthRequest(new Request('http://worker/metrics'), makeState())
    expect(res.status).toBe(403)
  })
})

describe('handleHealthRequest — /metrics 输出内容', () => {
  const WORKER_FAMILIES = [
    'excuse_worker_uptime_seconds',
    'excuse_worker_polling',
    'excuse_worker_busy',
    'excuse_worker_tasks_claimed_total',
    'excuse_worker_tasks_processed_total',
    'excuse_worker_orphan_sweeps_total',
    'excuse_worker_last_poll_ok',
    'excuse_worker_last_poll_timestamp_seconds',
  ]

  it('输出全部 8 个 worker family 的 HELP + TYPE', async () => {
    const res = handleHealthRequest(metricsRequest({ ip: '127.0.0.1' }), makeState(), { now: FIXED_NOW })
    const body = await res.text()
    for (const name of WORKER_FAMILIES) {
      expect(body).toContain(`# HELP ${name}`)
      expect(body).toMatch(new RegExp(`# TYPE ${name} (counter|gauge)`))
    }
  })

  it('uptime 用注入的 now 计算（floor 秒）', async () => {
    const startedAt = new Date('2026-06-15T00:00:00.000Z')
    const res = handleHealthRequest(
      metricsRequest({ ip: '127.0.0.1' }),
      makeState({ startedAt }),
      { now: new Date('2026-06-15T02:30:15.000Z').getTime() },
    )
    const body = await res.text()
    expect(body).toContain('excuse_worker_uptime_seconds 9015')
  })

  it('注入 providerCallsSnapshot → 输出 provider 指标', async () => {
    const snapshot: Record<string, ProviderCallStats> = {
      'qwen-max': { success: 2, failed: 0, durations: [1000, 2000] },
    }
    const res = handleHealthRequest(
      metricsRequest({ ip: '127.0.0.1' }),
      makeState(),
      { now: FIXED_NOW, providerCallsSnapshot: () => snapshot },
    )
    const body = await res.text()
    expect(body).toContain('# HELP excuse_provider_calls_total')
    expect(body).toContain('excuse_provider_calls_total{model="qwen-max",status="success"} 2')
    expect(body).toContain('excuse_provider_latency_seconds{model="qwen-max",quantile="0.5"}')
  })

  it('无 providerCallsSnapshot 时 provider family 仅输出 HELP/TYPE 头（无样本行），worker family 完整', async () => {
    const res = handleHealthRequest(metricsRequest({ ip: '127.0.0.1' }), makeState(), { now: FIXED_NOW })
    const body = await res.text()
    // provider family 头部仍在（与 server /metrics 一致：空 samples 也输出 HELP/TYPE）
    expect(body).toContain('# HELP excuse_provider_calls_total')
    expect(body).toContain('# TYPE excuse_provider_calls_total counter')
    // 但无 {model=...} 样本行
    expect(body).not.toMatch(/excuse_provider_calls_total\{model=/)
    // worker family 完整
    expect(body).toContain('# HELP excuse_worker_uptime_seconds')
  })

  it('busy / polling 反映状态', async () => {
    const busy = handleHealthRequest(metricsRequest({ ip: '127.0.0.1' }), makeState({ isPolling: true, currentTaskId: 'x' }), { now: FIXED_NOW })
    const busyBody = await busy.text()
    expect(busyBody).toContain('excuse_worker_polling 1')
    expect(busyBody).toContain('excuse_worker_busy 1')

    const idle = handleHealthRequest(metricsRequest({ ip: '127.0.0.1' }), makeState({ isPolling: false, currentTaskId: null }), { now: FIXED_NOW })
    const idleBody = await idle.text()
    expect(idleBody).toContain('excuse_worker_polling 0')
    expect(idleBody).toContain('excuse_worker_busy 0')
  })

  it('last_poll_ok：有 error → 0', async () => {
    const res = handleHealthRequest(
      metricsRequest({ ip: '127.0.0.1' }),
      makeState({ lastPollAt: new Date('2026-06-15T00:00:00.000Z'), lastPollError: 'ECONNREFUSED' }),
      { now: FIXED_NOW },
    )
    const body = await res.text()
    expect(body).toContain('excuse_worker_last_poll_ok 0')
  })
})

describe('handleHealthRequest — /provider-calls', () => {
  function providerCallsRequest(opts: { ip?: string, auth?: string } = {}): Request {
    const headers: Record<string, string> = {}
    if (opts.ip)
      headers['x-forwarded-for'] = opts.ip
    if (opts.auth !== undefined)
      headers.authorization = opts.auth
    return new Request('http://worker/provider-calls', { headers })
  }

  it('回环 IP + 无 token → 200 + JSON providerCalls 快照', async () => {
    const snapshot: Record<string, ProviderCallStats> = {
      'paraformer-v2': { success: 3, failed: 1, durations: [800, 1200, 1500, 2000] },
    }
    const res = handleHealthRequest(
      providerCallsRequest({ ip: '127.0.0.1' }),
      makeState(),
      { providerCallsSnapshot: () => snapshot },
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = await res.json()
    expect(body.workerId).toBe('worker-local-1234')
    expect(body.providerCalls).toEqual(snapshot)
  })

  it('无 providerCallsSnapshot → 空 providerCalls', async () => {
    const res = handleHealthRequest(providerCallsRequest({ ip: '127.0.0.1' }), makeState())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.providerCalls).toEqual({})
  })

  it('非回环 IP + 无 token → 403', async () => {
    const res = handleHealthRequest(providerCallsRequest({ ip: '1.2.3.4' }), makeState())
    expect(res.status).toBe(403)
  })

  it('非回环 IP + token 配置 + 正确 Bearer → 200', async () => {
    const res = handleHealthRequest(
      providerCallsRequest({ ip: '1.2.3.4', auth: 'Bearer secret-token' }),
      makeState(),
      { metricsAccessToken: 'secret-token' },
    )
    expect(res.status).toBe(200)
  })

  it('非回环 IP + token 配置 + 错误 Bearer → 401', async () => {
    const res = handleHealthRequest(
      providerCallsRequest({ ip: '1.2.3.4', auth: 'Bearer wrong' }),
      makeState(),
      { metricsAccessToken: 'secret-token' },
    )
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain('Bearer')
  })

  it('非 GET → 404', () => {
    const res = handleHealthRequest(
      new Request('http://worker/provider-calls', { method: 'POST' }),
      makeState(),
    )
    expect(res.status).toBe(404)
  })
})
