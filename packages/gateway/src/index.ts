/**
 * @excuse/gateway —— OpenAI 兼容网关的纯规则包（无 IO 依赖）
 *
 * 职责：在「OpenAI 协议格式」和「内部 DashScope 单轮 prompt 格式」之间做无状态转换。
 *   - 入站：把 OpenAI Chat Completions 请求归一化成内部参数（取最后一条 user 消息作为 prompt）
 *   - 出站：把内部生成结果封装成 OpenAI 兼容响应（chat.completion / models list）
 *   - 错误：统一构造符合 OpenAI 错误结构的 4xx 响应
 *   - 用量：/v1/usage 聚合
 *
 * 调用方：apps/server/src/routes/openai-gateway.ts（/api/openai/* 路由）。
 * 设计约束：本包不感知 HTTP / DB / provider，只做类型与字段映射，便于单测覆盖。
 *
 * 模块拆分：
 *   - errors.ts   — 错误码常量 + createOpenAIError + 语义化错误工厂
 *   - protocol.ts — normalizeOpenAIChatRequest + 响应/流式构建
 *   - usage.ts    — mapGatewayUsageItem + aggregateGatewayUsage
 */

// ── errors ──
export {
  apiKeyQuotaExceededError,
  apiKeyScopeNotAllowedError,
  createOpenAIError,
  generationFailedError,
  insufficientBalanceError,
  invalidModelError,
  invalidParametersError,
  missingUserMessageError,
  modelNotFoundError,
  OPENAI_GATEWAY_ERROR_CODES,
} from './errors'
export type { OpenAIGatewayError, OpenAIGatewayErrorCode } from './errors'

// ── protocol ──
export {
  createOpenAIChatResponse,
  createOpenAIModelsResponse,
  createOpenAIStreamChunk,
  isOpenAIGatewayError,
  normalizeOpenAIChatRequest,
  OPENAI_STREAM_DONE,
  serializeOpenAIStreamChunk,
} from './protocol'
export type {
  GatewayModelListItem,
  NormalizedOpenAIChatRequest,
  OpenAIChatResponseInput,
  OpenAIStreamChunkInput,
} from './protocol'

// ── usage ──
export { aggregateGatewayUsage, mapGatewayUsageItem } from './usage'
export type { GatewayUsageRecordInput } from './usage'
