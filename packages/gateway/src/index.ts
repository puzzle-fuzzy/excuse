import type { OpenAIChatRequest, OpenAIChatResponse, OpenAIErrorResponse, OpenAIModelsResponse } from '@excuse/shared'
import { resolveModelId } from '@excuse/shared'

/**
 * @excuse/gateway —— OpenAI 兼容网关的纯规则包（无 IO 依赖）
 *
 * 职责：在「OpenAI 协议格式」和「内部 DashScope 单轮 prompt 格式」之间做无状态转换。
 *   - 入站：把 OpenAI Chat Completions 请求归一化成内部参数（取最后一条 user 消息作为 prompt）
 *   - 出站：把内部生成结果封装成 OpenAI 兼容响应（chat.completion / models list）
 *   - 错误：统一构造符合 OpenAI 错误结构的 4xx 响应
 *
 * 调用方：apps/server/src/routes/openai-gateway.ts（/api/openai/* 路由）。
 * 设计约束：本包不感知 HTTP / DB / provider，只做类型与字段映射，便于单测覆盖。
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
  MISSING_USER_MESSAGE: 'missing_user_message',
} as const

export type OpenAIGatewayErrorCode
  = typeof OPENAI_GATEWAY_ERROR_CODES[keyof typeof OPENAI_GATEWAY_ERROR_CODES]

/** 网关错误：包含 OpenAI 格式的错误体 + HTTP 状态码，调用方据此返回响应。 */
export interface OpenAIGatewayError {
  response: OpenAIErrorResponse
  status: number
}

/**
 * 归一化后的 chat 请求。
 * - internalModelId：经过 MODEL_ALIASES 解析后的内部模型 ID（如 gpt-4 → qwen-max）
 * - prompt：取自最后一条 user 消息的内容（DashScope 文本生成是单轮接口）
 * - parameters：传给内部 generate 接口的参数集合（已剔除 undefined）
 */
export interface NormalizedOpenAIChatRequest {
  request: OpenAIChatRequest
  internalModelId: string
  prompt: string
  parameters: Record<string, unknown>
}

/** /v1/models 列表项的最小入参（只关心 id，其余字段由 createOpenAIModelsResponse 补全）。 */
export interface GatewayModelListItem {
  id: string
}

/** 构造 chat.completion 响应所需的最小输入（由调用方从 generation_records 中拼装）。 */
export interface OpenAIChatResponseInput {
  id: string
  createdAt: Date
  requestedModel: string
  text: string
  inputTokens?: number
  outputTokens?: number
}

/**
 * 构造一个 OpenAI 兼容的错误结果。
 * 注意：返回的是结构化对象，不是 Response；调用方需要自行
 * `new Response(JSON.stringify(err.response), { status: err.status })`。
 */
export function createOpenAIError(
  message: string,
  type: string,
  code: OpenAIGatewayErrorCode | string,
  statusCode: number,
): OpenAIGatewayError {
  return {
    response: { error: { message, type, code } },
    status: statusCode,
  }
}

/**
 * 把 OpenAI Chat Completions 请求归一化为内部参数。
 *
 * 返回值是联合类型（NormalizedOpenAIChatRequest | OpenAIGatewayError），
 * 调用方必须先用 isOpenAIGatewayError() 做类型收窄。
 *
 * 规则：
 *   - stream=true → 400 stream_not_supported（本网关不支持流式）
 *   - 没有 user 消息 → 400 missing_user_message
 *   - 否则取最后一条 user 消息作为 prompt，附上 temperature/max_tokens/top_p（仅当用户显式传入时）
 */
export function normalizeOpenAIChatRequest(request: OpenAIChatRequest): NormalizedOpenAIChatRequest | OpenAIGatewayError {
  if (request.stream) {
    return createOpenAIError('Streaming is not supported', 'invalid_request_error', OPENAI_GATEWAY_ERROR_CODES.STREAM_NOT_SUPPORTED, 400)
  }

  const userMessages = request.messages.filter(m => m.role === 'user')
  if (userMessages.length === 0) {
    return createOpenAIError('No user message provided', 'invalid_request_error', OPENAI_GATEWAY_ERROR_CODES.MISSING_USER_MESSAGE, 400)
  }

  const lastUserMessage = userMessages[userMessages.length - 1]
  if (!lastUserMessage) {
    return createOpenAIError('No user message provided', 'invalid_request_error', OPENAI_GATEWAY_ERROR_CODES.MISSING_USER_MESSAGE, 400)
  }

  const parameters: Record<string, unknown> = { prompt: lastUserMessage.content }
  if (request.temperature !== undefined)
    parameters.temperature = request.temperature
  if (request.max_tokens !== undefined)
    parameters.max_tokens = request.max_tokens
  if (request.top_p !== undefined)
    parameters.top_p = request.top_p

  return {
    request,
    internalModelId: resolveModelId(request.model),
    prompt: lastUserMessage.content,
    parameters,
  }
}

/**
 * 类型守卫：判断未知值是否为 OpenAIGatewayError。
 * 用于在调用 normalizeOpenAIChatRequest 之后对联合类型做收窄。
 */
export function isOpenAIGatewayError(value: unknown): value is OpenAIGatewayError {
  return typeof value === 'object'
    && value !== null
    && 'response' in value
    && 'status' in value
}

/**
 * 把内部生成结果封装成 OpenAI Chat Completions 响应。
 * 注意：created 字段是 Unix 秒（OpenAI 规范），需要把 Date.getTime() 的毫秒值除以 1000。
 */
export function createOpenAIChatResponse(input: OpenAIChatResponseInput): OpenAIChatResponse {
  const promptTokens = input.inputTokens ?? 0
  const completionTokens = input.outputTokens ?? 0

  return {
    id: input.id,
    object: 'chat.completion',
    created: Math.floor(input.createdAt.getTime() / 1000),
    model: input.requestedModel,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: input.text },
      finish_reason: 'stop',
    }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  }
}

/**
 * 构造 /v1/models 列表响应。
 * - created 取当前 Unix 秒（与 chat.completion 一致）
 * - owned_by 固定为 'excuse'（对外标识模型所有方）
 */
export function createOpenAIModelsResponse(models: GatewayModelListItem[]): OpenAIModelsResponse {
  const created = Math.floor(Date.now() / 1000)
  return {
    object: 'list',
    data: models.map(m => ({
      id: m.id,
      object: 'model',
      created,
      owned_by: 'excuse',
    })),
  }
}
