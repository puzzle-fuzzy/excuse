import type { OutputResult } from '@excuse/db'
import type { ValidatedModelParameters } from '@excuse/provider'
import type { ModelConfig, OpenAIChatRequest } from '@excuse/shared'
import type { ApiKeyMeta } from '../plugins/auth'
import { calculateCost, getBillingPolicy } from '@excuse/billing'
import {
  createGenerationRecord,
  incrementApiKeySpend,
  markGenerationFailed,
  markGenerationSucceeded,
} from '@excuse/db'
import {
  generationFailedError,
  insufficientBalanceError,
} from '@excuse/gateway'
import { extractBillingParams, logger } from '@excuse/shared'
import { createDedupeKey } from '../utils/dedupe-key'
import { audit } from './audit'
import { debitReservedAndTrack, refundReservedAndTrack, reserveAndTrack } from './billing-ledger'
import { recordGenerationStatus } from './metrics'
import { notifyApiKeyQuota, notifyProviderFailure } from './notifications'

export interface ProviderCallResult {
  text: string
  usage?: { inputTokens?: number, outputTokens?: number }
}

export interface GatewayChatCompletionInput {
  userId: string
  modelConfig: ModelConfig
  validatedParams: ValidatedModelParameters
  request: OpenAIChatRequest
  callProvider: () => Promise<ProviderCallResult>
  apiKeyMeta?: ApiKeyMeta
}

export type GatewayChatCompletionOutput = {
  success: true
  recordId: string
  text: string
  usage?: { inputTokens?: number, outputTokens?: number }
  createdAt: Date
} | {
  success: false
  status: number
  response: Record<string, unknown>
}

// ── 抽取的共用编排原语 ──────────────────────────────────────

/** setupGatewayCall 的返回结果 */
export interface GatewaySetupResult {
  recordId: string
  estimatedCost: { totalPriceCents: number }
}

/** settleGatewaySuccess 的输入参数 */
export interface GatewaySuccessInput {
  userId: string
  modelConfig: ModelConfig
  validatedParams: ValidatedModelParameters
  recordId: string
  estimatedCost: { totalPriceCents: number }
  text: string
  usage?: { inputTokens?: number, outputTokens?: number }
  apiKeyMeta?: ApiKeyMeta
}

/** settleGatewayFailure 的输入参数 */
export interface GatewayFailureInput {
  userId: string
  modelConfig: ModelConfig
  recordId: string
  estimatedCost: { totalPriceCents: number }
  error: Error | unknown
}

/**
 * 网关调用前置准备：估算成本 → 创建记录 → 预留额度
 *
 * stream 和非 stream 路径共用此函数，减少编排重复。
 * 失败时返回错误响应（含 status + response），调用方应直接返回给客户端。
 */
export async function setupGatewayCall(opts: {
  userId: string
  modelConfig: ModelConfig
  validatedParams: ValidatedModelParameters
  request: OpenAIChatRequest
}): Promise<{ ok: true, result: GatewaySetupResult } | { ok: false, status: number, response: Record<string, unknown> }> {
  const { userId, modelConfig, validatedParams, request } = opts

  const estimatedCost = calculateCost(modelConfig, extractBillingParams(validatedParams))
  const traceId = crypto.randomUUID()
  const taskId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const dedupeKey = await createDedupeKey({
    accountId: userId,
    model: modelConfig.id,
    parameters: validatedParams,
  })

  const record = await createGenerationRecord({
    accountId: userId,
    taskId,
    traceId,
    model: modelConfig.id,
    category: 'text',
    status: 'pending',
    inputParams: { ...validatedParams, source: 'gateway', requestedModel: request.model },
    cost: { ...estimatedCost, estimated: true, billable: false, source: 'estimated' },
    dedupeKey,
  })

  if (estimatedCost.totalPriceCents > 0) {
    const reservation = await reserveAndTrack({
      accountId: userId,
      recordId: record.id,
      amountCents: estimatedCost.totalPriceCents,
      description: `OpenAI 网关预留：${modelConfig.id}`,
      source: 'gateway',
    })
    if (!reservation.ok) {
      await markGenerationFailed(record.id, reservation.message)
      recordGenerationStatus('failed')
      const err = insufficientBalanceError()
      return { ok: false, status: err.status, response: err.response as unknown as Record<string, unknown> }
    }
  }

  return { ok: true, result: { recordId: record.id, estimatedCost } }
}

/**
 * 网关调用成功结算：标记成功 → 扣款 → 审计 → API Key 追踪
 *
 * stream 和非 stream 路径共用。
 */
export async function settleGatewaySuccess(opts: GatewaySuccessInput): Promise<void> {
  const { userId, modelConfig, validatedParams, recordId, text, usage, apiKeyMeta, estimatedCost } = opts

  const actualCost = {
    ...calculateCost(modelConfig, extractBillingParams(validatedParams), usage),
    billable: true,
    source: 'actual' as const,
  }

  // 超额保护：实际费用超过预估 1.5 倍时拒绝扣款并退款（防穿负，TODO §1.2）
  // 抛出错误由调用方的 catch 块统一走 settleGatewayFailure 收尾
  const exceededThreshold = estimatedCost.totalPriceCents > 0
    && actualCost.totalPriceCents > estimatedCost.totalPriceCents * 1.5
  if (exceededThreshold) {
    throw new Error(
      `实际费用 ${actualCost.totalPriceCents} 分超过预估 ${estimatedCost.totalPriceCents} 分的 1.5 倍，已自动取消`,
    )
  }

  const textOutput: OutputResult = { type: 'text' as const, text }
  await markGenerationSucceeded(recordId, textOutput, actualCost)
  recordGenerationStatus('succeeded')

  if (actualCost.totalPriceCents > 0) {
    await debitReservedAndTrack({
      accountId: userId,
      recordId,
      amountCents: actualCost.totalPriceCents,
      description: `OpenAI 网关扣款：${modelConfig.id}`,
      source: 'gateway',
    })
  }

  audit('gateway_call', {
    accountId: userId,
    targetId: recordId,
    detail: {
      model: modelConfig.id,
      recordId,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      totalPriceCents: actualCost.totalPriceCents,
      status: 'succeeded',
    },
  })

  // API Key 额度追踪（非阻塞）
  if (apiKeyMeta && actualCost.totalPriceCents > 0) {
    incrementApiKeySpend(apiKeyMeta.id, actualCost.totalPriceCents).catch(err => logger.warn({ err, apiKeyId: apiKeyMeta.id }, 'incrementApiKeySpend failed'))
  }
  // API Key 额度即将用尽（80%）预警（非阻塞）
  if (apiKeyMeta) {
    notifyApiKeyQuota(userId, {
      keyId: apiKeyMeta.id,
      totalSpendCents: apiKeyMeta.totalSpendCents + actualCost.totalPriceCents,
      quotaMaxCents: apiKeyMeta.quotaMaxCents,
    }).catch(err => logger.warn({ err }, 'quota-80% warning notification failed'))
  }
}

/**
 * 网关调用失败结算：标记失败 → 通知 → 退款 → 审计
 *
 * stream 和非 stream 路径共用。
 */
export async function settleGatewayFailure(opts: GatewayFailureInput): Promise<void> {
  const { userId, modelConfig, recordId, estimatedCost, error } = opts

  const message = error instanceof Error ? error.message : String(error)
  await markGenerationFailed(recordId, message)
  recordGenerationStatus('failed')

  notifyProviderFailure(userId, modelConfig.id).catch(err => logger.warn({ err, userId, modelId: modelConfig.id }, 'notifyProviderFailure failed'))

  if (estimatedCost.totalPriceCents > 0) {
    await refundReservedAndTrack({
      accountId: userId,
      recordId,
      amountCents: estimatedCost.totalPriceCents,
      description: `OpenAI 网关失败退款：${modelConfig.id}`,
      source: 'gateway',
    })
  }

  audit('gateway_call', {
    accountId: userId,
    targetId: recordId,
    detail: { model: modelConfig.id, recordId, totalPriceCents: estimatedCost.totalPriceCents, status: 'failed', error: message },
  })
}

// ── 非 stream 统一编排器 ────────────────────────────────────

/**
 * OpenAI Gateway Chat Completions 统一编排器（非 stream 路径）
 *
 * 内部复用 setupGatewayCall / settleGatewaySuccess / settleGatewayFailure 三个原语。
 * stream 路径直接使用这三个原语，不经过此函数。
 *
 * @returns 成功时返回 recordId/text/usage，失败时返回 OpenAI 错误响应
 */
export async function handleGatewayChatCompletion(
  input: GatewayChatCompletionInput,
): Promise<GatewayChatCompletionOutput> {
  getBillingPolicy('openai.gateway.chat') // 保留策略校验（credit-ledger 前置断言）
  const { userId, modelConfig, validatedParams, request, callProvider, apiKeyMeta } = input

  const setup = await setupGatewayCall({ userId, modelConfig, validatedParams, request })
  if (!setup.ok) {
    return { success: false, status: setup.status, response: setup.response }
  }
  const { recordId, estimatedCost } = setup.result

  try {
    const result = await callProvider()
    await settleGatewaySuccess({
      userId,
      modelConfig,
      validatedParams,
      recordId,
      estimatedCost,
      text: result.text,
      usage: result.usage,
      apiKeyMeta,
    })
    return { success: true, recordId, text: result.text, usage: result.usage, createdAt: new Date() }
  }
  catch (error) {
    await settleGatewayFailure({ userId, modelConfig, recordId, estimatedCost, error })
    const message = error instanceof Error ? error.message : String(error)
    const err = generationFailedError(message)
    return { success: false, status: err.status, response: err.response as unknown as Record<string, unknown> }
  }
}

// ── stream 编排器 ────────────────────────────────────────────

/** stream 路径的单个 provider chunk —— service 不耦合 ReadableStream，把 chunk 交给 route 的 sink */
export interface GatewayStreamChunk {
  /** 本批增量文本（首次 chunk 含 role；后续纯 delta）；finishReason='stop' 的收尾 chunk delta 为空 */
  delta: string
  /** OpenAI 协议的 finish_reason：中间 chunk 为 null，收尾 chunk 为 'stop'（或 'length' 触顶） */
  finishReason: 'stop' | 'length' | null
  isFirst: boolean
  usage?: { inputTokens?: number, outputTokens?: number }
}

/** stream 编排器对每个 chunk 的回调 —— route 负责编码为 SSE 并写入 ReadableStream */
export type StreamChunkSink = (chunk: GatewayStreamChunk) => Promise<void> | void

/** GatewayStreamChatCompletionInput.callProvider 逐批产出的 provider 增量 */
export interface GatewayStreamProviderChunk {
  delta?: string
  usage?: { inputTokens?: number, outputTokens?: number }
}

/** stream 编排器的输入 —— 与非 stream 的 GatewayChatCompletionInput 对称但 provider 是「逐批产出」而非「一次返回」 */
export interface GatewayStreamChatCompletionInput {
  userId: string
  modelConfig: ModelConfig
  validatedParams: ValidatedModelParameters
  request: OpenAIChatRequest
  /** 逐批拉取 provider 增量（route 包装 DashScopeClient.chatCompletionStream 的 async iterator） */
  callProvider: () => AsyncIterable<GatewayStreamProviderChunk>
  apiKeyMeta?: ApiKeyMeta
}

/**
 * OpenAI Gateway Chat Completions stream 编排器
 *
 * 与 `handleGatewayChatCompletion`（非 stream）对称：复用同一套 setupGatewayCall /
 * settleGatewaySuccess / settleGatewayFailure 原语，但 provider 增量 chunk 不收集为整段文本响应，
 * 而是逐个通过 `onChunk` 回调交给 route（由 route 编码为 OpenAI SSE 写入 ReadableStream）。
 *
 * - setup 失败（余额不足）返回 `{ ok: false, status, response }`，route 直接作为非 SSE 错误响应返回。
 * - provider 抛错时 settleGatewayFailure 收尾，并向 onChunk 发送一个 finishReason='stop' 的收尾 chunk。
 * - fullText 在 service 内聚合并参与成功结算（计费用 usage）。
 *
 * ReadableStream 的构造留在 route（HTTP 契约），service 只产出 chunk 序列 ——
 * 保持 service 不耦合 Web Streams API，与非 stream 编排器的边界一致。
 */
export async function handleGatewayStreamChatCompletion(
  input: GatewayStreamChatCompletionInput,
  onChunk: StreamChunkSink,
): Promise<{ ok: true } | { ok: false, status: number, response: Record<string, unknown> }> {
  const { userId, modelConfig, validatedParams, request, callProvider, apiKeyMeta } = input

  const setup = await setupGatewayCall({ userId, modelConfig, validatedParams, request })
  if (!setup.ok) {
    return { ok: false, status: setup.status, response: setup.response }
  }
  const { recordId, estimatedCost } = setup.result

  let fullText = ''
  let lastUsage: { inputTokens?: number, outputTokens?: number } | undefined
  let isFirst = true
  try {
    for await (const chunk of callProvider()) {
      if (chunk.delta) {
        fullText += chunk.delta
        await onChunk({ delta: chunk.delta, finishReason: null, isFirst, usage: undefined })
        isFirst = false
      }
      if (chunk.usage) {
        lastUsage = chunk.usage
      }
    }
    // 收尾 chunk（finishReason='stop'）—— OpenAI 协议要求的结束标记
    await onChunk({ delta: '', finishReason: 'stop', isFirst: false, usage: lastUsage })

    await settleGatewaySuccess({
      userId,
      modelConfig,
      validatedParams,
      recordId,
      estimatedCost,
      text: fullText,
      usage: lastUsage,
      apiKeyMeta,
    })
    return { ok: true }
  }
  catch (error) {
    await settleGatewayFailure({ userId, modelConfig, recordId, estimatedCost, error })
    // 失败也发收尾 chunk，让客户端的流干净结束（错误信息已在 settleGatewayFailure 记账）
    await onChunk({ delta: '', finishReason: 'stop', isFirst: false, usage: lastUsage })
    return { ok: true }
  }
}
