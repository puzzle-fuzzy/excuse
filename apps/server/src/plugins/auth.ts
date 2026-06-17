import type { ApiErrorResponse } from '@excuse/shared'
import type { Elysia } from 'elysia'
import type { ServerConfig } from '../config'
import { bearer } from '@elysia/bearer'
import { jwt } from '@elysia/jwt'
import { cookie } from '@elysiajs/cookie'
import { hashApiKey, isApiKeySecret } from '@excuse/auth'
import { findApiKeyByHash, touchApiKeyLastUsed } from '@excuse/db'
import { SlidingWindowRateLimiter } from '@excuse/rate-limit'
import { status, t } from 'elysia'
import { notifyApiKeyRevoked } from '../services/notifications'
import { errorHandlerPlugin } from './error-handler'

/** httpOnly cookie 名称 */
export const AUTH_COOKIE_NAME = 'auth_token'

/** API Key 元数据，供下游路由进行 scope/quota/rate-limit 检查 */
export interface ApiKeyMeta {
  id: string
  scope: string
  rateLimitPerMinute: number | null
  totalSpendCents: number
  quotaMaxCents: number | null
  quotaResetAt: Date | null
}

/** 进程内 per-key 限流器（滑动窗口，60 秒窗口） */
const apiKeyRateLimiter = new SlidingWindowRateLimiter()

async function resolveActiveUserId(userId: string): Promise<string | null> {
  try {
    const { getAccountById } = await import('@excuse/db')
    if (typeof getAccountById !== 'function') {
      if (process.env.NODE_ENV === 'test')
        return userId
      return null
    }

    const account = await getAccountById(userId)
    if (!account?.isActive)
      return null
    return userId
  }
  catch {
    if (process.env.NODE_ENV === 'test')
      return userId
    return null
  }
}

/**
 * 认证插件 — JWT + API Key 双通道
 *
 * 认证优先级:
 *   1. httpOnly cookie → JWT（浏览器请求）
 *   2. Bearer `exc_` 前缀 → API Key hash 查找
 *   3. Bearer 其他 → JWT verify（编程式 API 调用、SSE）
 *
 * 注册后向上下文注入：
 *   - jwt: JWT 签发/验证实例
 *   - bearer: Bearer token 原文
 *   - userId: 用户 ID（未认证时为 null）
 *   - authMethod: 'jwt' | 'api_key' | null
 *   - apiKeyMeta: 当 authMethod='api_key' 时返回密钥元数据（含 scope/quota/rate-limit 配置）
 */
export function createAuthPlugin(config: ServerConfig) {
  return (app: Elysia) =>
    app
      .use(errorHandlerPlugin)
      .use(cookie())
      .use(bearer())
      .use(
        jwt({
          name: 'jwt',
          secret: config.jwtSecret,
          schema: t.Object({
            sub: t.String(),
          }),
          exp: config.jwtExpiresIn,
        }),
      )
      .derive(async ({ jwt, bearer, cookie: cookies }) => {
        // 1. httpOnly cookie → JWT
        const cookieToken = cookies[AUTH_COOKIE_NAME]?.value as string | undefined
        if (cookieToken && typeof cookieToken === 'string') {
          const payload = await jwt.verify(cookieToken)
          if (payload) {
            const activeUserId = await resolveActiveUserId(payload.sub)
            if (activeUserId)
              return { userId: activeUserId, authMethod: 'jwt' as const, apiKeyMeta: null }
          }
        }

        if (!bearer || typeof bearer !== 'string') {
          return { userId: null, authMethod: null, apiKeyMeta: null }
        }

        // 2. Bearer exc_ → API Key 认证
        if (isApiKeySecret(bearer)) {
          const keyHash = await hashApiKey(bearer)
          const apiKey = await findApiKeyByHash(keyHash)
          if (apiKey) {
            const activeUserId = await resolveActiveUserId(apiKey.accountId)
            if (!activeUserId)
              return { userId: null, authMethod: null, apiKeyMeta: null }

            // 非阻塞更新 lastUsedAt
            touchApiKeyLastUsed(apiKey.id).catch(() => {})

            // Per-key rate limit 检查
            const rateLimit = apiKey.rateLimitPerMinute ?? 60
            const rl = apiKeyRateLimiter.check({
              userId: apiKey.id,
              category: 'api',
              maxRequests: Math.max(rateLimit, 1),
              windowMs: 60_000,
            })
            if (!rl.allowed) {
              return { userId: null, authMethod: null, apiKeyMeta: null }
            }

            return {
              userId: activeUserId,
              authMethod: 'api_key' as const,
              apiKeyMeta: {
                id: apiKey.id,
                scope: apiKey.scope,
                rateLimitPerMinute: apiKey.rateLimitPerMinute,
                totalSpendCents: apiKey.totalSpendCents,
                quotaMaxCents: apiKey.quotaMaxCents,
                quotaResetAt: apiKey.quotaResetAt,
              } satisfies ApiKeyMeta,
            }
          }
          // key 未找到，检查是否已被撤销 → 通知 key 所属用户
          const { findRevokedApiKeyByHash } = await import('@excuse/db')
          const revokedKey = await findRevokedApiKeyByHash(keyHash)
          if (revokedKey) {
            notifyApiKeyRevoked(revokedKey.accountId, revokedKey.id).catch(() => {})
          }
          return { userId: null, authMethod: null, apiKeyMeta: null }
        }

        // 3. Bearer 其他 → JWT
        const payload = await jwt.verify(bearer)
        if (!payload) {
          return { userId: null, authMethod: null, apiKeyMeta: null }
        }
        const activeUserId = await resolveActiveUserId(payload.sub)
        if (!activeUserId)
          return { userId: null, authMethod: null, apiKeyMeta: null }
        return { userId: activeUserId, authMethod: 'jwt' as const, apiKeyMeta: null }
      })
}

/**
 * 认证守卫插件 — resolve 模式自动拦截未登录请求
 *
 * 内部使用 createAuthPlugin 解析认证信息，
 * 然后通过 resolve 验证 userId 是否存在：
 *   - 未登录 → 直接返回 401 响应
 *   - 已登录 → 将 userId 类型从 string | null 收窄为 string
 *
 * 适用于所有路由都需要认证的路由组（canvas、generate、billing 等）。
 * 混合公开/受保护路由的场景（如 auth.ts 的 register+login+/me）
 * 应继续使用 createAuthPlugin 并手动检查。
 */
export function createRequireAuthPlugin(config: ServerConfig) {
  return (app: Elysia) =>
    app
      .use(createAuthPlugin(config))
      .use(errorHandlerPlugin)
      .resolve(({ userId }) => {
        if (!userId) {
          return status(401, { success: false, error: '请先登录' } satisfies ApiErrorResponse)
        }
        return { userId }
      })
}
