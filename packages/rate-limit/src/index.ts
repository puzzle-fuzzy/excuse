import type { RateLimitErrorResponse } from '@excuse/shared'

/**
 * @excuse/rate-limit —— 纯规则包（无 IO 依赖）
 *
 * 提供三块能力：
 *   1. 滑动窗口限流器 SlidingWindowRateLimiter（按 用户 × 分类 维度）
 *   2. 429 响应构造器 createRateLimitErrorBody / createRateLimitErrorResponse
 *   3. Request → 限流 Key 提取器 buildRateLimitKey
 *
 * 调用方：apps/server 的 rateLimitPlugin（全局中间件，应用于所有路由前）。
 * 设计约束：本包只导出纯函数 / 类，禁止 import @excuse/db、@excuse/provider 或 apps/*。
 */

/** 单次限流判定结果。allowed=false 时 retryAfterSec 是建议客户端等待的秒数（向上取整）。 */
export interface RateLimitDecision {
  allowed: boolean
  retryAfterSec: number
}

/**
 * 分类限流入参。
 * userId + category 共同组成限流 Key（同一用户的不同分类独立计数）。
 * now 可注入，便于测试时间窗边界；缺省取 Date.now()。
 */
export interface CategoryRateLimitOptions {
  userId: string
  category: string
  maxRequests: number
  windowMs: number
  now?: number
}

/** 滑动窗口内部状态：每个 Key 保留窗口内的请求时间戳数组。 */
interface WindowEntry {
  timestamps: number[]
}

/**
 * 全局默认限流配置：60 秒内最多 60 次请求，超限后建议客户端等待 60 秒。
 *
 * 注意：`as const` 会让字段类型窄化为字面量类型（retryAfterSec: 60 而非 number）。
 * 因此下方两个 create* 函数的默认参数必须显式标注 number / string，
 * 否则调用方传其他数值（如 12）会报「类型 '12' 不能赋给类型 '60'」。
 */
export const DEFAULT_GLOBAL_RATE_LIMIT = {
  durationMs: 60 * 1000,
  max: 60,
  retryAfterSec: 60,
  message: '请求过于频繁，请稍后再试',
} as const

/** 单条路由的限流策略 */
export interface RouteRateLimitRule {
  /** URL 路径前缀匹配（如 "/api/generate" 匹配 /api/generate 及 /api/generate/xxx） */
  pathPrefix: string
  /** 窗口大小（毫秒） */
  durationMs: number
  /** 窗口内最大请求数 */
  max: number
  /** 建议客户端等待秒数 */
  retryAfterSec: number
  /** 限流提示消息 */
  message: string
}

/**
 * 声明式 per-route 限流配置表。
 *
 * 条目按 pathPrefix 匹配第一个命中者获胜；无匹配时回落全局默认。
 * 调用方（apps/server rateLimitPlugin）在请求进入时遍历此表，命中即覆盖全局默认。
 *
 * 新增/调整路由限流时在此表登记即可，无需改动插件逻辑。
 */
export const DEFAULT_ROUTE_RATE_LIMITS: readonly RouteRateLimitRule[] = [
  {
    pathPrefix: '/api/generate',
    durationMs: 10_000,
    max: 5,
    retryAfterSec: 10,
    message: '生成请求过于频繁，请稍后再试',
  },
  {
    pathPrefix: '/api/openai',
    durationMs: 60_000,
    max: 30,
    retryAfterSec: 60,
    message: 'API 请求过于频繁，请稍后再试',
  },
  {
    pathPrefix: '/api/health',
    durationMs: 1_000,
    max: 999_999,
    retryAfterSec: 0,
    message: '',
  },
]

/**
 * 按请求路径匹配路由限流规则，返回第一条匹配的规则。
 * 无匹配时返回 null——调用方应回落全局默认。
 */
export function matchRouteRateLimit(
  pathname: string,
  rules: readonly RouteRateLimitRule[] = DEFAULT_ROUTE_RATE_LIMITS,
): RouteRateLimitRule | null {
  return rules.find(r => pathname.startsWith(r.pathPrefix)) ?? null
}

/**
 * 从 Request 头中提取限流 Key：
 *   - Bearer JWT → 尝试无验证解码提取 sub（userId），成功则 `user:<userId>`
 *   - Bearer API key（exc_ 前缀）→ 无法无状态提取用户，统一落到 IP
 *   - 无效/缺失 token → 回退 `x-forwarded-for` 第一个 IP；再缺失则记为 `ip:unknown`
 *
 * 设计要点：本函数运行在 auth 之前（全局限流中间件），无法做真正的 token 验证，
 * 仅通过 JWT 无验证解码尽力提取 userId。恶意客户端轮换伪造 JWT 会得到不同 userId
 * 从而分配独立 bucket——这是无验证解码的固有局限。真正的 per-user 限流应在 auth 之后、
 * 路由 handler 内使用 SlidingWindowRateLimiter（已有 category-rate-limit 实现）。
 * 生产环境多副本部署时建议在反向代理层做 per-IP 限流兜底。
 *
 * 安全改进（§2.5）：旧实现用 `token 前 50 字符` 做 key，恶意客户端可轮换任意
 * 随机字符串创建无限 bucket 绕过限流。现在无效 token 统一落到 IP bucket，
 * 大幅提高绕过门槛。
 */
export function buildRateLimitKey(request: Request): string {
  const authHeader = request.headers.get('authorization')
  if (authHeader) {
    // 尝试无验证 JWT 解码提取 sub（userId）
    const userId = tryDecodeJwtSub(authHeader)
    if (userId)
      return `user:${userId}`
  }
  // 无效 token 或无 auth header → 统一落到 IP bucket
  return `ip:${request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'}`
}

/**
 * 无验证 JWT 解码：提取 payload 中的 `sub` 字段。
 *
 * 不做签名验证（本包运行在 auth 之前），仅从 base64url 编码的 payload 段
 * 尽力提取 userId。解码失败返回 null——调用方回退到 IP key。
 */
function tryDecodeJwtSub(authHeader: string): string | null {
  try {
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader
    const parts = token.split('.')
    if (parts.length !== 3)
      return null
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'))
    return typeof payload.sub === 'string' ? payload.sub : null
  }
  catch {
    return null
  }
}

/** 构造 429 响应体（与 @excuse/shared 的 RateLimitErrorResponse 对齐）。 */
export function createRateLimitErrorBody(
  retryAfterSec: number = DEFAULT_GLOBAL_RATE_LIMIT.retryAfterSec,
  message: string = DEFAULT_GLOBAL_RATE_LIMIT.message,
): RateLimitErrorResponse {
  return {
    success: false,
    error: message,
    retryAfter: retryAfterSec,
  }
}

/** 构造可直接 return 的 429 Response，带符合 RFC 7231 的 Retry-After 头。 */
export function createRateLimitErrorResponse(
  retryAfterSec: number = DEFAULT_GLOBAL_RATE_LIMIT.retryAfterSec,
  message: string = DEFAULT_GLOBAL_RATE_LIMIT.message,
): Response {
  return new Response(JSON.stringify(createRateLimitErrorBody(retryAfterSec, message)), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': String(retryAfterSec),
    },
  })
}

/**
 * 滑动窗口限流器（in-memory，进程内）。
 *
 * 工作原理：每个 (userId, category) Key 维护一个时间戳数组，
 * check() 先清理过期时间戳，再判断当前窗口内是否达到 maxRequests。
 *
 * 局限（后续迭代需注意）：
 *   - 状态不跨进程：多副本部署时实际配额 = 实例数 × maxRequests。
 *   - 无持久化：进程重启即清零。
 *   如需分布式限流，建议改用 Redis + Lua 脚本，但保持本接口形态不变以便平滑替换。
 */
export class SlidingWindowRateLimiter {
  private windows = new Map<string, WindowEntry>()

  /**
   * 检查单次请求是否放行。
   * 注意：被限流时不写入时间戳，避免一次失败占用未来配额。
   */
  check(opts: CategoryRateLimitOptions): RateLimitDecision {
    const { userId, category, maxRequests, windowMs } = opts
    const key = `${userId}:${category}`
    const now = opts.now ?? Date.now()

    this.cleanup(key, now, windowMs)

    const entry = this.windows.get(key)
    if (!entry) {
      this.windows.set(key, { timestamps: [now] })
      return { allowed: true, retryAfterSec: 0 }
    }

    if (entry.timestamps.length >= maxRequests) {
      const oldest = entry.timestamps[0]!
      const retryAfterMs = oldest + windowMs - now
      return { allowed: false, retryAfterSec: Math.ceil(retryAfterMs / 1000) }
    }

    entry.timestamps.push(now)
    return { allowed: true, retryAfterSec: 0 }
  }

  /** 清空所有窗口（主要用于测试）。 */
  reset(): void {
    this.windows.clear()
  }

  /**
   * 移除指定 Key 中超出 windowMs 的时间戳。
   * 时间戳全部过期时直接删除 Key，防止 Map 无限增长。
   */
  private cleanup(key: string, now: number, windowMs: number): void {
    const entry = this.windows.get(key)
    if (!entry)
      return
    entry.timestamps = entry.timestamps.filter(timestamp => now - timestamp < windowMs)
    if (entry.timestamps.length === 0)
      this.windows.delete(key)
  }
}
