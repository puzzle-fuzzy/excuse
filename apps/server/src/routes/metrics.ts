import type { ServerConfig } from '../config'
import { getCanvasPhaseStats, getTaskQueueStats, listProviderModelHealth } from '@excuse/db'
import { isDegraded } from '@excuse/provider-health'
import { aggregateCanvasPhaseMetrics, aggregateProviderHealthMetrics, aggregateTaskQueueMetrics, evaluateMetricsAccess, serializePrometheus, snapshotToPrometheus } from '@excuse/metrics'
import { Elysia } from 'elysia'
import { getMetrics } from '../services/metrics'
import { getOnlineUserCount } from '../services/sse-manager'

/**
 * metrics route 自维护进程启动时间，避免与 health.ts 共享状态导致测试相互干扰。
 */
let startTime = Date.now()

/** 测试用：重置 uptime 起点 */
export function resetMetricsStartTime() {
  startTime = Date.now()
}

/**
 * Prometheus metrics 抓取端点
 *
 * GET /metrics — 返回 Prometheus text exposition（v0.0.4）格式的进程指标。
 *
 * **访问策略（v1）**：
 * - 默认仅允许回环地址（`127.0.0.0/8` + `::1`）。
 * - 配置 `METRICS_ACCESS_TOKEN` 后，允许通过 `Authorization: Bearer <token>` 远程访问。
 * - 不挂 `/api` 前缀，符合 Prometheus 标准 scrape config 约定。
 * - 不应用用户 JWT 鉴权：metrics 是给 Prometheus scraper 抓的，不是给前端用户访问的。
 */
export function createMetricsRoutes(config: ServerConfig) {
  return new Elysia()
    .get('/metrics', async ({ request, set }) => {
      const xff = request.headers.get('x-forwarded-for')
      const remoteIp = xff?.split(',')[0]?.trim() ?? ''

      // 访问策略下沉到 @excuse/metrics（与 worker /metrics 共用）
      const access = evaluateMetricsAccess({
        remoteIp,
        authHeader: request.headers.get('authorization'),
        allowedCidrs: config.metricsAllowedCidrs,
        token: config.metricsAccessToken,
      })
      if (!access.allowed) {
        set.status = access.denyStatus
        if (access.wwwAuthenticate)
          set.headers['www-authenticate'] = access.wwwAuthenticate
        return access.denyBody
      }

      // 序列化为 prometheus exposition format
      const uptime = Math.floor((Date.now() - startTime) / 1000)
      const snapshot = getMetrics(getOnlineUserCount(), uptime)
      const inProcessMetrics = snapshotToPrometheus(snapshot)

      // DB 派生指标（每 scrape 一次查询；DB 异常时不阻塞 in-memory 输出）
      const now = Date.now()
      const [phaseStats, queueStats, healthRows] = await Promise.all([
        getCanvasPhaseStats(24).catch(() => []),
        getTaskQueueStats().catch(() => []),
        listProviderModelHealth().catch(() => []),
      ])
      const dbDerivedMetrics = [
        ...aggregateCanvasPhaseMetrics(phaseStats),
        ...aggregateTaskQueueMetrics(queueStats),
        ...aggregateProviderHealthMetrics(
          healthRows.map(r => ({ model: r.model, blocking: isDegraded(r, now), consecutiveFailures: r.consecutiveFailures })),
        ),
      ]

      const body = serializePrometheus([...inProcessMetrics, ...dbDerivedMetrics])

      set.headers['content-type'] = 'text/plain; version=0.0.4; charset=utf-8'
      return body
    }, {
      detail: {
        summary: 'Prometheus metrics',
        description:
          '返回 Prometheus text exposition 格式的进程指标。默认仅允许回环地址访问；配置 METRICS_ACCESS_TOKEN 后允许通过 Authorization: Bearer <token> 远程访问。',
        tags: ['健康检查'],
      },
    })
}
