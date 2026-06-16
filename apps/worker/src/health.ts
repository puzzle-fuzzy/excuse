import type { ProviderCallStats } from '@excuse/metrics'
import { aggregateProviderMetrics, aggregateWorkerMetrics, evaluateMetricsAccess, serializePrometheus } from '@excuse/metrics'
import { createLogger } from '@excuse/shared'

const logger = createLogger('worker-health')

/** Worker 运行时状态 — 由主循环更新 */
export interface WorkerHealthState {
  isPolling: boolean
  lastPollAt: Date | null
  lastPollError: string | null
  totalTasksProcessed: number
  startedAt: Date
  /** Worker 标识 */
  workerId: string
  /** 当前正在执行的任务 ID */
  currentTaskId: string | null
  /** 通过 tasks 表 claim 的任务总数 */
  tasksClaimed: number
  /** orphan sweep 运行次数 */
  orphanSweeps: number
  /** 最近一次 sweep 时间 */
  lastSweepAt: Date | null
}

/**
 * health / metrics 请求处理选项。
 *
 * - `now`：注入当前时间（ms），测试用；缺省 `Date.now()`。
 * - `providerCallsSnapshot`：返回 worker 进程内 provider 调用快照，供 `/metrics` 序列化。
 * - `metricsAllowedCidrs` / `metricsAccessToken`：`/metrics` 访问策略，与 server `/metrics` 一致。
 * - `readyStaleMs`：`/health/ready` 判定「轮询停滞」的阈值（ms）。最近一次成功 poll 距今
 *   超过该值 → 视为轮询循环卡死，ready 返回 503。默认 120s；worker 启动时按
 *   `pollIntervalMs * 4` 注入，确保长间隔配置下不误判。
 */
export interface HealthHandlerOptions {
  now?: number
  providerCallsSnapshot?: () => Record<string, ProviderCallStats>
  metricsAllowedCidrs?: string[]
  metricsAccessToken?: string
  readyStaleMs?: number
}

const METRICS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8'

/**
 * 纯请求处理函数 — 不绑端口，便于单测直接调用。
 *
 * 路由：
 * - `GET /health`：返回 JSON 格式的 worker 运行状态（行为与重构前一致）。
 * - `GET /health/live`：liveness 探针 — 进程能响应即 200，不依赖 DB（K8s 据此判断是否重启）。
 * - `GET /health/ready`：readiness 探针 — 最近 poll 失败（lastPollError）或轮询停滞
 *   （lastPollAt 超过 readyStaleMs）时返回 503，供负载均衡摘除流量但不重启。
 *   前者覆盖「DB claim 失败」（ECONNREFUSED / 表不存在等致命错误，worker 已 break 循环）；
 *   后者覆盖「轮询循环卡死但进程未崩」。
 * - `GET /metrics`：返回 Prometheus text exposition 格式的进程指标
 *   （provider 调用统计 + worker 运行时 gauge/counter）。访问策略与 server `/metrics` 共用。
 * - `GET /provider-calls`：返回 JSON 格式的 provider 调用统计原始快照（keyed by model，
 *   含 success/failed 计数 + durations 原始样本），供 server admin 后台跨进程聚合
 *   （server 进程 fetch 后与自身快照 `mergeProviderCalls`，得到 server+worker 合并的 p50/p95）。
 *   访问策略与 `/metrics` 共用。
 * - 其他：404。
 */
export function handleHealthRequest(req: Request, state: WorkerHealthState, options: HealthHandlerOptions = {}): Response {
  const url = new URL(req.url)

  if (req.method === 'GET' && url.pathname === '/health') {
    const now = options.now ?? Date.now()
    return Response.json({
      status: state.isPolling ? 'polling' : 'idle',
      workerId: state.workerId,
      uptime: Math.floor((now - state.startedAt.getTime()) / 1000),
      lastPollAt: state.lastPollAt?.toISOString() ?? null,
      lastPollError: state.lastPollError,
      totalTasksProcessed: state.totalTasksProcessed,
      currentTaskId: state.currentTaskId,
      tasksClaimed: state.tasksClaimed,
      orphanSweeps: state.orphanSweeps,
      lastSweepAt: state.lastSweepAt?.toISOString() ?? null,
    })
  }

  // liveness：进程能响应即 200，不依赖 DB。用于区分「进程卡死」与「下游故障」。
  if (req.method === 'GET' && url.pathname === '/health/live') {
    return Response.json({ status: 'ok' })
  }

  // readiness：最近 poll 失败或轮询停滞 → 503，负载均衡摘除流量但不重启。
  if (req.method === 'GET' && url.pathname === '/health/ready') {
    const now = options.now ?? Date.now()
    const staleMs = options.readyStaleMs ?? 120_000

    if (state.lastPollError) {
      return Response.json(
        { status: 'not ready', reason: 'poll_error', detail: state.lastPollError },
        { status: 503 },
      )
    }

    if (state.lastPollAt === null) {
      // 启动后从未成功 poll：给 startup grace（staleMs），超过才判不就绪
      const sinceStart = now - state.startedAt.getTime()
      if (sinceStart > staleMs) {
        return Response.json(
          { status: 'not ready', reason: 'never_polled', uptime: Math.floor(sinceStart / 1000) },
          { status: 503 },
        )
      }
      return Response.json({ status: 'starting', reason: 'no_poll_yet' })
    }

    const sincePoll = now - state.lastPollAt.getTime()
    if (sincePoll > staleMs) {
      return Response.json(
        { status: 'not ready', reason: 'poll_stale', staleSeconds: Math.floor(sincePoll / 1000) },
        { status: 503 },
      )
    }

    return Response.json({ status: 'ready', lastPollAt: state.lastPollAt.toISOString() })
  }

  if (req.method === 'GET' && url.pathname === '/metrics') {
    const xff = req.headers.get('x-forwarded-for')
    const remoteIp = xff?.split(',')[0]?.trim() ?? ''
    const access = evaluateMetricsAccess({
      remoteIp,
      authHeader: req.headers.get('authorization'),
      allowedCidrs: options.metricsAllowedCidrs ?? ['127.0.0.1/32', '::1/128'],
      token: options.metricsAccessToken,
    })
    if (!access.allowed) {
      const headers: Record<string, string> = { 'content-type': 'text/plain' }
      if (access.wwwAuthenticate)
        headers['www-authenticate'] = access.wwwAuthenticate
      return new Response(access.denyBody ?? '', { status: access.denyStatus, headers })
    }

    const now = options.now ?? Date.now()
    const providerCalls = options.providerCallsSnapshot?.() ?? {}
    const body = serializePrometheus([
      ...aggregateProviderMetrics(providerCalls),
      ...aggregateWorkerMetrics({
        workerId: state.workerId,
        startedAtMs: state.startedAt.getTime(),
        nowMs: now,
        isPolling: state.isPolling,
        currentTaskId: state.currentTaskId,
        tasksClaimed: state.tasksClaimed,
        totalTasksProcessed: state.totalTasksProcessed,
        orphanSweeps: state.orphanSweeps,
        lastPollAtMs: state.lastPollAt?.getTime() ?? null,
        lastPollError: state.lastPollError,
      }),
    ])
    return new Response(body, { headers: { 'content-type': METRICS_CONTENT_TYPE } })
  }

  if (req.method === 'GET' && url.pathname === '/provider-calls') {
    // 访问策略与 /metrics 共用（IP 白名单 + 可选 token）
    const xff = req.headers.get('x-forwarded-for')
    const remoteIp = xff?.split(',')[0]?.trim() ?? ''
    const access = evaluateMetricsAccess({
      remoteIp,
      authHeader: req.headers.get('authorization'),
      allowedCidrs: options.metricsAllowedCidrs ?? ['127.0.0.1/32', '::1/128'],
      token: options.metricsAccessToken,
    })
    if (!access.allowed) {
      const headers: Record<string, string> = { 'content-type': 'text/plain' }
      if (access.wwwAuthenticate)
        headers['www-authenticate'] = access.wwwAuthenticate
      return new Response(access.denyBody ?? '', { status: access.denyStatus, headers })
    }

    return Response.json({
      workerId: state.workerId,
      providerCalls: options.providerCallsSnapshot?.() ?? {},
    })
  }

  return new Response('Not Found', { status: 404 })
}

/**
 * 启动轻量级 HTTP 服务，同时暴露 `/health`（JSON）和 `/metrics`（Prometheus exposition）。
 */
export function createHealthServer(state: WorkerHealthState, port: number, options: HealthHandlerOptions = {}) {
  const server = Bun.serve({
    port,
    fetch: req => handleHealthRequest(req, state, options),
  })
  logger.info({ port }, 'Worker health server listening')
  return server
}
