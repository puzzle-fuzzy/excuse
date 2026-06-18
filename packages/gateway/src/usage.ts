import type { OpenAIGatewayUsageItem, OpenAIGatewayUsageResponse } from '@excuse/shared'
import { gatewayUsageRecordSchema } from './schemas'

/**
 * @excuse/gateway — 用量聚合模块
 *
 * 把 generation_records 行映射为 /v1/usage items 并聚合成 API 响应。
 * 与 errors / protocol 模块无耦合 —— 仅依赖 shared 类型与本地 schemas。
 */

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
 *   - 先用 `gatewayUsageRecordSchema.safeParse(record)` 做字段类型守卫
 *     （route 传的是 DB JSONB 反序列化结果，旧 record 字段可能缺失或类型错误）。
 *     parse 失败时降级到原 record 走既有兜底逻辑，**不抛错**（保持向后兼容）。
 *   - inputTokens / outputTokens 任一为 null 时，totalTokens 输出 null（不强行抹零）。
 *   - totalPriceCents 优先用 row 顶层字段，回落 cost.totalPriceCents，再回落 0。
 *   - requestedModel 只接受字符串，其余情况输出 null。
 *   - createdAt 必须 toISOString()，不允许 Date 对象泄露到 API 响应。
 */
export function mapGatewayUsageItem(record: GatewayUsageRecordInput): OpenAIGatewayUsageItem {
  // zod 类型守卫：合法 record 走 parsed.data；非法 shape 回落到原 record 让既有 ?? null 兜底
  const parsed = gatewayUsageRecordSchema.safeParse(record)
  const value = parsed.success ? parsed.data : record

  const cost = value.cost ?? null
  const inputTokens = cost?.inputTokens ?? null
  const outputTokens = cost?.outputTokens ?? null
  const tokenSum = (inputTokens ?? 0) + (outputTokens ?? 0)

  const requestedModelRaw = value.inputParams?.requestedModel
  const requestedModel = typeof requestedModelRaw === 'string' ? requestedModelRaw : null

  return {
    id: value.id,
    model: value.model,
    requestedModel,
    status: value.status,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens !== null && outputTokens !== null ? tokenSum : null,
    totalPriceCents: value.totalPriceCents ?? cost?.totalPriceCents ?? 0,
    errorMessage: value.errorMessage,
    createdAt: value.createdAt.toISOString(),
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
