import type { OutputResult } from '@excuse/db'
import type { ValidatedModelParameters } from '@excuse/provider'
import type { ModelConfig, OpenAIChatRequest } from '@excuse/shared'
import { calculateCost } from '@excuse/billing'
import {
  createGenerationRecord,
  CreditError,
  debitCredit,
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
import { notifyInsufficientBalance } from '../routes/notifications'
import { createDedupeKey } from '../utils/dedupe-key'
import { audit } from './audit'
import { recordGenerationStatus } from './metrics'

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

/**
 * OpenAI Gateway Chat Completions 统一编排器
 *
 * 处理创建记录、预留额度、调用 provider、标记成功/失败、扣款/退款、审计 的全流程。
 * stream 和非 stream 路径共用此编排，减少路由层的编排重复。
 *
 * @returns 成功时返回 recordId/text/usage，失败时返回 OpenAI 错误响应
 */
export async function handleGatewayChatCompletion(
  input: GatewayChatCompletionInput,
): Promise<GatewayChatCompletionOutput> {
  const { userId, modelConfig, validatedParams, request, callProvider } = input

  // 成本估算
  const estimatedCost = calculateCost(modelConfig, extractBillingParams(validatedParams))
  const traceId = crypto.randomUUID()
  const taskId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const dedupeKey = await createDedupeKey({
    accountId: userId,
    model: modelConfig.id,
    parameters: validatedParams,
  })

  // 创建生成记录
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

  // 预留额度
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
      return { success: false, status: err.status, response: err.response as unknown as Record<string, unknown> }
    }
  }

  // 调用 provider
  try {
    const result = await callProvider()

    // 计算实际成本
    const actualCost = {
      ...calculateCost(modelConfig, extractBillingParams(validatedParams), result.usage),
      billable: true,
      source: 'actual' as const,
    }
    const text = result.text

    // 标记成功
    const textOutput: OutputResult = { type: 'text' as const, text }
    await markGenerationSucceeded(record.id, textOutput, actualCost)
    recordGenerationStatus('succeeded')

    if (actualCost.totalPriceCents > 0) {
      await debitCredit({
        accountId: userId,
        generationRecordId: record.id,
        actualCents: actualCost.totalPriceCents,
        description: `OpenAI 网关扣款：${modelConfig.id}`,
      })
      audit('credit_debit', {
        accountId: userId,
        targetId: record.id,
        detail: { accountId: userId, generationRecordId: record.id, amountCents: actualCost.totalPriceCents, description: `OpenAI 网关扣款：${modelConfig.id}`, source: 'gateway' },
      })
    }

    audit('gateway_call', {
      accountId: userId,
      targetId: record.id,
      detail: {
        model: modelConfig.id,
        recordId: record.id,
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        totalPriceCents: actualCost.totalPriceCents,
        status: 'succeeded',
      },
    })

    return { success: true, recordId: record.id, text, usage: result.usage, createdAt: record.createdAt }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await markGenerationFailed(record.id, message)
    recordGenerationStatus('failed')

    if (estimatedCost.totalPriceCents > 0) {
      await refundCredit({
        accountId: userId,
        generationRecordId: record.id,
        description: `OpenAI 网关失败退款：${modelConfig.id}`,
      })
      audit('credit_refund', {
        accountId: userId,
        targetId: record.id,
        detail: { accountId: userId, generationRecordId: record.id, amountCents: estimatedCost.totalPriceCents, description: `OpenAI 网关失败退款：${modelConfig.id}`, source: 'gateway' },
      })
    }

    audit('gateway_call', {
      accountId: userId,
      targetId: record.id,
      detail: { model: modelConfig.id, recordId: record.id, totalPriceCents: estimatedCost.totalPriceCents, status: 'failed', error: message },
    })

    const err = generationFailedError(message)
    return { success: false, status: err.status, response: err.response as unknown as Record<string, unknown> }
  }
}
