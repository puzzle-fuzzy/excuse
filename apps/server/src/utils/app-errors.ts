import type { ApiErrorResponse, RateLimitErrorResponse } from '@excuse/shared'

/**
 * 应用层错误基类 — 所有业务错误的根类型
 *
 * 由 Elysia onError 钩子统一捕获并序列化为 JSON 响应。
 */
export class AppError extends Error {
  readonly statusCode: number
  readonly details?: Record<string, unknown>

  constructor(statusCode: number, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.details = details
  }

  /** 序列化为 API 错误响应体 */
  toResponse(): ApiErrorResponse {
    return { success: false, error: this.message }
  }
}

// ── 具体错误类 ────────────────────────────────────────────────────────────

/** 400 — 请求格式错误（Elysia 内置校验失败也用此状态） */
export class BadRequestError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(400, message, details)
    this.name = 'BadRequestError'
  }
}

/** 401 — 未认证（未登录或 token 失效） */
export class UnauthorizedError extends AppError {
  constructor(message = '请先登录') {
    super(401, message)
    this.name = 'UnauthorizedError'
  }
}

/** 402 — 余额不足或支付前置条件不满足 */
export class PaymentRequiredError extends AppError {
  constructor(message: string) {
    super(402, message)
    this.name = 'PaymentRequiredError'
  }
}

/** 403 — 无权操作（资源不属于当前用户） */
export class ForbiddenError extends AppError {
  constructor(message = '无权操作') {
    super(403, message)
    this.name = 'ForbiddenError'
  }
}

/** 404 — 资源不存在 */
export class NotFoundError extends AppError {
  constructor(message = '资源不存在') {
    super(404, message)
    this.name = 'NotFoundError'
  }
}

/** 409 — 状态冲突（重复创建、状态前置条件不满足） */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message)
    this.name = 'ConflictError'
  }
}

/** 422 — 参数校验失败 */
export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(422, message, details)
    this.name = 'ValidationError'
  }
}

/** 429 — 请求过于频繁（限流） */
export class RateLimitError extends AppError {
  readonly retryAfter: number

  constructor(message = '请求过于频繁，请稍后再试', retryAfter = 60) {
    super(429, message)
    this.name = 'RateLimitError'
    this.retryAfter = retryAfter
  }

  override toResponse(): RateLimitErrorResponse {
    return { success: false, error: this.message, retryAfter: this.retryAfter }
  }
}

/** 500 — 服务端内部错误 */
export class InternalError extends AppError {
  constructor(message = '服务端内部错误') {
    super(500, message)
    this.name = 'InternalError'
  }
}

/** 503 — 服务暂不可用（如 SSE 连接数超限） */
export class ServiceUnavailableError extends AppError {
  constructor(message = '服务暂不可用') {
    super(503, message)
    this.name = 'ServiceUnavailableError'
  }
}
