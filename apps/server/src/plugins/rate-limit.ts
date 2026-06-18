import { buildRateLimitKey, createRateLimitErrorResponse, DEFAULT_GLOBAL_RATE_LIMIT } from '@excuse/rate-limit'
import { DefaultContext, rateLimit } from 'elysia-rate-limit'

/**
 * 限流插件
 *
 * 全局每 IP 每分钟 60 次请求（无效/伪造 token 统一落到 IP bucket）。
 * 超限返回 429 + Retry-After + 可展示中文错误信息。
 *
 * maxSize: 50000（默认 5000）—— 防止恶意轮换伪造 key 驱逐合法用户条目。
 * §2.5 rate-limit 加固：buildRateLimitKey 已改为尽力 JWT 解码提取 userId，
 * 无效 token 统一回退 IP，消除伪造 token 无限 bucket 绕过。
 */
export const rateLimitPlugin = rateLimit({
  duration: DEFAULT_GLOBAL_RATE_LIMIT.durationMs,
  max: DEFAULT_GLOBAL_RATE_LIMIT.max,
  headers: true,
  generator: buildRateLimitKey,
  errorResponse: createRateLimitErrorResponse(),
  context: new DefaultContext(50_000),
})
