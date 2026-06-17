import type { OutputResult } from '@excuse/db'
import type { ValidatedModelParameters } from '@excuse/provider'
import type { ModelConfig, OpenAIChatRequest } from '@excuse/shared'
import { assertCreditLedgerPolicy, calculateCost, getBillingPolicy } from '@excuse/billing'
import {
  createGenerationRecord,
  CreditError,
  debitCredit,
  incrementApiKeySpend,
  markGenerationFailed,
  markGenerationSucceeded,
  refundCredit,
  reserveCredit,
} from '@excuse/db'
import {
  generationFailedError,
  insufficientBalanceError,
} from '@excuse/gateway'
import { extractBillingParams } from '@excuse/shared'
import type { ApiKeyMeta } from '../plugins/auth'
import { createDedupeKey } from '../utils/dedupe-key'
import { audit } from './audit'
import { recordGenerationStatus } from './metrics'
import { notifyApiKeyQuota, notifyInsufficientBalance, notifyProviderFailure } from './notifications'

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
    try {
      await reserveCredit({
        accountId: userId,
        generationRecordId: record.id,
        amountCents: estimatedCost.totalPriceCents,
        description: `OpenAI 网关预留：${modelConfig.id}`,
      })
      audit('credit_reserve', {
        accountId: userId,
        targetId: record.id,
        detail: { accountId: userId, generationRecordId: record.id, amountCents: estimatedCost.totalPriceCents, description: `OpenAI 网关预留：${modelConfig.id}`, source: 'gateway' },
      })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Insufficient balance'
      if (error instanceof CreditError && error.code === 'INSUFFICIENT_BALANCE') {
        await notifyInsufficientBalance(userId).catch(() => {})
      }
      await markGenerationFailed(record.id, message)
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
  const { userId, modelConfig, validatedParams, recordId, estimatedCost, text, usage, apiKeyMeta } = opts

  const actualCost = {
    ...calculateCost(modelConfig, extractBillingParams(validatedParams), usage),
    billable: true,
    source: 'actual' as const,
  }
  const textOutput: OutputResult = { type: 'text' as const, text }
  await markGenerationSucceeded(recordId, textOutput, actualCost)
  recordGenerationStatus('succeeded')

  if (actualCost.totalPriceCents > 0) {
    await debitCredit({
      accountId: userId,
      generationRecordId: recordId,
      actualCents: actualCost.totalPriceCents,
      description: `OpenAI 网关扣款：${modelConfig.id}`,
    })
    audit('credit_debit', {
      accountId: userId,
      targetId: recordId,
      detail: { accountId: userId, generationRecordId: recordId, amountCents: actualCost.totalPriceCents, description: `OpenAI 网关扣款：${modelConfig.id}`, source: 'gateway' },
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
    incrementApiKeySpend(apiKeyMeta.id, actualCost.totalPriceCents).catch(() => {})
  }
  // API Key 额度即将用尽（80%）预警（非阻塞）
  if (apiKeyMeta) {
    notifyApiKeyQuota(userId, {
      keyId: apiKeyMeta.id,
      totalSpendCents: apiKeyMeta.totalSpendCents + actualCost.totalPriceCents,
      quotaMaxCents: apiKeyMeta.quotaMaxCents,
    }).catch(() => {})
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

  notifyProviderFailure(userId, modelConfig.id).catch(() => {})

  if (estimatedCost.totalPriceCents > 0) {
    await refundCredit({
      accountId: userId,
      generationRecordId: recordId,
      description: `OpenAI 网关失败退款：${modelConfig.id}`,
    })
    audit('credit_refund', {
      accountId: userId,
      targetId: recordId,
      detail: { accountId: userId, generationRecordId: recordId, amountCents: estimatedCost.totalPriceCents, description: `OpenAI 网关失败退款：${modelConfig.id}`, source: 'gateway' },
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
      userId, modelConfig, validatedParams, recordId, estimatedCost,
      text: result.text, usage: result.usage, apiKeyMeta,
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
