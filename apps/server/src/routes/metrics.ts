import type { ServerConfig } from '../config'
import { serializePrometheus, snapshotToPrometheus } from '@excuse/metrics'
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
 * 简化版 CIDR / IP 匹配（v1 不引入第三方库）。
 *
 * 支持的 CIDR 形态：
 * - `127.0.0.0/8`：IPv4 回环段（127.x.x.x 全部允许）
 * - `::1/128` 或 `::1`：IPv6 回环精确匹配
 * - 完整 IPv4 / IPv6 字符串等值（如 `10.0.0.5/32`、`10.0.0.5`、`fe80::1`）
 *
 * **不支持**：任意非 `/8`/`/32`/`/128` 的 IPv4 段（如 `10.0.0.0/24`）、IPv6 段（`fe80::/64`）。
 * 生产环境需要复杂 CIDR 时建议在反向代理层做 IP 白名单。
 */
export function isAllowedIp(remoteIp: string, allowedCidrs: string[]): boolean {
  if (!remoteIp)
    return false
  const ip = remoteIp.trim()

  for (const cidr of allowedCidrs) {
    const normalized = cidr.trim()
    if (!normalized)
      continue

    if (normalized.includes('/')) {
      const [base, prefixStr] = normalized.split('/')
      const prefix = Number(prefixStr)

      if (base && base.includes(':')) {
        // IPv6 仅支持 ::1/128 精确匹配
        if (prefix === 128 && base === '::1' && ip === '::1')
          return true
        continue
      }

      if (base && prefix === 8) {
        const segments = base.split('.')
        if (segments.length === 4 && segments[0] && ip.includes('.')) {
          const ipSegments = ip.split('.')
          if (ipSegments.length === 4 && ipSegments[0] === segments[0])
            return true
        }
        continue
      }

      if (base && prefix === 32) {
        if (ip === base)
          return true
        continue
      }
      continue
    }

    // 无前缀的 CIDR：当成精确 IP 等值匹配
    if (ip === normalized)
      return true
  }

  return false
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
    .get('/metrics', ({ request, set }) => {
      const xff = request.headers.get('x-forwarded-for')
      const remoteIp = xff?.split(',')[0]?.trim() ?? ''

      const ipAllowed = isAllowedIp(remoteIp, config.metricsAllowedCidrs)
      const hasToken = Boolean(config.metricsAccessToken)

      // 1. IP 不在白名单时：未配置 token → 403；配置了 token → 进入 token 校验
      if (!ipAllowed && !hasToken) {
        set.status = 403
        return 'Forbidden'
      }

      // 2. 配置了 token 时：必须 Bearer 匹配（IP 白名单通过的也要带 token，避免误开放）
      if (hasToken) {
        const auth = request.headers.get('authorization') ?? ''
        const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
        if (token !== config.metricsAccessToken) {
          set.status = 401
          set.headers['www-authenticate'] = 'Bearer realm="metrics"'
          return 'Unauthorized'
        }
      }

      // 3. 序列化为 prometheus exposition format
      const uptime = Math.floor((Date.now() - startTime) / 1000)
      const snapshot = getMetrics(getOnlineUserCount(), uptime)
      const body = serializePrometheus(snapshotToPrometheus(snapshot))

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
