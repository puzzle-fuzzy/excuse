import type { Elysia } from 'elysia'
import { createLogger } from '@excuse/shared'
import { AppError, RateLimitError } from '../utils/app-errors'

const logger = createLogger('error-handler')

/**
 * 统一错误处理插件
 *
 * 通过 Elysia `onError` 钩子捕获所有路由中抛出的错误，统一序列化为 JSON 响应。
 *
 * 覆盖场景：
 * 1. AppError 子类（业务错误）→ 使用其 statusCode + toResponse()
 * 2. RateLimitError 额外设置 Retry-After 响应头
 * 3. Elysia 内置 VALIDATION 错误 → 422 + 提取第一条错误消息
 * 4. 未预料错误 → 500 + 日志记录（不泄露内部详情）
 */
export function errorHandlerPlugin(app: Elysia) {
  return app.onError(({ error, set, code }) => {
    // ── 业务错误（AppError 子类） ──
    if (error instanceof AppError) {
      set.status = error.statusCode
      if (error instanceof RateLimitError) {
        set.headers['Retry-After'] = String(error.retryAfter)
      }
      return error.toResponse()
    }

    // ── Elysia 内置校验错误（路由 schema 校验失败） ──
    if (code === 'VALIDATION' && 'validator' in error) {
      set.status = 422
      const all = error as unknown as { all?: Array<{ message: string }> }
      const firstMessage = all?.all?.[0]?.message ?? '请求参数校验失败'
      return { success: false, error: firstMessage }
    }

    // ── 未知错误 — 500 并记录日志（不泄露详情） ──
    set.status = 500
    logger.error({ err: error, code }, 'Unhandled error in route handler')
    return { success: false, error: '服务端内部错误' }
  })
}
