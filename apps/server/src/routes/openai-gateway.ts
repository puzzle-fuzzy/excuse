import type { OutputResult } from '@excuse/db'
import type { OpenAIChatRequest } from '@excuse/shared'
import type { ServerConfig } from '../config'
import { calculateCost } from '@excuse/billing'
import {
  createGenerationRecord,
  CreditError,
  debitCredit,
  listGatewayUsageRecords,
  markGenerationFailed,
  markGenerationSucceeded,
  refundCredit,
  reserveCredit,
} from '@excuse/db'
import {
  createOpenAIChatResponse,
  createOpenAIError,
  createOpenAIModelsResponse,
  isOpenAIGatewayError,
  normalizeOpenAIChatRequest,
  OPENAI_GATEWAY_ERROR_CODES,
} from '@excuse/gateway'
import { DashScopeClient, getModelById, getModelsByCategory, validateAndMerge } from '@excuse/provider'
import { extractBillingParams } from '@excuse/shared'
import { Elysia, t } from 'elysia'
import { createRequireAuthPlugin } from '../plugins/auth'
import { audit } from '../services/audit'
import { recordGenerationStatus } from '../services/metrics'
import { createDedupeKey } from '../utils/dedupe-key'
import { notifyInsufficientBalance } from './notifications'

/**
 * OpenAI 兼容网关 — /v1/chat/completions
 *
 * 提供与 OpenAI Chat Completions API 兼容的文本生成端点，
 * 供外部开发者工具接入使用。仅支持文本模型。
 *
 * 认证：API Key（Bearer exc_xxx）或 JWT
 * 计费：同一套 GenerationRecord + calculateCost
 */

export function createOpenAIGatewayRoutes(config: ServerConfig) {
  const client = new DashScopeClient({
    apiKey: config.dashscopeApiKey,
    baseUrl: config.dashscopeBaseUrl,
  })

  return new Elysia({ prefix: '/v1' })
    .use(createRequireAuthPlugin(config))
    .post('/chat/completions', async ({ body, userId, set }) => {
      const request = body as OpenAIChatRequest
      const normalized = normalizeOpenAIChatRequest(request)
      if (isOpenAIGatewayError(normalized)) {
        set.status = normalized.status
        return normalized.response
      }

      // 模型名解析（别名 → 内部 ID）
      const modelConfig = getModelById(normalized.internalModelId)
      if (!modelConfig) {
        const err = createOpenAIError(`Model '${request.model}' not found`, 'invalid_request_error', OPENAI_GATEWAY_ERROR_CODES.MODEL_NOT_FOUND, 404)
        set.status = err.status
        return err.response
      }

      // 仅支持文本模型
      if (modelConfig.category !== 'text') {
        const err = createOpenAIError(`Model '${request.model}' is not a text model`, 'invalid_request_error', OPENAI_GATEWAY_ERROR_CODES.INVALID_MODEL, 400)
        set.status = err.status
        return err.response
      }

      // 参数校验 + 合并默认值 — validateAndMerge 是 ValidatedModelParameters 的唯一构造路径
      const validationResult = validateAndMerge(modelConfig, normalized.parameters)
      if (!validationResult.ok) {
        const details = validationResult.errors.map(e => `${e.field}: ${e.message}`).join('; ')
        const err = createOpenAIError(details, 'invalid_request_error', OPENAI_GATEWAY_ERROR_CODES.INVALID_PARAMETERS, 400)
        set.status = err.status
        return err.response
      }
      const validatedParams = validationResult.params

      // 成本估算 — 使用 extractBillingParams 从 ValidatedModelParameters 提取计费字段
      const estimatedCost = calculateCost(modelConfig, extractBillingParams(validatedParams))
      const traceId = crypto.randomUUID()
      const taskId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const dedupeKey = await createDedupeKey({
        accountId: userId,
        model: modelConfig.id,
        parameters: validatedParams,
      })

      // 创建生成记录 — inputParams 存储 ValidatedModelParameters 的所有字段
      // source='gateway' + requestedModel 用于 usage 查询过滤与展示
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
          const err = createOpenAIError(message, 'insufficient_quota', OPENAI_GATEWAY_ERROR_CODES.INSUFFICIENT_BALANCE, 402)
          set.status = err.status
          return err.response
        }
      }

      // 调用 provider — ValidatedModelParameters 保证参数已通过校验
      const result = await client.chatCompletion(modelConfig.id, validatedParams)

      if (result.type === 'failed' || !result.success) {
        await markGenerationFailed(record.id, result.error)
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
          detail: { model: modelConfig.id, recordId: record.id, totalPriceCents: estimatedCost.totalPriceCents, status: 'failed', error: result.error },
        })
        const err = createOpenAIError(result.error, 'server_error', OPENAI_GATEWAY_ERROR_CODES.GENERATION_FAILED, 500)
        set.status = err.status
        return err.response
      }

      // 计算实际成本
      const actualCost = { ...calculateCost(modelConfig, extractBillingParams(validatedParams), result.usage), billable: true, source: 'actual' as const }
      const text = result.output.text

      // 更新记录为成功
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

      return createOpenAIChatResponse({
        id: record.id,
        createdAt: record.createdAt,
        requestedModel: request.model,
        text,
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
      })
    }, {
      body: t.Object({
        model: t.String(),
        messages: t.Array(t.Object({
          role: t.Union([t.Literal('system'), t.Literal('user'), t.Literal('assistant')]),
          content: t.String(),
        })),
        temperature: t.Optional(t.Number()),
        max_tokens: t.Optional(t.Number()),
        top_p: t.Optional(t.Number()),
        stream: t.Optional(t.Boolean()),
      }),
      detail: {
        summary: 'OpenAI 兼容文本生成',
        description: '与 OpenAI Chat Completions API 兼容的文本生成端点，仅支持文本模型',
        tags: ['OpenAI 网关'],
        security: [{ bearerAuth: [] }],
      },
    })
    .get('/models', async () => {
      const textModels = getModelsByCategory('text')
      return createOpenAIModelsResponse(textModels)
    }, {
      detail: {
        summary: '列出可用文本模型',
        description: '返回所有可用的文本生成模型（OpenAI 格式）',
        tags: ['OpenAI 网关'],
        security: [{ bearerAuth: [] }],
      },
    })
    .get('/usage', async ({ userId, query }) => {
      // Elysia schema 已经把 days / limit 限定在 1-90 / 1-100；这里再做一次防御性 clamp，
      // 防止后续 schema 调整或 bypass 时把 >100 的 limit 透传到 DB 查询。
      const days = Math.min(Math.max(Math.trunc(query.days ?? 30), 1), 90)
      const limit = Math.min(Math.max(Math.trunc(query.limit ?? 50), 1), 100)

      const createdTo = new Date()
      const createdFrom = new Date(createdTo.getTime() - days * 24 * 60 * 60 * 1000)

      const records = await listGatewayUsageRecords({
        accountId: userId,
        createdFrom,
        createdTo,
        limit,
        offset: 0,
      })

      let totalCalls = 0
      let succeededCalls = 0
      let failedCalls = 0
      let totalTokens = 0
      let totalPriceCents = 0
      const items = records.map((record) => {
        totalCalls++
        if (record.status === 'succeeded')
          succeededCalls++
        if (record.status === 'failed')
          failedCalls++

        const cost = record.cost ?? null
        const inputTokens = cost?.inputTokens ?? null
        const outputTokens = cost?.outputTokens ?? null
        const tokenSum = (inputTokens ?? 0) + (outputTokens ?? 0)
        if (inputTokens !== null && outputTokens !== null)
          totalTokens += tokenSum

        const price = record.totalPriceCents ?? cost?.totalPriceCents ?? 0
        totalPriceCents += price

        const requestedModel = (record.inputParams as { requestedModel?: unknown } | null)?.requestedModel
        return {
          id: record.id,
          model: record.model,
          requestedModel: typeof requestedModel === 'string' ? requestedModel : null,
          status: record.status,
          inputTokens,
          outputTokens,
          totalTokens: inputTokens !== null && outputTokens !== null ? tokenSum : null,
          totalPriceCents: price,
          errorMessage: record.errorMessage,
          createdAt: record.createdAt.toISOString(),
        }
      })

      return {
        totalCalls,
        succeededCalls,
        failedCalls,
        totalTokens,
        totalPriceCents,
        items,
      }
    }, {
      query: t.Object({
        days: t.Optional(t.Number({ minimum: 1, maximum: 90 })),
        limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
      }),
      response: {
        200: t.Object({
          totalCalls: t.Number(),
          succeededCalls: t.Number(),
          failedCalls: t.Number(),
          totalTokens: t.Number(),
          totalPriceCents: t.Number(),
          items: t.Array(t.Object({
            id: t.String(),
            model: t.String(),
            requestedModel: t.Union([t.String(), t.Null()]),
            status: t.Union([
              t.Literal('pending'),
              t.Literal('submitting'),
              t.Literal('processing'),
              t.Literal('saving_output'),
              t.Literal('succeeded'),
              t.Literal('failed'),
              t.Literal('cancelled'),
            ]),
            inputTokens: t.Union([t.Number(), t.Null()]),
            outputTokens: t.Union([t.Number(), t.Null()]),
            totalTokens: t.Union([t.Number(), t.Null()]),
            totalPriceCents: t.Number(),
            errorMessage: t.Union([t.String(), t.Null()]),
            createdAt: t.String(),
          })),
        }),
      },
      detail: {
        summary: '查询当前用户 Gateway 调用用量',
        description: '返回最近一段时间的 Gateway 调用聚合摘要与最近调用列表（不含 prompt 全文）',
        tags: ['OpenAI 网关'],
        security: [{ bearerAuth: [] }],
      },
    })
}
