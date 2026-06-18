import {
  buildRateLimitKey,
  createRateLimitErrorResponse,
  DEFAULT_GLOBAL_RATE_LIMIT,
  DEFAULT_ROUTE_RATE_LIMITS,
  matchRouteRateLimit,
  SlidingWindowRateLimiter,
} from '@excuse/rate-limit'
import { Elysia } from 'elysia'

/**
 * 全局限流插件 — 进程内滑动窗口限流 + per-route 声明式规则。
 *
 * - 默认：每 key 60s 窗口内 60 次请求（`DEFAULT_GLOBAL_RATE_LIMIT`）。
 * - Per-route 覆盖：`DEFAULT_ROUTE_RATE_LIMITS` 表按 pathPrefix 匹配，
 *   命中后使用该规则的 durationMs / max / retryAfterSec / message。
 * - Key 策略：`buildRateLimitKey()` (Bearer JWT → userId，无效 token → IP)。
 * - 被限流时返回 429 + Retry-After + JSON 错误体。
 *
 * 依赖 `@excuse/rate-limit` 的纯函数/类，不直接依赖 elysia-rate-limit。
 */
const limiter = new SlidingWindowRateLimiter()

export const rateLimitPlugin = new Elysia()
  .onRequest(({ request, set }) => {
    const key = buildRateLimitKey(request)
    const url = new URL(request.url)
    const routeRule = matchRouteRateLimit(url.pathname, DEFAULT_ROUTE_RATE_LIMITS)

    const max = routeRule?.max ?? DEFAULT_GLOBAL_RATE_LIMIT.max
    const durationMs = routeRule?.durationMs ?? DEFAULT_GLOBAL_RATE_LIMIT.durationMs
    const retryAfterSec = routeRule?.retryAfterSec ?? DEFAULT_GLOBAL_RATE_LIMIT.retryAfterSec
    const message = routeRule?.message ?? DEFAULT_GLOBAL_RATE_LIMIT.message

    // 配置为不限制（如 health 探测）→ 直接放行，不写滑动窗口
    if (max <= 0 || durationMs <= 0)
      return

    const decision = limiter.check({
      userId: key,
      category: 'global',
      maxRequests: max,
      windowMs: durationMs,
    })

    if (!decision.allowed) {
      set.status = 429
      set.headers['Retry-After'] = String(Math.max(retryAfterSec, decision.retryAfterSec))
      return createRateLimitErrorResponse(
        Math.max(retryAfterSec, decision.retryAfterSec),
        message,
      )
    }
  })
