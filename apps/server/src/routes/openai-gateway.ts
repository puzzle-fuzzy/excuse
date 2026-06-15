import type { OutputResult } from '@excuse/db'
import type { ValidatedModelParameters } from '@excuse/provider'
import type { ModelConfig, OpenAIChatRequest } from '@excuse/shared'
import type { ServerConfig } from '../config'
import type { ApiKeyMeta } from '../plugins/auth'
import { calculateCost } from '@excuse/billing'
import {
  checkAndResetApiKeyQuota,
  createGenerationRecord,
  CreditError,
  debitCredit,
  incrementApiKeySpend,
  isApiKeyQuotaExceeded,
  listGatewayUsageRecords,
  markGenerationFailed,
  markGenerationSucceeded,
  refundCredit,
  reserveCredit,
} from '@excuse/db'
import {
  aggregateGatewayUsage,
  apiKeyQuotaExceededError,
  apiKeyScopeNotAllowedError,
  createOpenAIChatResponse,
  createOpenAIModelsResponse,
  createOpenAIStreamChunk,
  insufficientBalanceError,
  invalidModelError,
  invalidParametersError,
  isOpenAIGatewayError,
  modelNotFoundError,
  normalizeOpenAIChatRequest,
  OPENAI_STREAM_DONE,
  serializeOpenAIStreamChunk,
} from '@excuse/gateway'
import { DashScopeClient, getModelById, getModelsByCategory, validateAndMerge } from '@excuse/provider'
import { extractBillingParams } from '@excuse/shared'
import { Elysia, t } from 'elysia'
import { createRequireAuthPlugin } from '../plugins/auth'
import { audit } from '../services/audit'
import { handleGatewayChatCompletion } from '../services/gateway-service'
import { recordGenerationStatus } from '../services/metrics'
import { createDedupeKey } from '../utils/dedupe-key'
import { notifyInsufficientBalance } from './notifications'

const ALLOWED_API_KEY_SCOPES = ['all', 'gateway']

/**
 * 检查 API Key 是否有权限访问 Gateway。
 * 返回错误响应对象（含 status + response）或 null（允许通过）。
 */
function checkApiKeyGatewayAccess(apiKeyMeta: ApiKeyMeta): { status: number, response: Record<string, unknown> } | null {
  if (!ALLOWED_API_KEY_SCOPES.includes(apiKeyMeta.scope)) {
    const err = apiKeyScopeNotAllowedError()
    return { status: err.status, response: err.response as unknown as Record<string, unknown> }
  }
  return null
}

/**
 * 检查 API Key 是否超出额度。
 * 返回错误响应对象或 null（允许通过）。
 */
async function checkApiKeyQuota(apiKeyMeta: ApiKeyMeta): Promise<{ status: number, response: Record<string, unknown> } | null> {
  if (apiKeyMeta.quotaMaxCents === null)
    return null
  // 先尝试重置到期额度
  await checkAndResetApiKeyQuota(apiKeyMeta.id)
  const exceeded = await isApiKeyQuotaExceeded(apiKeyMeta.id)
  if (exceeded) {
    const err = apiKeyQuotaExceededError()
    return { status: err.status, response: err.response as unknown as Record<string, unknown> }
  }
  return null
}

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

  /**
   * 流式 chat completions 处理器
   *
   * 借用 handleGatewayChatCompletion 的 upfront 验证/预留逻辑，
   * 但流式返回 Response 不走标准编排器（需要 ReadableStream）。
   */
  async function handleStreamChatCompletions(opts: {
    userId: string
    modelConfig: ModelConfig
    validatedParams: ValidatedModelParameters
    request: OpenAIChatRequest
    apiKeyId?: string
  }): Promise<Response> {
    const { userId, modelConfig, validatedParams, request, apiKeyId } = opts

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
        return new Response(JSON.stringify(err.response), {
          status: err.status,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    const recordId = record.id
    const completionId = `chatcmpl-${recordId}`
    const createdAt = new Date()

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder()
        let fullText = ''
        let lastUsage: { prompt_tokens: number, completion_tokens: number } | undefined
        let isFirst = true
        try {
          for await (const chunk of client.chatCompletionStream(modelConfig.id, validatedParams)) {
            if (chunk.delta) {
              fullText += chunk.delta
              const chunkEvent = serializeOpenAIStreamChunk(createOpenAIStreamChunk({
                id: completionId,
                createdAt,
                requestedModel: request.model,
                delta: chunk.delta,
                finishReason: null,
                isFirst,
              }))
              controller.enqueue(encoder.encode(chunkEvent))
              isFirst = false
            }
            if (chunk.usage) {
              lastUsage = {
                prompt_tokens: chunk.usage.inputTokens ?? 0,
                completion_tokens: chunk.usage.outputTokens ?? 0,
              }
            }
          }

          const finalChunk = serializeOpenAIStreamChunk(createOpenAIStreamChunk({
            id: completionId,
            createdAt,
            requestedModel: request.model,
            delta: '',
            finishReason: 'stop',
            isFirst: false,
            usage: lastUsage,
          }))
          controller.enqueue(encoder.encode(finalChunk))
          controller.enqueue(encoder.encode(OPENAI_STREAM_DONE))
          controller.close()

          const actualCost = {
            ...calculateCost(
              modelConfig,
              extractBillingParams(validatedParams),
              lastUsage
                ? { inputTokens: lastUsage.prompt_tokens, outputTokens: lastUsage.completion_tokens }
                : undefined,
            ),
            billable: true,
            source: 'actual' as const,
          }
          const textOutput: OutputResult = { type: 'text' as const, text: fullText }
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
              inputTokens: lastUsage?.prompt_tokens,
              outputTokens: lastUsage?.completion_tokens,
              totalPriceCents: actualCost.totalPriceCents,
              status: 'succeeded',
            },
          })

          // API Key 额度追踪（非阻塞）
          if (apiKeyId && actualCost.totalPriceCents > 0) {
            incrementApiKeySpend(apiKeyId, actualCost.totalPriceCents).catch(() => {})
          }
        }
        catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          try {
            controller.close()
          }
          catch {
            /* controller 已关闭时忽略 */
          }
          await markGenerationFailed(recordId, message)
          recordGenerationStatus('failed')
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
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  }

  return new Elysia({ prefix: '/v1' })
    .use(createRequireAuthPlugin(config))
    .post('/chat/completions', async ({ body, userId, set, authMethod, apiKeyMeta }) => {
      const request = body as OpenAIChatRequest

      // API Key scope 检查
      if (authMethod === 'api_key' && apiKeyMeta) {
        const accessErr = checkApiKeyGatewayAccess(apiKeyMeta)
        if (accessErr) {
          set.status = accessErr.status
          return accessErr.response
        }
        const quotaErr = await checkApiKeyQuota(apiKeyMeta)
        if (quotaErr) {
          set.status = quotaErr.status
          return quotaErr.response
        }
      }

      const normalized = normalizeOpenAIChatRequest(request)
      if (isOpenAIGatewayError(normalized)) {
        set.status = normalized.status
        return normalized.response
      }

      // 模型名解析（别名 → 内部 ID）
      const modelConfig = getModelById(normalized.internalModelId)
      if (!modelConfig) {
        const err = modelNotFoundError(request.model)
        set.status = err.status
        return err.response
      }

      // 仅支持文本模型
      if (modelConfig.category !== 'text') {
        const err = invalidModelError(request.model)
        set.status = err.status
        return err.response
      }

      // 参数校验 + 合并默认值
      const validationResult = validateAndMerge(modelConfig, normalized.parameters)
      if (!validationResult.ok) {
        const err = invalidParametersError(validationResult.errors)
        set.status = err.status
        return err.response
      }
      const validatedParams = validationResult.params

      // stream 分支
      if (normalized.stream) {
        return handleStreamChatCompletions({
          userId,
          modelConfig,
          validatedParams,
          request,
          apiKeyId: apiKeyMeta?.id,
        })
      }

      // 非 stream 分支 — 使用统一编排器
      const result = await handleGatewayChatCompletion({
        userId,
        modelConfig,
        validatedParams,
        request,
        callProvider: async () => {
          const res = await client.chatCompletion(modelConfig.id, validatedParams)
          if (res.type === 'failed' || !res.success) {
            throw new Error(res.error)
          }
          return { text: res.output.text, usage: res.usage }
        },
      })

      if (!result.success) {
        set.status = result.status
        return result.response
      }

      // API Key 额度追踪（非阻塞）
      if (apiKeyMeta && result.usage) {
        const actualCost = calculateCost(modelConfig, extractBillingParams(validatedParams), result.usage)
        incrementApiKeySpend(apiKeyMeta.id, actualCost.totalPriceCents).catch(() => {})
      }

      return createOpenAIChatResponse({
        id: result.recordId,
        createdAt: result.createdAt,
        requestedModel: request.model,
        text: result.text,
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

      return aggregateGatewayUsage(records.map(record => ({
        id: record.id,
        model: record.model,
        status: record.status,
        inputParams: record.inputParams as { requestedModel?: unknown } | null,
        cost: record.cost,
        totalPriceCents: record.totalPriceCents,
        errorMessage: record.errorMessage,
        createdAt: record.createdAt,
      })))
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
