// ── OpenAI 兼容网关 DTO ──────────────────────────────────

/** OpenAI Chat Completions 请求体 */
export interface OpenAIChatRequest {
  model: string
  messages: Array<OpenAIChatMessage>
  temperature?: number
  max_tokens?: number
  top_p?: number
  stream?: boolean
}

export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** OpenAI Chat Completions 响应体 */
export interface OpenAIChatResponse {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  choices: Array<{
    index: number
    message: { role: 'assistant', content: string }
    finish_reason: 'stop' | 'length'
  }>
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

/** OpenAI Models 响应体 */
export interface OpenAIModelsResponse {
  object: 'list'
  data: Array<{
    id: string
    object: 'model'
    created: number
    owned_by: string
  }>
}

/**
 * OpenAI chat.completion.chunk 单个 SSE 数据帧
 *
 * 流式响应中每一帧的格式。usage 通常只在最后一帧带（OpenAI 习惯）。
 */
export interface OpenAIChatCompletionChunk {
  id: string
  object: 'chat.completion.chunk'
  created: number
  model: string
  choices: Array<{
    index: number
    delta: { role?: 'assistant', content?: string }
    finish_reason: 'stop' | 'length' | null
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

/** OpenAI 错误响应 */
export interface OpenAIErrorResponse {
  error: {
    message: string
    type: string
    code: string
  }
}

/** OpenAI 网关调用状态 — 与 generation_records.status 枚举对齐 */
export type OpenAIGatewayUsageStatus
  = | 'pending'
    | 'submitting'
    | 'processing'
    | 'saving_output'
    | 'succeeded'
    | 'failed'
    | 'cancelled'

/** 单条 Gateway 调用记录 — GET /v1/usage 返回的 items 元素 */
export interface OpenAIGatewayUsageItem {
  id: string
  /** 内部模型 ID（解析别名后），例如 qwen-max */
  model: string
  /** 用户传入的原始模型名（如 gpt-4o-mini）；旧数据可能为 null */
  requestedModel: string | null
  status: OpenAIGatewayUsageStatus
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  totalPriceCents: number
  errorMessage: string | null
  createdAt: string
}

/** GET /v1/usage 响应 — 聚合摘要 + 最近调用列表 */
export interface OpenAIGatewayUsageResponse {
  totalCalls: number
  succeededCalls: number
  failedCalls: number
  totalTokens: number
  totalPriceCents: number
  items: OpenAIGatewayUsageItem[]
}

/** 模型别名映射（OpenAI 风格名 → 内部 model ID） */
export const MODEL_ALIASES: Record<string, string> = {
  'gpt-4': 'qwen-max',
  'gpt-4o': 'qwen-max',
  'gpt-3.5-turbo': 'qwen-turbo',
  'gpt-4o-mini': 'qwen-plus',
}

/** 将用户传入的模型名解析为内部 ID */
export function resolveModelId(model: string): string {
  return MODEL_ALIASES[model] ?? model
}
