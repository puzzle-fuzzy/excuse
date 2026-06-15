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
import type { AssetStorage, DashScopeClient, ValidatedModelParameters } from '@excuse/provider'
import type { CostDetail, ModelConfig } from '@excuse/shared'
import { calculateCost } from '@excuse/billing'
import {
  cancelGenerationRecord,
  debitCredit,
  findGenerationByDedupeKeyForAccount,
  getGenerationRecordById,
  getUploadedFilesByIdsForAccount,
  markGenerationFailed,
  markGenerationProcessing,
  markGenerationSucceeded,
  notifyGenerationStatus,
  refundCredit,
} from '@excuse/db'
import { extractBillingParams } from '@excuse/shared'
import { notifySyncTaskCompleted, notifySyncTaskFailed } from '../../routes/notifications'
import { recordGenerationStatus } from '../../services/metrics'
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
}

/** 去重检查结果 */
export type DedupeResult
  = | { duplicated: true, record: GenerationRecordRow }
    | { duplicated: false }

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
      await notifySyncTaskFailed(accountId, recordId, category, model, result.error).catch(() => {})
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
  let outputResult: OutputResult = parseProviderOutput(result.output)
  // extractImageUrls 只在 ImageProviderOutput 上有有效值 — 按 result.type 精确 narrow
  const imageUrls = result.type === 'image' ? extractImageUrls(result.output) : []
  if (category === 'image' && imageUrls.length > 0) {
    const savedUrls = await storage.downloadAndMap(imageUrls, taskId, 'img')
    outputResult = { type: 'image', savedUrls, urls: imageUrls }
  }

  // 计算实际费用（基于 provider 返回的 usage）— 标记为 billable
  const actualCost = { ...calculateCost(modelConfig, extractBillingParams(parameters), result.usage), billable: true, source: 'actual' as const }

  await markGenerationSucceeded(recordId, outputResult, actualCost)
  recordGenerationStatus('succeeded')
  await debitReservedCredit({
    accountId,
    recordId,
    actualCost,
    description: `生成成功扣款：${model}`,
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
    await notifySyncTaskCompleted(accountId, recordId, category, model).catch(() => {})
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
    catch {
      providerCancelStatus = 'failed'
    }
  }

  await cancelGenerationRecord(recordId, providerCancelStatus)
  recordGenerationStatus('cancelled')
  await refundReservedCredit({
    accountId,
    recordId,
    estimatedCost: record.cost,
    description: `生成取消退款：${record.model}`,
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

async function debitReservedCredit(opts: {
  accountId: string
  recordId: string
  actualCost: CostDetail
  description: string
}) {
  if (opts.actualCost.totalPriceCents <= 0)
    return
  await debitCredit({
    accountId: opts.accountId,
    generationRecordId: opts.recordId,
    actualCents: opts.actualCost.totalPriceCents,
    description: opts.description,
  })
}

async function refundReservedCredit(opts: {
  accountId: string
  recordId: string
  estimatedCost: CostDetail | null
  description: string
}) {
  if (!opts.estimatedCost || opts.estimatedCost.totalPriceCents <= 0)
    return
  await refundCredit({
    accountId: opts.accountId,
    generationRecordId: opts.recordId,
    description: opts.description,
  })
}
