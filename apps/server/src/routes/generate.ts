import type { GenerationCategory, GenerationInputParams, GenerationRecordRow, GenerationStatus } from '@excuse/db'
import type { DeleteGenerationRecordResponse, GenerateResponse, GenerationRecord, GenerationRecordListResponse, GenerationRecordResponse } from '@excuse/shared'
import type { ServerConfig } from '../config'
import { assertCreditLedgerPolicy, calculateCost, getBillingPolicy } from '@excuse/billing'
import {
  createGenerationRecord,
  CreditError,
  deleteGenerationRecord,
  getGenerationRecordById,
  listGenerationRecords,
  markGenerationFailed,
  reserveCredit,
  resetGenerationToPending,
} from '@excuse/db'
import { AssetStorage, DashScopeClient, getModelById, validateAndMerge } from '@excuse/provider'
import { extractBillingParams } from '@excuse/shared'
import { Elysia, t } from 'elysia'
import * as svc from '../modules/generation/service'
import { createRequireAuthPlugin } from '../plugins/auth'
import { audit } from '../services/audit'
import { checkCategoryRateLimit } from '../utils/category-rate-limit'
import { createDedupeKey } from '../utils/dedupe-key'
import { forbidden, notFound, paymentRequired, validationError } from '../utils/errors'
import { notifyInsufficientBalance } from './notifications'

/**
 * 生成任务路由 — CRUD + retry/cancel
 *
 * 任务状态机:
 *   pending → (provider 调用) → processing → succeeded / failed
 *   pending → (用户取消) → cancelled (等同 failed + errorMessage='用户取消')
 *   failed → (retry) → pending → ...
 *
 * 关键约束:
 *   - 校验顺序：认证 → 模型存在 → reference 归属 → dedupe → 创建记录 → provider
 *     所有 DB 写操作必须在所有校验通过之后，防止校验失败留下脏记录/脏状态
 *   - dedupe: 同一用户 + 同模型 + 同参数在 pending/processing 时不重复提交
 *   - referenceFileIds: 必须属于当前用户，校验在创建记录之前（不在之后）
 *   - 异步任务（视频）: provider 返回 video_task，Worker 轮询完成后更新
 *   - 同步任务（文本/图片）: 直接下载并保存输出，一步到位
 */
export function createGenerateRoutes(config: ServerConfig) {
  const billingPolicy = getBillingPolicy('workspace.generate')
  assertCreditLedgerPolicy(billingPolicy, 'workspace.generate')

  const client = new DashScopeClient({
    apiKey: config.dashscopeApiKey,
    baseUrl: config.dashscopeBaseUrl,
  })
  const storage = new AssetStorage({
    storageRoot: config.storageRoot,
    oss: config.oss,
  })
  const deps: svc.GenerationDependencies = { client, storage }

  const PROVIDER_CANCEL_STATUSES = ['not_requested', 'no_task', 'requested', 'succeeded', 'failed'] as const

  function serializeProviderCancelStatus(status: string): GenerationRecord['providerCancelStatus'] {
    return (PROVIDER_CANCEL_STATUSES as readonly string[]).includes(status)
      ? status as GenerationRecord['providerCancelStatus']
      : 'not_requested'
  }

  /** 从 DB 行序列化为前端兼容的 GenerationRecord（Date→string） */
  function serializeRecord(record: GenerationRecordRow): GenerationRecord {
    return {
      ...record,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      hiddenAt: record.hiddenAt?.toISOString() ?? null,
      cancelRequestedAt: record.cancelRequestedAt?.toISOString() ?? null,
      providerCancelStatus: serializeProviderCancelStatus(record.providerCancelStatus),
    }
  }

  return new Elysia({ prefix: '/api' })
    .use(createRequireAuthPlugin(config))
    // 发起生成
    .post('/generate', async ({ body, userId, set }) => {
      const { model, parameters, referenceFileIds } = body

      // 模型校验 — 只允许模型配置中声明过的参数进入 provider
      const modelConfig = getModelById(model)
      if (!modelConfig) {
        return validationError(set, `Unknown model: ${model}`)
      }

      // 参数校验 + 合并默认值 — validateAndMerge 是 ValidatedModelParameters 的唯一构造路径
      const validationResult = validateAndMerge(modelConfig, parameters)
      if (!validationResult.ok) {
        const detail = validationResult.errors.map(e => `${e.field}: ${e.message}`).join('; ')
        return validationError(set, detail)
      }
      const validatedParams = validationResult.params

      const category = modelConfig.category

      // 视频模型独立限流 — 5 次/分钟/用户，防止高成本任务滥用
      if (category === 'video') {
        const { allowed, retryAfterSec } = checkCategoryRateLimit({
          userId,
          category: 'video',
          maxRequests: 5,
          windowMs: 60 * 1000,
        })
        if (!allowed) {
          set.status = 429
          set.headers['Retry-After'] = String(retryAfterSec)
          return { success: false, error: `视频生成请求过于频繁，请 ${retryAfterSec} 秒后再试` }
        }
      }

      // 参考文件归属校验 — 必须在创建 DB 记录之前（P1.9 约束）
      let referenceUrls: string[] | undefined
      if (referenceFileIds?.length) {
        const refResult = await svc.resolveReferenceUrls(referenceFileIds, userId)
        if (!refResult.ok) {
          return forbidden(set, refResult.error)
        }
        referenceUrls = refResult.urls
      }

      // 去重：同一用户 + 同一 model + 相同参数，且任务仍在进行中时不重复提交
      const dedupeKey = await createDedupeKey({
        accountId: userId,
        model,
        parameters: validatedParams,
        referenceFileIds,
      })
      const dedupeResult = await svc.checkDedupe(dedupeKey, userId)
      if (dedupeResult.duplicated) {
        const updated = await getGenerationRecordById(dedupeResult.record.id)
        return { success: true, record: serializeRecord(updated ?? dedupeResult.record), duplicated: true } satisfies GenerateResponse
      }

      // 预估费用 — workspace.generate 明确走 reserve -> debit/refund 的 credit ledger 策略
      const estimatedCost = calculateCost(modelConfig, extractBillingParams(validatedParams))
      const taskId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const traceId = crypto.randomUUID()

      // inputParams 信封 — 模型参数 + referenceFileIds 等元字段
      const inputParams: GenerationInputParams = { ...validatedParams, referenceFileIds }

      // 创建数据库记录 — 此时所有前置校验已完成，不会有脏记录风险
      const record = await createGenerationRecord({
        accountId: userId,
        taskId,
        traceId,
        model,
        category,
        status: 'pending',
        inputParams,
        cost: { ...estimatedCost, estimated: true, billable: false, source: 'estimated' },
        dedupeKey,
      })

      if (estimatedCost.totalPriceCents > 0) {
        try {
          await reserveCredit({
            accountId: userId,
            generationRecordId: record.id,
            amountCents: estimatedCost.totalPriceCents,
            description: `生成任务预留：${modelConfig.id}`,
          })
          audit('credit_reserve', {
            accountId: userId,
            targetId: record.id,
            detail: { accountId: userId, generationRecordId: record.id, amountCents: estimatedCost.totalPriceCents, description: `生成任务预留：${modelConfig.id}`, source: 'generate' },
          })
        }
        catch (error) {
          const message = error instanceof Error ? error.message : '余额不足，无法发起生成'
          if (error instanceof CreditError && error.code === 'INSUFFICIENT_BALANCE') {
            await notifyInsufficientBalance(userId).catch(() => {})
          }
          await markGenerationFailed(record.id, message)
          return paymentRequired(set, message)
        }
      }

      // 调用 service 执行核心业务流程（provider 调用 + 三分枝处理 + DB + SSE）
      const result = await svc.executeGeneration({
        recordId: record.id,
        accountId: userId,
        taskId,
        modelConfig,
        category,
        parameters: validatedParams,
        referenceUrls,
        inputParams,
        dedupeKey,
        estimatedCost,
      }, deps)

      audit('generate', { accountId: userId, targetId: result.record?.id })

      if (result.success) {
        return { success: true, record: serializeRecord(result.record) } satisfies GenerateResponse
      }
      return { success: false, record: serializeRecord(result.record) } satisfies GenerateResponse
    }, {
      body: t.Object({
        model: t.String(),
        parameters: t.Record(t.String(), t.Any()),
        referenceFileIds: t.Optional(t.Array(t.String())),
      }),
      detail: {
        summary: '发起生成任务',
        description: '提交 AI 内容生成任务（文本/图片/视频）。校验流程：认证 → 模型存在 → 参数合法 → reference 归属 → 去重 → 创建记录 → provider 调用。异步任务（视频）返回后由 Worker 轮询完成。',
        tags: ['生成'],
        security: [{ bearerAuth: [] }],
      },
    })

    // 获取生成记录列表
    .get('/records', async ({ query, userId }) => {
      const VALID_CATEGORIES = ['text', 'image', 'video', 'subtitle'] as const
      const VALID_STATUSES = ['pending', 'submitting', 'processing', 'saving_output', 'succeeded', 'failed', 'cancelled'] as const

      const rawCategory = typeof query.category === 'string' ? query.category : undefined
      const rawStatus = typeof query.status === 'string' ? query.status : undefined

      const category = rawCategory && (VALID_CATEGORIES as readonly string[]).includes(rawCategory)
        ? rawCategory as GenerationCategory
        : undefined
      const status = rawStatus && (VALID_STATUSES as readonly string[]).includes(rawStatus)
        ? rawStatus as GenerationStatus
        : undefined
      const limit = query.limit ?? 50
      const offset = query.offset ?? 0

      const rows = await listGenerationRecords({ accountId: userId, category, status, limit, offset })
      const records = rows.map(serializeRecord)

      return { success: true, items: records, total: records.length } satisfies GenerationRecordListResponse
    }, {
      query: t.Object({
        category: t.Optional(t.String()),
        status: t.Optional(t.String()),
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
      }),
      detail: {
        summary: '获取生成记录列表',
        description: '分页查询当前用户的生成记录，支持按 category（text/image/video/subtitle）和 status 过滤',
        tags: ['生成'],
        security: [{ bearerAuth: [] }],
      },
    })

    // 获取单条记录详情
    .get('/records/:id', async ({ params, userId, set }) => {
      const record = await getGenerationRecordById(params.id)

      if (!record) {
        return notFound(set, '记录不存在')
      }

      if (record.accountId !== userId) {
        return forbidden(set, '无权查看该记录')
      }

      return { success: true, record: serializeRecord(record) } satisfies GenerationRecordResponse
    }, {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        summary: '获取单条生成记录',
        description: '根据 ID 查询单条生成记录详情，需为记录所有者',
        tags: ['生成'],
        security: [{ bearerAuth: [] }],
      },
    })

    // 删除单条记录
    .delete('/records/:id', async ({ params, userId, set }) => {
      const record = await getGenerationRecordById(params.id)
      if (!record) {
        return notFound(set, '记录不存在')
      }
      if (record.accountId !== userId) {
        return forbidden(set, '无权删除该记录')
      }

      await deleteGenerationRecord(params.id)
      return { success: true } satisfies DeleteGenerationRecordResponse
    }, {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        summary: '删除生成记录',
        description: '删除指定的生成记录，需为记录所有者',
        tags: ['生成'],
        security: [{ bearerAuth: [] }],
      },
    })

    // 重试失败任务 — 重走完整的 provider 调用流程（参数校验 → 调用 → 结果处理）
    .post('/records/:id/retry', async ({ params, userId, set }) => {
      const record = await getGenerationRecordById(params.id)
      if (!record)
        return notFound(set, '记录不存在')
      if (record.accountId !== userId)
        return forbidden(set, '无权操作该记录')
      // 只能重试 failed 或 cancelled 的任务
      if (record.status !== 'failed' && record.status !== 'cancelled')
        return validationError(set, '只能重试失败或已取消的任务')

      const modelConfig = getModelById(record.model)
      if (!modelConfig)
        return validationError(set, `Unknown model: ${record.model}`)

      // 视频模型独立限流 — 重试同样受限于 5 次/分钟
      if (modelConfig.category === 'video') {
        const { allowed, retryAfterSec } = checkCategoryRateLimit({
          userId,
          category: 'video',
          maxRequests: 5,
          windowMs: 60 * 1000,
        })
        if (!allowed) {
          set.status = 429
          set.headers['Retry-After'] = String(retryAfterSec)
          return { success: false, error: `视频生成请求过于频繁，请 ${retryAfterSec} 秒后再试` }
        }
      }

      // 参考文件归属校验 — 必须在 resetGenerationToPending 之前（P1.9 约束）
      const inputParams: GenerationInputParams = record.inputParams
      const referenceFileIds = Array.isArray(inputParams.referenceFileIds)
        ? inputParams.referenceFileIds as string[]
        : undefined

      let referenceUrls: string[] | undefined
      if (referenceFileIds?.length) {
        const refResult = await svc.resolveReferenceUrls(referenceFileIds, userId)
        if (!refResult.ok) {
          return forbidden(set, refResult.error)
        }
        referenceUrls = refResult.urls
      }

      // 从 inputParams 信封中提取纯模型参数（删除信封字段）
      const rawParameters: Record<string, unknown> = { ...inputParams }
      delete rawParameters.source
      delete rawParameters.projectId
      delete rawParameters.shotId
      delete rawParameters.referenceFileIds

      // 参数校验 + 合并默认值 — validateAndMerge 是 ValidatedModelParameters 的唯一构造路径
      const validationResult = validateAndMerge(modelConfig, rawParameters)
      if (!validationResult.ok) {
        const detail = validationResult.errors.map(e => `${e.field}: ${e.message}`).join('; ')
        return validationError(set, detail)
      }
      const validatedParams = validationResult.params

      const newTaskId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

      // 所有校验通过后才重置状态 — 防止校验失败产生脏状态
      await resetGenerationToPending(record.id)
      audit('generation_retry', {
        accountId: userId,
        targetId: record.id,
        detail: { recordId: record.id, model: record.model, previousStatus: record.status },
      })

      // 预估费用 — 使用 extractBillingParams 从 ValidatedModelParameters 提取计费字段
      const estimatedCost = calculateCost(modelConfig, extractBillingParams(validatedParams))

      if (estimatedCost.totalPriceCents > 0) {
        try {
          await reserveCredit({
            accountId: userId,
            generationRecordId: record.id,
            amountCents: estimatedCost.totalPriceCents,
            description: `重试生成任务预留：${modelConfig.id}`,
          })
          audit('credit_reserve', {
            accountId: userId,
            targetId: record.id,
            detail: { accountId: userId, generationRecordId: record.id, amountCents: estimatedCost.totalPriceCents, description: `重试生成任务预留：${modelConfig.id}`, source: 'retry' },
          })
        }
        catch (error) {
          const message = error instanceof Error ? error.message : '余额不足，无法重试生成'
          if (error instanceof CreditError && error.code === 'INSUFFICIENT_BALANCE') {
            await notifyInsufficientBalance(userId).catch(() => {})
          }
          await markGenerationFailed(record.id, message)
          return paymentRequired(set, message)
        }
      }

      // 调用 service 执行核心业务流程（与 POST /generate 共享同一逻辑）
      const result = await svc.executeGeneration({
        recordId: record.id,
        accountId: userId,
        taskId: newTaskId,
        traceId: record.traceId ?? undefined,
        modelConfig,
        category: modelConfig.category,
        parameters: validatedParams,
        referenceUrls,
        inputParams,
        estimatedCost,
      }, deps)

      if (result.success) {
        return { success: true, record: serializeRecord(result.record) } satisfies GenerateResponse
      }
      return { success: false, record: serializeRecord(result.record) } satisfies GenerateResponse
    }, {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        summary: '重试失败任务',
        description: '重走完整的 provider 调用流程（参数校验 → 调用 → 结果处理）。仅可重试 failed 或 cancelled 状态的记录。',
        tags: ['生成'],
        security: [{ bearerAuth: [] }],
      },
    })

    // 取消进行中的任务 — provider 取消(best-effort) + DB 取消 + SSE 推送
    .post('/records/:id/cancel', async ({ params, userId, set }) => {
      const record = await getGenerationRecordById(params.id)
      if (!record)
        return notFound(set, '记录不存在')
      if (record.accountId !== userId)
        return forbidden(set, '无权操作该记录')
      // 可取消的状态：pending、submitting、processing、saving_output
      const CANCELLABLE_STATUSES = ['pending', 'submitting', 'processing', 'saving_output'] as const
      if (!CANCELLABLE_STATUSES.includes(record.status as typeof CANCELLABLE_STATUSES[number])) {
        return validationError(set, `只能取消进行中的任务（当前状态: ${record.status}）`)
      }

      const updatedRecord = await svc.cancelGeneration(record.id, userId, record, deps)
      audit('generation_cancel', {
        accountId: userId,
        targetId: record.id,
        detail: { recordId: record.id, previousStatus: record.status },
      })
      return { success: true, record: serializeRecord(updatedRecord) } satisfies GenerationRecordResponse
    }, {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        summary: '取消进行中的任务',
        description: '取消 pending/submitting/processing/saving_output 状态的任务。provider 侧取消为 best-effort，DB 和 SSE 始终标记为已取消。',
        tags: ['生成'],
        security: [{ bearerAuth: [] }],
      },
    })
}
