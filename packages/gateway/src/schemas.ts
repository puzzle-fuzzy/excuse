import { z } from 'zod'

/**
 * OpenAI Chat Completions 请求的 zod schema（运行时镜像 @excuse/shared 的 OpenAIChatRequest type）。
 *
 * 用于 normalizeOpenAIChatRequest 的运行时校验：route 层传入的是 Elysia 解析的 JSON，
 * 可能是任意 shape（客户端把 messages 传成 string、把 temperature 传成字符串等）。
 * safeParse 失败时，构造 invalidParametersError。
 *
 * 用 `.loose()`（zod v4 推荐，v3 `.passthrough()` 已 deprecated）让 `n` / `presence_penalty`
 * 等 OpenAI 标准未声明字段透传，后续内部 mapping 只取已声明字段。
 */
export const openaiChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
})

export const openaiChatRequestSchema = z.object({
  model: z.string(),
  messages: z.array(openaiChatMessageSchema).min(1),
  temperature: z.number().optional(),
  max_tokens: z.number().int().positive().optional(),
  top_p: z.number().optional(),
  stream: z.boolean().optional(),
}).loose()

export type OpenAIChatRequestParsed = z.infer<typeof openaiChatRequestSchema>

/**
 * mapGatewayUsageItem 输入记录的 zod schema。
 *
 * route 层从 generation_records 抽出 cost / inputParams 等字段后传给 gateway，
 * 这些字段来自 DB JSONB，运行时可能是任意 shape（旧 record 字段缺失、字段类型错误）。
 * safeParse 失败时 mapGatewayUsageItem 降级到 null/0 兜底，不抛错（保持向后兼容）。
 */
const gatewayUsageCostSchema = z.object({
  inputTokens: z.number().nullable().optional(),
  outputTokens: z.number().nullable().optional(),
  totalPriceCents: z.number().nullable().optional(),
}).nullable()

const gatewayUsageInputParamsSchema = z.object({
  requestedModel: z.unknown().optional(),
}).nullable()

export const gatewayUsageRecordSchema = z.object({
  id: z.string(),
  model: z.string(),
  status: z.enum(['pending', 'submitting', 'processing', 'saving_output', 'succeeded', 'failed', 'cancelled']),
  inputParams: gatewayUsageInputParamsSchema,
  cost: gatewayUsageCostSchema,
  totalPriceCents: z.number().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.date(),
})

export type GatewayUsageRecordParsed = z.infer<typeof gatewayUsageRecordSchema>
