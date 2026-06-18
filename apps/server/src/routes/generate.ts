import type { GenerationCategory, GenerationInputParams, GenerationStatus } from '@excuse/db'
import type { DeleteGenerationRecordResponse, GenerateResponse, GenerationRecordListResponse, GenerationRecordResponse } from '@excuse/shared'
import type { ServerConfig } from '../config'
import type { ServerContext } from '../context'
import { assertCreditLedgerPolicy, getBillingPolicy } from '@excuse/billing'
import {
  deleteGenerationRecord,
  getGenerationRecordById,
  listGenerationRecords,
  resetGenerationToPending,
} from '@excuse/db'
import { getModelById, validateAndMerge } from '@excuse/provider'
import { Elysia, t } from 'elysia'
import { orchestrateGeneration, serializeRecord } from '../modules/generation/orchestration'
import * as svc from '../modules/generation/service'
import { createRequireAuthPlugin } from '../plugins/auth'
import { audit } from '../services/audit'
import { ForbiddenError, NotFoundError, RateLimitError, ValidationError } from '../utils/app-errors'
import { checkCategoryRateLimit } from '../utils/category-rate-limit'
import { createDedupeKey } from '../utils/dedupe-key'
import { assertPromptWithinLimit } from '../utils/prompt-limits'

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
 *   - orchestrateGeneration: POST /generate 与 POST /records/:id/retry 共享编排核心
 *     （预估→预留→provider 执行→视频 task→返回格式化），消除 ~110 行重复
 */
export function createGenerateRoutes(config: ServerConfig, ctx: ServerContext) {
  const billingPolicy = getBillingPolicy('workspace.generate')
  assertCreditLedgerPolicy(billingPolicy, 'workspace.generate')

  const deps: svc.GenerationDependencies = { client: ctx.client, storage: ctx.storage }

  return new Elysia({ prefix: '/api' })
    .use(createRequireAuthPlugin(config))
    // 发起生成 — 前置校验后委托 orchestrateGeneration 执行核心编排
    .post('/generate', async ({ body, userId }) => {
      const { model, parameters, referenceFileIds } = body

      // 1. 模型校验
      const modelConfig = getModelById(model)
      if (!modelConfig) {
        throw new ValidationError(`Unknown model: ${model}`)
      }

      // 2. 类别守卫 — generate 流程仅支持 text/image/video/subtitle
      const category = modelConfig.category
      if (category !== 'text' && category !== 'image' && category !== 'video' && category !== 'subtitle') {
        throw new ValidationError(`模型 ${model} 的类别 "${category}" 不支持通过生成接口调用`)
      }

      // 3. 参数校验 + 合并默认值
      const validationResult = validateAndMerge(modelConfig, parameters)
      if (!validationResult.ok) {
        const detail = validationResult.errors.map(e => `${e.field}: ${e.message}`).join('; ')
        throw new ValidationError(detail)
      }
      const validatedParams = validationResult.params

      // 4. prompt 长度上限
      assertPromptWithinLimit(modelConfig, validatedParams)

      // 5. 视频模型独立限流
      if (category === 'video') {
        const { allowed, retryAfterSec } = checkCategoryRateLimit({
          userId,
          category: 'video',
          maxRequests: 5,
          windowMs: 60 * 1000,
        })
        if (!allowed) {
          throw new RateLimitError(`视频生成请求过于频繁，请 ${retryAfterSec} 秒后再试`, retryAfterSec)
        }
      }

      // 6. 参考文件归属校验
      let referenceUrls: string[] | undefined
      if (referenceFileIds?.length) {
        const refResult = await svc.resolveReferenceUrls(referenceFileIds, userId)
        if (!refResult.ok) {
          throw new ForbiddenError(refResult.error)
        }
        referenceUrls = refResult.urls
      }

      // 7. 去重
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

      // 8. 预估费用 + 创建记录
      const estimatedCost = svc.estimateGenerationCost(modelConfig, validatedParams)
      const taskId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const traceId = crypto.randomUUID()
      const inputParams: GenerationInputParams = { ...validatedParams, referenceFileIds }

      const createResult = await svc.createGenerationRequest({
        accountId: userId,
        taskId,
        traceId,
        model,
        category,
        inputParams,
        estimatedCost,
        dedupeKey,
      })
      if (!createResult.created) {
        const updated = await getGenerationRecordById(createResult.record.id)
        return { success: true, record: serializeRecord(updated ?? createResult.record), duplicated: true } satisfies GenerateResponse
      }

      // 9. 委托编排：预估→预留→执行→视频 task→返回
      const response = await orchestrateGeneration({
        userId,
        recordId: createResult.record.id,
        taskId,
        traceId,
        category,
        modelConfig,
        validatedParams,
        referenceUrls,
        inputParams,
        dedupeKey,
        creditSource: 'generate',
        deps,
      })

      audit('generate', { accountId: userId, targetId: createResult.record.id })
      return response
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
    .get('/records/:id', async ({ params, userId }) => {
      const record = await getGenerationRecordById(params.id)

      if (!record) {
        throw new NotFoundError('记录不存在')
      }

      if (record.accountId !== userId) {
        throw new ForbiddenError('无权查看该记录')
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
    .delete('/records/:id', async ({ params, userId }) => {
      const record = await getGenerationRecordById(params.id)
      if (!record) {
        throw new NotFoundError('记录不存在')
      }
      if (record.accountId !== userId) {
        throw new ForbiddenError('无权删除该记录')
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

    // 重试失败任务 — 前置校验后委托 orchestrateGeneration 执行核心编排
    .post('/records/:id/retry', async ({ params, userId }) => {
      const record = await getGenerationRecordById(params.id)
      if (!record)
        throw new NotFoundError('记录不存在')
      if (record.accountId !== userId)
        throw new ForbiddenError('无权操作该记录')
      if (record.status !== 'failed' && record.status !== 'cancelled')
        throw new ValidationError('只能重试失败或已取消的任务')

      // 1. 模型校验
      const modelConfig = getModelById(record.model)
      if (!modelConfig)
        throw new ValidationError(`Unknown model: ${record.model}`)

      // 2. 视频模型独立限流
      if (modelConfig.category === 'video') {
        const { allowed, retryAfterSec } = checkCategoryRateLimit({
          userId,
          category: 'video',
          maxRequests: 5,
          windowMs: 60 * 1000,
        })
        if (!allowed) {
          throw new RateLimitError(`视频生成请求过于频繁，请 ${retryAfterSec} 秒后再试`, retryAfterSec)
        }
      }

      // 3. 参考文件归属校验
      const inputParams: GenerationInputParams = record.inputParams
      const referenceFileIds = Array.isArray(inputParams.referenceFileIds)
        ? inputParams.referenceFileIds as string[]
        : undefined

      let referenceUrls: string[] | undefined
      if (referenceFileIds?.length) {
        const refResult = await svc.resolveReferenceUrls(referenceFileIds, userId)
        if (!refResult.ok) {
          throw new ForbiddenError(refResult.error)
        }
        referenceUrls = refResult.urls
      }

      // 4. 从 inputParams 信封中提取纯模型参数
      const rawParameters: Record<string, unknown> = { ...inputParams }
      delete rawParameters.source
      delete rawParameters.projectId
      delete rawParameters.shotId
      delete rawParameters.referenceFileIds
      delete rawParameters.requestedModel

      // 5. 参数校验 + 合并默认值
      const validationResult = validateAndMerge(modelConfig, rawParameters)
      if (!validationResult.ok) {
        const detail = validationResult.errors.map(e => `${e.field}: ${e.message}`).join('; ')
        throw new ValidationError(detail)
      }
      const validatedParams = validationResult.params

      // 6. prompt 长度上限
      assertPromptWithinLimit(modelConfig, validatedParams)

      // 7. 重置记录状态 (failed/cancelled → pending)，并发门闩
      const resetRecord = await resetGenerationToPending(record.id)
      if (!resetRecord) {
        const latest = await getGenerationRecordById(record.id)
        if (!latest)
          throw new NotFoundError('记录不存在')
        return { success: true, record: serializeRecord(latest), duplicated: true } satisfies GenerateResponse
      }
      audit('generation_retry', {
        accountId: userId,
        targetId: record.id,
        detail: { recordId: record.id, model: record.model, previousStatus: record.status },
      })

      // 8. 委托编排：预估→预留→执行→视频 task→返回
      const newTaskId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      return orchestrateGeneration({
        userId,
        recordId: record.id,
        taskId: newTaskId,
        traceId: record.traceId ?? undefined,
        category: record.category,
        modelConfig,
        validatedParams,
        referenceUrls,
        inputParams,
        creditSource: 'retry',
        deps,
      })
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
    .post('/records/:id/cancel', async ({ params, userId }) => {
      const record = await getGenerationRecordById(params.id)
      if (!record)
        throw new NotFoundError('记录不存在')
      if (record.accountId !== userId)
        throw new ForbiddenError('无权操作该记录')
      // 可取消的状态：pending、submitting、processing、saving_output
      const CANCELLABLE_STATUSES = ['pending', 'submitting', 'processing', 'saving_output'] as const
      if (!CANCELLABLE_STATUSES.includes(record.status as typeof CANCELLABLE_STATUSES[number])) {
        throw new ValidationError(`只能取消进行中的任务（当前状态: ${record.status}）`)
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
