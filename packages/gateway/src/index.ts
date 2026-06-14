import type { OpenAIChatCompletionChunk, OpenAIChatRequest, OpenAIChatResponse, OpenAIErrorResponse, OpenAIGatewayUsageItem, OpenAIGatewayUsageResponse, OpenAIModelsResponse } from '@excuse/shared'
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
  STREAMING_MODEL_NOT_SUPPORTED: 'streaming_model_not_supported',
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
 * - stream：是否走流式响应 — route 据此分流，normalize 不再拒绝
 */
export interface NormalizedOpenAIChatRequest {
  request: OpenAIChatRequest
  internalModelId: string
  prompt: string
  parameters: Record<string, unknown>
  stream: boolean
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
  return createOpenAIError(
    `Model '${model}' not found`,
    'invalid_request_error',
    OPENAI_GATEWAY_ERROR_CODES.MODEL_NOT_FOUND,
    404,
  )
}

/** 模型存在但不支持当前操作（如非文本模型用于 chat completions） */
export function invalidModelError(model: string): OpenAIGatewayError {
  return createOpenAIError(
    `Model '${model}' is not a text model`,
    'invalid_request_error',
    OPENAI_GATEWAY_ERROR_CODES.INVALID_MODEL,
    400,
  )
}

/** 参数校验失败 — 接收 ValidationResult.errors，拼成单条 message */
export function invalidParametersError(
  errors: Array<{ field: string, message: string }>,
): OpenAIGatewayError {
  const details = errors.map(e => `${e.field}: ${e.message}`).join('; ')
  return createOpenAIError(
    details,
    'invalid_request_error',
    OPENAI_GATEWAY_ERROR_CODES.INVALID_PARAMETERS,
    400,
  )
}

/** 请求缺少有效的 user message */
export function missingUserMessageError(): OpenAIGatewayError {
  return createOpenAIError(
    'No user message provided',
    'invalid_request_error',
    OPENAI_GATEWAY_ERROR_CODES.MISSING_USER_MESSAGE,
    400,
  )
}

/** 用户余额不足以执行生成 */
export function insufficientBalanceError(): OpenAIGatewayError {
  return createOpenAIError(
    'Insufficient balance to complete the request',
    'insufficient_quota',
    OPENAI_GATEWAY_ERROR_CODES.INSUFFICIENT_BALANCE,
    402,
  )
}

/** Provider 调用失败（DashScope / 上游模型错误） */
export function generationFailedError(message: string): OpenAIGatewayError {
  return createOpenAIError(
    message,
    'server_error',
    OPENAI_GATEWAY_ERROR_CODES.GENERATION_FAILED,
    500,
  )
}

/**
 * 把 OpenAI Chat Completions 请求归一化为内部参数。
 *
 * 返回值是联合类型（NormalizedOpenAIChatRequest | OpenAIGatewayError），
 * 调用方必须先用 isOpenAIGatewayError() 做类型收窄。
 *
 * 规则：
 *   - stream 字段透传到返回值；route 层根据模型协议决定是否支持
 *   - 没有 user 消息 → 400 missing_user_message
 *   - 否则取最后一条 user 消息作为 prompt，附上 temperature/max_tokens/top_p（仅当用户显式传入时）
 */
export function normalizeOpenAIChatRequest(request: OpenAIChatRequest): NormalizedOpenAIChatRequest | OpenAIGatewayError {
  const userMessages = request.messages.filter(m => m.role === 'user')
  if (userMessages.length === 0) {
    return missingUserMessageError()
  }

  const lastUserMessage = userMessages[userMessages.length - 1]
  if (!lastUserMessage) {
    return missingUserMessageError()
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
    stream: request.stream ?? false,
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

/** 构造 chat.completion.chunk 帧 */
export interface OpenAIStreamChunkInput {
  id: string
  createdAt: Date
  requestedModel: string
  delta: string
  finishReason: 'stop' | 'length' | null
  isFirst: boolean
  usage?: { prompt_tokens: number, completion_tokens: number }
}

/**
 * 构造一个 OpenAI 兼容的 chat.completion.chunk 数据帧。
 *
 * - 首帧（isFirst=true）的 delta 带 `role: 'assistant'`，与 OpenAI SDK 行为一致。
 * - usage 仅在终止帧传入；其余帧 usage 为 undefined。
 */
export function createOpenAIStreamChunk(input: OpenAIStreamChunkInput): OpenAIChatCompletionChunk {
  return {
    id: input.id,
    object: 'chat.completion.chunk',
    created: Math.floor(input.createdAt.getTime() / 1000),
    model: input.requestedModel,
    choices: [{
      index: 0,
      delta: input.isFirst
        ? { role: 'assistant', content: input.delta }
        : { content: input.delta },
      finish_reason: input.finishReason,
    }],
    usage: input.usage
      ? {
          prompt_tokens: input.usage.prompt_tokens,
          completion_tokens: input.usage.completion_tokens,
          total_tokens: input.usage.prompt_tokens + input.usage.completion_tokens,
        }
      : undefined,
  }
}

/** 把单个 chunk 序列化为 SSE 数据帧（含尾部 `\n\n`） */
export function serializeOpenAIStreamChunk(chunk: OpenAIChatCompletionChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`
}

/** SSE 结束标记 */
export const OPENAI_STREAM_DONE = 'data: [DONE]\n\n'

/**
 * /v1/usage 聚合所需的最小记录输入。
 *
 * route 从 generation_records 抽出这组字段后传给 packages/gateway，
 * 避免 gateway 直接依赖 GenerationRecordRow 全字段（其中包含 prompt 等
 * 不应进入 usage 列表的字段）。
 *
 * - inputParams.requestedModel：用户传入的原始模型别名（gpt-4o-mini 等）
 * - cost / totalPriceCents：用于聚合 token 数与金额
 * - status：用于按状态分桶
 */
export interface GatewayUsageRecordInput {
  id: string
  model: string
  status: 'pending' | 'submitting' | 'processing' | 'saving_output' | 'succeeded' | 'failed' | 'cancelled'
  inputParams: { requestedModel?: unknown } | null
  cost: {
    inputTokens?: number | null
    outputTokens?: number | null
    totalPriceCents?: number | null
  } | null
  totalPriceCents: number | null
  errorMessage: string | null
  createdAt: Date
}

/**
 * 把单条 generation_records 行映射成 /v1/usage items 数组的一个元素。
 *
 * 注意：
 *   - inputTokens / outputTokens 任一为 null 时，totalTokens 输出 null（不强行抹零）。
 *   - totalPriceCents 优先用 row 顶层字段，回落 cost.totalPriceCents，再回落 0。
 *   - requestedModel 只接受字符串，其余情况输出 null。
 *   - createdAt 必须 toISOString()，不允许 Date 对象泄露到 API 响应。
 */
export function mapGatewayUsageItem(record: GatewayUsageRecordInput): OpenAIGatewayUsageItem {
  const cost = record.cost ?? null
  const inputTokens = cost?.inputTokens ?? null
  const outputTokens = cost?.outputTokens ?? null
  const tokenSum = (inputTokens ?? 0) + (outputTokens ?? 0)

  const requestedModelRaw = record.inputParams?.requestedModel
  const requestedModel = typeof requestedModelRaw === 'string' ? requestedModelRaw : null

  return {
    id: record.id,
    model: record.model,
    requestedModel,
    status: record.status,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens !== null && outputTokens !== null ? tokenSum : null,
    totalPriceCents: record.totalPriceCents ?? cost?.totalPriceCents ?? 0,
    errorMessage: record.errorMessage,
    createdAt: record.createdAt.toISOString(),
  }
}

/**
 * 聚合一组 generation_records 行为 /v1/usage 响应。
 *
 * 规则：
 *   - totalCalls = items.length（输入数组长度）。
 *   - succeededCalls / failedCalls 按 status 严格相等匹配；其他状态不计入这两桶。
 *   - totalTokens 只在 inputTokens 与 outputTokens 同时非 null 时累加 tokenSum，
 *     避免部分缺失的记录被半价计入。
 *   - totalPriceCents 优先 row.totalPriceCents，回落 cost.totalPriceCents，再回落 0。
 *
 * 输入空数组时返回零值响应（totalCalls=0、items=[]）。
 */
export function aggregateGatewayUsage(records: GatewayUsageRecordInput[]): OpenAIGatewayUsageResponse {
  let succeededCalls = 0
  let failedCalls = 0
  let totalTokens = 0
  let totalPriceCents = 0

  const items = records.map((record) => {
    if (record.status === 'succeeded')
      succeededCalls++
    if (record.status === 'failed')
      failedCalls++

    const item = mapGatewayUsageItem(record)
    if (item.inputTokens !== null && item.outputTokens !== null)
      totalTokens += item.inputTokens + item.outputTokens
    totalPriceCents += item.totalPriceCents
    return item
  })

  return {
    totalCalls: items.length,
    succeededCalls,
    failedCalls,
    totalTokens,
    totalPriceCents,
    items,
  }
}
