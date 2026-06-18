/**
 * 生成任务核心业务服务
 *
 * 从 generate route 提取的纯业务逻辑，不涉及 HTTP 语义。
 *
 * 职责：
 *   1. 去重检查（checkDedupe）— 防止重复提交
 *   2. 参考文件归属校验（resolveReferenceUrls）— 安全边界
 *   3. 执行生成（executeGeneration）— provider 调用 + 三分支处理
 *      - 分支 1: provider 失败 → 标记失败 + SSE
 *      - 分支 2: 异步任务(视频) → 保存 provider taskId + SSE
 *      - 分支 3: 同步完成(文本/图片) → 下载保存 + 计费 + SSE
 *   4. 取消任务（cancelGeneration）— best-effort provider 取消 + DB 取消
 */
import type { GenerationCategory, GenerationInputParams, GenerationRecordRow, OutputResult } from '@excuse/db'
import type { DashScopeClient, ValidatedModelParameters } from '@excuse/provider'
import type { CostDetail, ModelConfig } from '@excuse/shared'
import type { AssetStorage } from '@excuse/storage'
import { calculateCost } from '@excuse/billing'
import {
  cancelGenerationRecord,
  createGenerationRecord,
  findGenerationByDedupeKeyForAccount,
  getGenerationRecordById,
  getUploadedFilesByIdsForAccount,
  markGenerationFailed,
  markGenerationProcessing,
  markGenerationSucceeded,
  notifyGenerationStatus,
} from '@excuse/db'
import { extractBillingParams, getPgErrorCode, logger } from '@excuse/shared'
import { debitReservedAndTrack, refundReservedAndTrack, reserveAndTrack } from '../../services/billing-ledger'
import { recordGenerationStatus } from '../../services/metrics'
import { notifySyncTaskCompleted, notifySyncTaskFailed } from '../../services/notifications'
import { BadRequestError } from '../../utils/app-errors'
import { extractImageUrls, parseProviderOutput } from './output-parser'

// ===== 接口定义 =====

/** 生成任务依赖的外部服务（由 route 注入） */
export interface GenerationDependencies {
  client: DashScopeClient
  storage: AssetStorage
}

/** executeGeneration 的业务上下文 — route 在完成校验和 DB 创建/重置后构造 */
export interface GenerationContext {
  recordId: string
  accountId: string
  taskId: string
  traceId?: string
  modelConfig: ModelConfig
  category: GenerationCategory
  /** 经 validateAndMerge 校验+合并的模型参数（branded type，只允许通过 validateAndMerge 构造） */
  parameters: ValidatedModelParameters
  referenceUrls?: string[]
  /** 存入 DB inputParams 的完整参数（包含 referenceFileIds 等信封字段） */
  inputParams: GenerationInputParams
  dedupeKey?: string
  estimatedCost: CostDetail
  creditSource: 'generate' | 'retry'
}

/** 去重检查结果 */
export type DedupeResult
  = | { duplicated: true, record: GenerationRecordRow }
    | { duplicated: false }

export type CreateGenerationRequestResult
  = | { created: true, record: GenerationRecordRow }
    | { created: false, record: GenerationRecordRow }

/** 参考文件归属校验结果 */
export type ReferenceResult
  = | { ok: true, urls: string[] }
    | { ok: false, error: string }

/** executeGeneration 返回 — route 映射为 HTTP 响应 */
export type GenerationResult
  = | { success: true, record: GenerationRecordRow }
    | { success: false, record: GenerationRecordRow }

// ===== 业务函数 =====

/**
 * 去重检查 — 同一用户 + 同一 model + 相同参数，且任务仍在进行中时不重复提交
 *
 * "进行中"包括：pending、submitting、processing、saving_output
 * 已 succeeded/failed/cancelled 的记录不触发去重拦截
 */
export async function checkDedupe(dedupeKey: string, accountId: string): Promise<DedupeResult> {
  const IN_PROGRESS_STATUSES = ['pending', 'submitting', 'processing', 'saving_output'] as const
  const existing = await findGenerationByDedupeKeyForAccount(dedupeKey, accountId)

  if (existing && IN_PROGRESS_STATUSES.includes(existing.status as typeof IN_PROGRESS_STATUSES[number])) {
    return { duplicated: true, record: existing }
  }

  return { duplicated: false }
}

/**
 * 参考文件归属校验 — 只允许当前用户的文件作为 reference
 *
 * 校验在创建/重置 DB 记录之前（P1.9 约束）：
 *   校验失败不应留下脏记录/脏状态
 */
export async function resolveReferenceUrls(referenceFileIds: string[], accountId: string): Promise<ReferenceResult> {
  const files = await getUploadedFilesByIdsForAccount(referenceFileIds, accountId)

  if (files.length !== referenceFileIds.length) {
    return { ok: false, error: '部分参考文件不存在或不属于当前用户' }
  }

  return { ok: true, urls: files.map(f => f.publicUrl) }
}

/**
 * 核心生成执行 — provider 调用 + 三分支处理 + DB 状态变更 + SSE + 图片下载 + 计费
 *
 * 三个分支：
 *   1. provider 失败 → markGenerationFailed + SSE → 返回 { success: false }
 *   2. provider 返回 video_task variant（异步视频）→ markGenerationProcessing + SSE → 返回 { success: true }
 *   3. 同步完成（文本/图片）→ 图片下载 + 计算实际费用 + markGenerationSucceeded + SSE → 返回 { success: true }
 *
 * 此函数不处理 HTTP 逻辑（认证、权限、4xx），只处理业务流程。
 * 调用方（route）负责所有校验并传入 GenerationContext。
 */
export async function executeGeneration(
  ctx: GenerationContext,
  deps: GenerationDependencies,
): Promise<GenerationResult> {
  const { recordId, accountId, taskId, traceId, modelConfig, category, parameters, referenceUrls } = ctx
  const { client, storage } = deps
  const model = modelConfig.id

  const result = await client.generate(model, parameters, referenceUrls)

  // === 分支 1: provider 调用失败 ===
  if (result.type === 'failed' || !result.success) {
    await markGenerationFailed(recordId, result.error)
    recordGenerationStatus('failed')
    await refundReservedCredit({
      accountId,
      recordId,
      estimatedCost: ctx.estimatedCost,
      description: `生成失败退款：${model}`,
      source: ctx.creditSource,
    })
    await notifyGenerationStatus({
      accountId,
      recordId,
      status: 'failed',
      category,
      model,
      taskId,
      traceId,
      errorMessage: result.error,
    })
    // 同步任务（文本/图片）provider 失败时推送通知（视频异步失败由 Worker 处理）
    if (category === 'text' || category === 'image') {
      await notifySyncTaskFailed(accountId, recordId, category, model, result.error).catch(err => logger.warn({ err, accountId, recordId }, 'notifySyncTaskFailed failed'))
    }
    const updated = await getGenerationRecordById(recordId)
    return { success: false, record: updated! }
  }

  // === 分支 2: 异步任务（视频生成）— 保存 provider taskId，Worker 会轮询 ===
  if (result.type === 'video_task') {
    await markGenerationProcessing(recordId, {
      taskId: result.taskId,
      outputResult: parseProviderOutput(result.output),
    })
    recordGenerationStatus('processing')
    await notifyGenerationStatus({
      accountId,
      recordId,
      status: 'processing',
      category,
      model,
      taskId: result.taskId,
      traceId,
    })
    const updated = await getGenerationRecordById(recordId)
    return { success: true, record: updated! }
  }

  // === 分支 3: 同步任务完成（文本/图片）— 下载并保存结果 ===
  // generate 流程不支持 audio（fun-music-v1 为 Canvas BGM 内部模型，由 canvas.bgm 阶段驱动）；
  // 路由层已按 category 拦截，此处为类型收窄兜底，避免 audio 结果流入通用生成保存逻辑。
  if (result.type === 'audio') {
    throw new BadRequestError('生成接口不支持音频类模型（fun-music-v1 仅限 Canvas BGM 流水线使用）')
  }
  let outputResult: OutputResult = parseProviderOutput(result.output)
  // extractImageUrls 只在 ImageProviderOutput 上有有效值 — 按 result.type 精确 narrow
  const imageUrls = result.type === 'image' ? extractImageUrls(result.output) : []
  if (category === 'image' && imageUrls.length > 0) {
    const savedUrls = await storage.downloadAndMap(imageUrls, taskId, 'img')
    outputResult = { type: 'image', savedUrls, urls: imageUrls }
  }

  // 计算实际费用（基于 provider 返回的 usage）— 标记为 billable
  const actualCost = { ...calculateCost(modelConfig, extractBillingParams(parameters), result.usage), billable: true, source: 'actual' as const }

  // 超额保护：实际费用超过预估 1.5 倍时拒绝扣款并退款（防穿负，TODO §1.2）
  const exceededThreshold = ctx.estimatedCost.totalPriceCents > 0
    && actualCost.totalPriceCents > ctx.estimatedCost.totalPriceCents * 1.5
  if (exceededThreshold) {
    await markGenerationFailed(recordId, `实际费用 ${actualCost.totalPriceCents} 分超过预估 ${ctx.estimatedCost.totalPriceCents} 分的 1.5 倍，已自动取消`)
    recordGenerationStatus('failed')
    await refundReservedCredit({
      accountId,
      recordId,
      estimatedCost: ctx.estimatedCost,
      description: `生成费用超阈值退款：${model}`,
      source: ctx.creditSource,
    })
    await notifyGenerationStatus({
      accountId,
      recordId,
      status: 'failed',
      category,
      model,
      taskId,
      traceId,
      errorMessage: `实际费用超过预估 1.5 倍（${actualCost.totalPriceCents} > ${ctx.estimatedCost.totalPriceCents * 1.5}），已取消`,
    })
    const errUpdated = await getGenerationRecordById(recordId)
    return { success: false, record: errUpdated! }
  }

  await markGenerationSucceeded(recordId, outputResult, actualCost)
  recordGenerationStatus('succeeded')
  await debitReservedCredit({
    accountId,
    recordId,
    actualCost,
    description: `生成成功扣款：${model}`,
    source: ctx.creditSource,
  })
  await notifyGenerationStatus({
    accountId,
    recordId,
    status: 'succeeded',
    category,
    model,
    taskId,
    traceId,
    outputResult,
    cost: actualCost,
  })

  const updated = await getGenerationRecordById(recordId)

  // 同步任务（文本/图片）成功时推送通知
  if (category === 'text' || category === 'image') {
    await notifySyncTaskCompleted(accountId, recordId, category, model).catch(err => logger.warn({ err, accountId, recordId }, 'notifySyncTaskCompleted failed'))
  }

  return { success: true, record: updated! }
}

/**
 * 取消进行中的生成任务 — provider 取消(best-effort) + DB 取消 + SSE 通知
 *
 * provider 取消是 best-effort：即使 provider 侧取消失败，DB 和 SSE 仍标记为已取消。
 * 可取消状态：pending、submitting、processing、saving_output
 */
export async function cancelGeneration(
  recordId: string,
  accountId: string,
  record: GenerationRecordRow,
  deps: GenerationDependencies,
): Promise<GenerationRecordRow> {
  const { client } = deps

  // 尝试在 provider 侧取消（best-effort）
  let providerCancelStatus: 'no_task' | 'succeeded' | 'failed' = 'no_task'
  if (record.taskId) {
    try {
      providerCancelStatus = await client.cancelTask(record.taskId) ? 'succeeded' : 'failed'
    }
    catch (err) {
      providerCancelStatus = 'failed'
      logger.warn({ err, taskId: record.taskId }, 'provider 侧取消任务失败')
    }
  }

  await cancelGenerationRecord(recordId, providerCancelStatus)
  recordGenerationStatus('cancelled')
  await refundReservedCredit({
    accountId,
    recordId,
    estimatedCost: record.cost,
    description: `生成取消退款：${record.model}`,
    source: 'generate',
  })
  await notifyGenerationStatus({
    accountId,
    recordId,
    status: 'cancelled',
    category: record.category,
    model: record.model,
    taskId: record.taskId,
    traceId: record.traceId,
    errorMessage: '用户取消',
  })

  const updated = await getGenerationRecordById(recordId)
  return updated!
}

/** reserveGenerationCredit 的失败原因 — route 映射为对应 HTTP 错误（402 余额不足）。 */
export type CreditReservationResult
  = | { ok: true }
    | { ok: false, reason: 'insufficient_balance', message: string }

/**
 * 预留生成额度 — reserve 成功写 credit_transactions + audit。
 *
 * 失败路径（INSUFFICIENT_BALANCE）原子地收尾：notifyInsufficientBalance + markGenerationFailed，
 * 返回 `{ ok: false, reason: 'insufficient_balance', message }`，由 route 抛 PaymentRequiredError(402)。
 * 其余预留失败同样 markGenerationFailed 后返回失败结果。
 *
 * result-style（不抛 AppError）以保持本 service「不涉及 HTTP 语义」的既有契约（对齐
 * executeGeneration 返回 GenerationResult 的风格）——HTTP 错误码的映射是 route 的职责。
 *
 * 与 executeGeneration / cancelGeneration 内部的 refundReservedCredit / debitReservedCredit
 * 构成 reserve → debit/refund 的完整 credit ledger 闭环。
 */
export async function reserveGenerationCredit(opts: {
  accountId: string
  recordId: string
  estimatedCost: CostDetail
  /** 审计 detail.source 标识来源（'generate' / 'retry'） */
  source: string
  /** 审计 detail.description 的人类可读描述（含模型 id） */
  description: string
}): Promise<CreditReservationResult> {
  if (opts.estimatedCost.totalPriceCents <= 0)
    return { ok: true }

  const reservation = await reserveAndTrack({
    accountId: opts.accountId,
    recordId: opts.recordId,
    amountCents: opts.estimatedCost.totalPriceCents,
    description: opts.description,
    source: opts.source as 'generate' | 'retry',
  })
  if (!reservation.ok) {
    await markGenerationFailed(opts.recordId, reservation.message)
    return reservation
  }
  return { ok: true }
}

/**
 * 预估生成费用 — submit/retry 共享（封装 calculateCost + extractBillingParams，移出 route 层）。
 *
 * 此前 POST /generate 与 POST /records/:id/retry 各自手写 `calculateCost(modelConfig, extractBillingParams(params))`，
 * 下沉后 route 不再直接接触计费原语。
 */
export function estimateGenerationCost(modelConfig: ModelConfig, parameters: ValidatedModelParameters): CostDetail {
  return calculateCost(modelConfig, extractBillingParams(parameters))
}

/**
 * 创建生成记录（pending）— 封装 createGenerationRecord + 标准 estimated cost 信封。
 *
 * 仅 submit 调用（retry 复用既有记录，走 resetGenerationToPending）。
 * `category` 由 route 经 audio 守卫收窄后传入（GenerationCategory 不含 audio）。
 */
export async function createGenerationRequest(input: {
  accountId: string
  taskId: string
  traceId: string
  model: string
  category: GenerationCategory
  inputParams: GenerationInputParams
  estimatedCost: CostDetail
  dedupeKey?: string
}): Promise<CreateGenerationRequestResult> {
  try {
    const record = await createGenerationRecord({
      accountId: input.accountId,
      taskId: input.taskId,
      traceId: input.traceId,
      model: input.model,
      category: input.category,
      status: 'pending',
      inputParams: input.inputParams,
      cost: { ...input.estimatedCost, estimated: true, billable: false, source: 'estimated' },
      dedupeKey: input.dedupeKey,
    })
    return { created: true, record }
  }
  catch (err) {
    if (input.dedupeKey && getPgErrorCode(err) === '23505') {
      const existing = await findGenerationByDedupeKeyForAccount(input.dedupeKey, input.accountId)
      if (existing)
        return { created: false, record: existing }
    }
    throw err
  }
}

/** prepareGeneration 的结果 — 成功返回执行上下文，余额不足返回 message（route 映射 402）。 */
export type GenerationPreparation
  = | { ok: true, context: GenerationContext }
    | { ok: false, reason: 'insufficient_balance', message: string }

/**
 * 预留 credit + 构造执行上下文 — submit/retry 共享的核心编排。
 *
 * record 需已就位（submit 经 createGenerationRequest 创建，retry 经 resetGenerationToPending 重置）。
 * 消除此前两处 route handler 重复的 cost+reserve 块。result-style（不抛 AppError）保持 service
 * 无 HTTP 语义契约：余额不足由 route 抛 PaymentRequiredError(402)。
 */
export async function prepareGeneration(input: {
  recordId: string
  accountId: string
  taskId: string
  traceId?: string
  modelConfig: ModelConfig
  category: GenerationCategory
  parameters: ValidatedModelParameters
  referenceUrls?: string[]
  inputParams: GenerationInputParams
  dedupeKey?: string
  estimatedCost: CostDetail
  creditSource: 'generate' | 'retry'
}): Promise<GenerationPreparation> {
  const reservation = await reserveGenerationCredit({
    accountId: input.accountId,
    recordId: input.recordId,
    estimatedCost: input.estimatedCost,
    source: input.creditSource,
    description: `${input.creditSource === 'retry' ? '重试' : ''}生成任务预留：${input.modelConfig.id}`,
  })
  if (!reservation.ok) {
    return { ok: false, reason: 'insufficient_balance', message: reservation.message }
  }
  return {
    ok: true,
    context: {
      recordId: input.recordId,
      accountId: input.accountId,
      taskId: input.taskId,
      traceId: input.traceId,
      modelConfig: input.modelConfig,
      category: input.category,
      parameters: input.parameters,
      referenceUrls: input.referenceUrls,
      inputParams: input.inputParams,
      dedupeKey: input.dedupeKey,
      estimatedCost: input.estimatedCost,
      creditSource: input.creditSource,
    },
  }
}

async function debitReservedCredit(opts: {
  accountId: string
  recordId: string
  actualCost: CostDetail
  description: string
  source: 'generate' | 'retry'
}) {
  await debitReservedAndTrack({
    accountId: opts.accountId,
    recordId: opts.recordId,
    amountCents: opts.actualCost.totalPriceCents,
    description: opts.description,
    source: opts.source,
  })
}

async function refundReservedCredit(opts: {
  accountId: string
  recordId: string
  estimatedCost: CostDetail | null
  description: string
  source: 'generate' | 'retry'
}) {
  if (!opts.estimatedCost)
    return
  await refundReservedAndTrack({
    accountId: opts.accountId,
    recordId: opts.recordId,
    amountCents: opts.estimatedCost.totalPriceCents,
    description: opts.description,
    source: opts.source,
  })
}
