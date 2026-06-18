import type { OpenAIErrorResponse } from '@excuse/shared'
import { classifyRecovery } from '@excuse/error-recovery'

/**
 * @excuse/gateway — 错误工厂模块
 *
 * OpenAI 兼容错误码常量 + createOpenAIError 基础工厂 + 语义化错误工厂（v2）。
 * 所有网关错误构造集中在此文件；路由层通过语义工厂一行调用即可。
 */

/**
 * OpenAI 网关对外暴露的错误码常量。
 *
 * 用法：route 和 normalizeOpenAIChatRequest 在构造 createOpenAIError 时，
 * 必须从本常量取 code，禁止散落魔法字符串。
 */
export const OPENAI_GATEWAY_ERROR_CODES = {
  MODEL_NOT_FOUND: 'model_not_found',
  INVALID_MODEL: 'invalid_model',
  INVALID_PARAMETERS: 'invalid_parameters',
  INSUFFICIENT_BALANCE: 'insufficient_balance',
  GENERATION_FAILED: 'generation_failed',
  STREAM_NOT_SUPPORTED: 'stream_not_supported',
  STREAMING_MODEL_NOT_SUPPORTED: 'streaming_model_not_supported',
  MISSING_USER_MESSAGE: 'missing_user_message',
  API_KEY_SCOPE_NOT_ALLOWED: 'api_key_scope_not_allowed',
  API_KEY_QUOTA_EXCEEDED: 'api_key_quota_exceeded',
} as const

export type OpenAIGatewayErrorCode
  = typeof OPENAI_GATEWAY_ERROR_CODES[keyof typeof OPENAI_GATEWAY_ERROR_CODES]

/** 网关错误：包含 OpenAI 格式的错误体 + HTTP 状态码，调用方据此返回响应。 */
export interface OpenAIGatewayError {
  response: OpenAIErrorResponse
  status: number
}

/**
 * 构造一个 OpenAI 兼容的错误结果。
 * 注意：返回的是结构化对象，不是 Response；调用方需要自行
 * `new Response(JSON.stringify(err.response), { status: err.status })`。
 *
 * @param message 错误消息
 * @param type 错误类型（OpenAI 规范）
 * @param code 错误码（来自 OPENAI_GATEWAY_ERROR_CODES）
 * @param statusCode HTTP 状态码
 * @param hint 用户下一步建议（来自 classifyRecovery 分类），缺省时由工厂自动填充。
 */
export function createOpenAIError(
  message: string,
  type: string,
  code: OpenAIGatewayErrorCode | string,
  statusCode: number,
  hint?: string,
): OpenAIGatewayError {
  const errorObj: OpenAIErrorResponse['error'] = { message, type, code }
  if (hint)
    errorObj.hint = hint
  return {
    response: { error: errorObj },
    status: statusCode,
  }
}

// ── 语义化错误工厂（v2）───────────────────────────────────────────────────────
//
// 这些工厂把 route 层重复的 (message, type, code, status) 四元组封装成语义清晰的
// 一行调用。底层仍调 createOpenAIError；不替换原 API，作为更高层 helper。
//
// 设计约束：
//   - 每个工厂对应一个具体的 OpenAIGatewayErrorCode，避免 route 层手填 code 出错。
//   - 参数最小化：route 已经有上下文（model / errors），工厂只接必要信息。
//   - 返回 OpenAIGatewayError，route 直接 `set.status = err.status; return err.response`。

/** 模型不存在（别名解析后内部 ID 也找不到） */
export function modelNotFoundError(model: string): OpenAIGatewayError {
  const hint = classifyRecovery({ code: OPENAI_GATEWAY_ERROR_CODES.MODEL_NOT_FOUND }).suggestion
  return createOpenAIError(
    `Model '${model}' not found`,
    'invalid_request_error',
    OPENAI_GATEWAY_ERROR_CODES.MODEL_NOT_FOUND,
    404,
    hint,
  )
}

/** 模型存在但不支持当前操作（如非文本模型用于 chat completions） */
export function invalidModelError(model: string): OpenAIGatewayError {
  const hint = classifyRecovery({ code: OPENAI_GATEWAY_ERROR_CODES.INVALID_MODEL }).suggestion
  return createOpenAIError(
    `Model '${model}' is not a text model`,
    'invalid_request_error',
    OPENAI_GATEWAY_ERROR_CODES.INVALID_MODEL,
    400,
    hint,
  )
}

/** 参数校验失败 — 接收 ValidationResult.errors，拼成单条 message */
export function invalidParametersError(
  errors: Array<{ field: string, message: string }>,
): OpenAIGatewayError {
  const details = errors.map(e => `${e.field}: ${e.message}`).join('; ')
  const hint = classifyRecovery({ code: OPENAI_GATEWAY_ERROR_CODES.INVALID_PARAMETERS }).suggestion
  return createOpenAIError(
    details,
    'invalid_request_error',
    OPENAI_GATEWAY_ERROR_CODES.INVALID_PARAMETERS,
    400,
    hint,
  )
}

/** 请求缺少有效的 user message */
export function missingUserMessageError(): OpenAIGatewayError {
  const hint = classifyRecovery({ code: OPENAI_GATEWAY_ERROR_CODES.MISSING_USER_MESSAGE }).suggestion
  return createOpenAIError(
    'No user message provided',
    'invalid_request_error',
    OPENAI_GATEWAY_ERROR_CODES.MISSING_USER_MESSAGE,
    400,
    hint,
  )
}

/** 用户余额不足以执行生成 */
export function insufficientBalanceError(): OpenAIGatewayError {
  const hint = classifyRecovery({ code: OPENAI_GATEWAY_ERROR_CODES.INSUFFICIENT_BALANCE }).suggestion
  return createOpenAIError(
    'Insufficient balance to complete the request',
    'insufficient_quota',
    OPENAI_GATEWAY_ERROR_CODES.INSUFFICIENT_BALANCE,
    402,
    hint,
  )
}

/** Provider 调用失败（DashScope / 上游模型错误） */
export function generationFailedError(message: string): OpenAIGatewayError {
  const hint = classifyRecovery({ errorMessage: message }).suggestion
  return createOpenAIError(
    message,
    'server_error',
    OPENAI_GATEWAY_ERROR_CODES.GENERATION_FAILED,
    500,
    hint,
  )
}

/** API Key scope 不满足端点要求（如 gateway 端点需要 scope=gateway） */
export function apiKeyScopeNotAllowedError(): OpenAIGatewayError {
  // scope 不允许 → 用户需创建新 key，不是 error-recovery 的标准分类，直接给建议
  const hint = '请创建一个 scope 为 "gateway" 或 "all" 的 API Key 后重试。'
  return createOpenAIError(
    'This API key does not have permission to access the Gateway. Please create a key with scope set to "gateway" or "all".',
    'invalid_request_error',
    OPENAI_GATEWAY_ERROR_CODES.API_KEY_SCOPE_NOT_ALLOWED,
    403,
    hint,
  )
}

/** API Key 已达额度上限 */
export function apiKeyQuotaExceededError(): OpenAIGatewayError {
  const hint = classifyRecovery({ code: OPENAI_GATEWAY_ERROR_CODES.API_KEY_QUOTA_EXCEEDED }).suggestion
  return createOpenAIError(
    'API key quota exceeded. Please wait for quota reset or create a new key with higher limit.',
    'insufficient_quota',
    OPENAI_GATEWAY_ERROR_CODES.API_KEY_QUOTA_EXCEEDED,
    429,
    hint,
  )
}
