import type { OpenAIGatewayError } from '@excuse/gateway'
import type { ValidatedModelParameters } from '@excuse/provider'
import type { ModelConfig, OpenAIChatRequest } from '@excuse/shared'
import type { ServerConfig } from '../config'
import type { ServerContext } from '../context'
import type { ApiKeyMeta } from '../plugins/auth'
import { assertCreditLedgerPolicy, getBillingPolicy } from '@excuse/billing'
import {
  checkAndResetApiKeyQuota,
  isApiKeyQuotaExceeded,
  listGatewayUsageRecords,
} from '@excuse/db'
import {
  aggregateGatewayUsage,
  apiKeyQuotaExceededError,
  apiKeyScopeNotAllowedError,
  createOpenAIChatResponse,
  createOpenAIModelsResponse,
  createOpenAIStreamChunk,
  invalidModelError,
  invalidParametersError,
  isOpenAIGatewayError,
  modelNotFoundError,
  normalizeOpenAIChatRequest,
  OPENAI_STREAM_DONE,
  serializeOpenAIStreamChunk,
} from '@excuse/gateway'
import { getModelById, getModelsByCategory, validateAndMerge } from '@excuse/provider'
import { Elysia, t } from 'elysia'
import { createRequireAuthPlugin } from '../plugins/auth'
import {
  handleGatewayChatCompletion,
  handleGatewayStreamChatCompletion,
} from '../services/gateway-service'
import { notifyApiKeyQuota } from '../services/notifications'
import { throwOpenAIGatewayError } from '../utils/openai-gateway-error'
import { assertGatewayMessagesWithinLimit } from '../utils/prompt-limits'

const ALLOWED_API_KEY_SCOPES = ['all', 'gateway']

/**
 * 检查 API Key 是否有权限访问 Gateway。
 * 返回错误响应对象（含 status + response）或 null（允许通过）。
 */
function checkApiKeyGatewayAccess(apiKeyMeta: ApiKeyMeta): OpenAIGatewayError | null {
  if (!ALLOWED_API_KEY_SCOPES.includes(apiKeyMeta.scope)) {
    return apiKeyScopeNotAllowedError()
  }
  return null
}

/**
 * 检查 API Key 是否超出额度。
 * 返回错误响应对象或 null（允许通过）。
 */
async function checkApiKeyQuota(apiKeyMeta: ApiKeyMeta): Promise<OpenAIGatewayError | null> {
  if (apiKeyMeta.quotaMaxCents === null)
    return null
  // 先尝试重置到期额度
  await checkAndResetApiKeyQuota(apiKeyMeta.id)
  const exceeded = await isApiKeyQuotaExceeded(apiKeyMeta.id)
  if (exceeded) {
    return apiKeyQuotaExceededError()
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
 * 计费：同一套 GenerationRecord + calculateCost（编排逻辑在 services/gateway-service.ts）
 *
 * 本文件只做 HTTP 层：参数解析 / API Key scope+quota 访问控制 / stream 分支 / 响应塑形。
 * stream 与非 stream 的业务编排（记录创建、额度预留/结算、审计、provider 调用）均下沉
 * `services/gateway-service.ts`（handleGatewayChatCompletion / handleGatewayStreamChatCompletion）。
 */

export function createOpenAIGatewayRoutes(config: ServerConfig, ctx: ServerContext) {
  const billingPolicy = getBillingPolicy('openai.gateway.chat')
  assertCreditLedgerPolicy(billingPolicy, 'openai.gateway.chat')

  const client = ctx.client

  /**
   * 流式 chat completions 处理器（HTTP 层）
   *
   * 构造 ReadableStream，把 service 产出的每个 GatewayStreamChunk 编码为 OpenAI SSE 事件写入控制器；
   * 业务编排（记录创建 / 额度预留 / 成功失败结算 / provider 逐批拉取）下沉
   * `handleGatewayStreamChatCompletion`，与 `handleGatewayChatCompletion` 共用同一套原语。
   */
  async function handleStreamChatCompletions(opts: {
    userId: string
    modelConfig: ModelConfig
    validatedParams: ValidatedModelParameters
    request: OpenAIChatRequest
    apiKeyMeta?: ApiKeyMeta
  }): Promise<Response> {
    const { userId, modelConfig, validatedParams, request, apiKeyMeta } = opts

    const completionId = `chatcmpl-${crypto.randomUUID()}`
    const createdAt = new Date()
    const encoder = new TextEncoder()

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const result = await handleGatewayStreamChatCompletion(
          {
            userId,
            modelConfig,
            validatedParams,
            request,
            apiKeyMeta,
            callProvider: () => client.chatCompletionStream(modelConfig.id, validatedParams),
          },
          // onChunk：把 service 的领域 chunk 编码为 OpenAI SSE 事件并写入流
          (chunk) => {
            const event = serializeOpenAIStreamChunk(createOpenAIStreamChunk({
              id: completionId,
              createdAt,
              requestedModel: request.model,
              delta: chunk.delta,
              finishReason: chunk.finishReason,
              isFirst: chunk.isFirst,
              usage: chunk.usage
                ? { prompt_tokens: chunk.usage.inputTokens ?? 0, completion_tokens: chunk.usage.outputTokens ?? 0 }
                : undefined,
            }))
            controller.enqueue(encoder.encode(event))
          },
        )

        // setup 失败（余额不足）：service 未产出任何 chunk，直接发一个非 SSE JSON 错误。
        if (!result.ok) {
          // 流尚未写入业务 chunk，用 error 事件回传结构化错误后结束。
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: result.response })}\n\n`))
        }
        controller.enqueue(encoder.encode(OPENAI_STREAM_DONE))
        controller.close()
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
    .post('/chat/completions', async ({ body, userId, authMethod, apiKeyMeta }) => {
      const request = body as OpenAIChatRequest

      // API Key scope 检查
      if (authMethod === 'api_key' && apiKeyMeta) {
        const accessErr = checkApiKeyGatewayAccess(apiKeyMeta)
        if (accessErr) {
          throwOpenAIGatewayError(accessErr)
        }
        const quotaErr = await checkApiKeyQuota(apiKeyMeta)
        if (quotaErr) {
          // 额度已用尽通知（非阻塞）
          notifyApiKeyQuota(userId, {
            keyId: apiKeyMeta.id,
            totalSpendCents: apiKeyMeta.totalSpendCents,
            quotaMaxCents: apiKeyMeta.quotaMaxCents,
          }).catch(() => {})
          throwOpenAIGatewayError(quotaErr)
        }
      }

      // messages 长度上限（防超长 prompt 爆量计费 / API Key 滥用，TODO §1.2）
      assertGatewayMessagesWithinLimit(body.messages.map(m => ({ content: m.content })))

      const normalized = normalizeOpenAIChatRequest(request)
      if (isOpenAIGatewayError(normalized)) {
        throwOpenAIGatewayError(normalized)
      }

      // 模型名解析（别名 → 内部 ID）
      const modelConfig = getModelById(normalized.internalModelId)
      if (!modelConfig) {
        throwOpenAIGatewayError(modelNotFoundError(request.model))
      }

      // 仅支持文本模型
      if (modelConfig.category !== 'text') {
        throwOpenAIGatewayError(invalidModelError(request.model))
      }

      // 参数校验 + 合并默认值
      const validationResult = validateAndMerge(modelConfig, normalized.parameters)
      if (!validationResult.ok) {
        throwOpenAIGatewayError(invalidParametersError(validationResult.errors))
      }
      const validatedParams = validationResult.params

      // stream 分支
      if (normalized.stream) {
        return handleStreamChatCompletions({
          userId,
          modelConfig,
          validatedParams,
          request,
          apiKeyMeta: apiKeyMeta ?? undefined,
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
        apiKeyMeta: apiKeyMeta ?? undefined,
      })

      if (!result.success) {
        throwOpenAIGatewayError({
          status: result.status,
          response: result.response as unknown as OpenAIGatewayError['response'],
        })
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
