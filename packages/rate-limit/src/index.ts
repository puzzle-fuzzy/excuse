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

/**
 * 从 Request 头中提取限流 Key：
 *   - 命中 Authorization 头 → `user:<token 前 50 字符>`
 *     （截断防止长 token 导致 Map key 膨胀；前缀已能唯一区分用户，不影响隔离）
 *   - 否则回退 `x-forwarded-for` 第一个 IP；再缺失则记为 `ip:unknown`
 */
export function buildRateLimitKey(request: Request): string {
  const authHeader = request.headers.get('authorization')
  if (authHeader)
    return `user:${authHeader.slice(0, 50)}`
  return `ip:${request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'}`
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
