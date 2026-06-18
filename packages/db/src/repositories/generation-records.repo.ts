import type { CostDetail, OutputResult } from '../domain-types'
import type { GenerationRecordInsert, ListGenerationRecordsFilter } from '../types'
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import { getDb } from '../db'
import { generationRecords } from '../schema'

/**
 * 按 taskId 批量查询生成记录（用于 canvas shot 回填）
 */
export async function getGenerationRecordsByTaskIds(taskIds: string[]) {
  if (taskIds.length === 0)
    return []
  return getDb()
    .select()
    .from(generationRecords)
    .where(inArray(generationRecords.taskId, taskIds))
}

/** 创建生成记录 — 调用 provider 前先写入，status 默认 pending */
export async function createGenerationRecord(values: GenerationRecordInsert) {
  const [record] = await getDb().insert(generationRecords).values(values).returning()
  return record!
}

/**
 * 按 ID 查询单条生成记录
 */
export async function getGenerationRecordById(id: string) {
  const [record] = await getDb()
    .select()
    .from(generationRecords)
    .where(eq(generationRecords.id, id))
    .limit(1)
  return record ?? null
}

/**
 * 按 ID + accountId 查询单条生成记录 — 镜头参考资产归属校验用
 *
 * 用于服务端校验镜头参考资产时确认 assetId 属于当前用户。
 * canvas_assets 未命中时回退到 generation_records 查询。
 */
export async function getGenerationRecordByIdForAccount(id: string, accountId: string) {
  const [record] = await getDb()
    .select()
    .from(generationRecords)
    .where(and(eq(generationRecords.id, id), eq(generationRecords.accountId, accountId)))
    .limit(1)
  return record ?? null
}

/**
 * 分页查询生成记录，category/status 过滤推到 SQL 层
 *
 * statuses（多状态）提供时优先于 status（单状态）。
 * projectId 通过 JSONB 提取 input_params->>'projectId' 过滤（Canvas 视频遗留路径）。
 * model/createdFrom/createdTo 为资产中心按模型与时间筛选（v1.1）。
 */
export async function listGenerationRecords(filter: ListGenerationRecordsFilter = {}) {
  const { accountId, category, status, statuses, projectId, model, search, createdFrom, createdTo, excludeHidden, limit = 50, offset = 0 } = filter

  const conditions = []
  if (accountId)
    conditions.push(eq(generationRecords.accountId, accountId))
  if (category)
    conditions.push(eq(generationRecords.category, category))
  // statuses（多状态）优先于 status（单状态）
  if (statuses && statuses.length > 0)
    conditions.push(inArray(generationRecords.status, statuses))
  else if (status)
    conditions.push(eq(generationRecords.status, status))
  if (projectId)
    conditions.push(sql`input_params->>'projectId' = ${projectId}`)
  if (model)
    conditions.push(eq(generationRecords.model, model))
  // 关键词搜索：ilike model / inputParams::text / outputResult::text
  if (search) {
    const pattern = `%${search}%`
    conditions.push(sql`(
      ${generationRecords.model} ILIKE ${pattern}
      OR ${generationRecords.inputParams}::text ILIKE ${pattern}
      OR ${generationRecords.outputResult}::text ILIKE ${pattern}
    )`)
  }
  if (createdFrom)
    conditions.push(gte(generationRecords.createdAt, createdFrom))
  if (createdTo)
    conditions.push(lte(generationRecords.createdAt, createdTo))
  // 资产中心默认排除已隐藏的记录
  if (excludeHidden)
    conditions.push(isNull(generationRecords.hiddenAt))
  // 软删除的记录永不进入资产中心
  conditions.push(isNull(generationRecords.deletedAt))

  return getDb()
    .select()
    .from(generationRecords)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(generationRecords.createdAt))
    .limit(limit)
    .offset(offset)
}

/**
 * 标记生成记录为失败
 */
export async function markGenerationFailed(id: string, errorMessage: string) {
  await getDb()
    .update(generationRecords)
    .set({ status: 'failed', errorMessage, dedupeKey: null, updatedAt: new Date() })
    .where(eq(generationRecords.id, id))
}

/**
 * 标记生成记录为"正在提交" — 调用 DashScope API 前一刻
 *
 * 状态机约束：pending → submitting（只在调 provider 前设置）
 * 用途：防止半完成状态 — 如果 submitting 超时，Worker 可扫描并标记 failed
 */
export async function markGenerationSubmitting(id: string) {
  await getDb()
    .update(generationRecords)
    .set({ status: 'submitting', updatedAt: new Date() })
    .where(eq(generationRecords.id, id))
}

/**
 * 标记生成记录为处理中
 */
export async function markGenerationProcessing(
  id: string,
  extra?: { taskId?: string, outputResult?: OutputResult },
) {
  await getDb()
    .update(generationRecords)
    .set({
      status: 'processing',
      ...(extra?.taskId && { taskId: extra.taskId }),
      ...(extra?.outputResult && { outputResult: extra.outputResult }),
      updatedAt: new Date(),
    })
    .where(eq(generationRecords.id, id))
}

/**
 * 标记生成记录为"正在保存输出" — Worker 开始下载/存储输出文件
 *
 * 状态机约束：processing → saving_output（只在开始下载前设置）
 * 关键：保存输出文件失败时，不允许把记录静默标记为 succeeded
 * 用途：Worker 可扫描超时的 saving_output 记录并重试下载或标记 failed
 */
export async function markGenerationSavingOutput(id: string) {
  await getDb()
    .update(generationRecords)
    .set({ status: 'saving_output', updatedAt: new Date() })
    .where(eq(generationRecords.id, id))
}

/**
 * 标记生成记录为成功
 */
export async function markGenerationSucceeded(
  id: string,
  outputResult: OutputResult,
  cost?: CostDetail,
) {
  await getDb()
    .update(generationRecords)
    .set({
      status: 'succeeded',
      outputResult,
      ...(cost && { cost, totalPriceCents: cost.totalPriceCents }),
      updatedAt: new Date(),
    })
    .where(eq(generationRecords.id, id))
}

/**
 * 删除单条生成记录
 */
export async function deleteGenerationRecord(id: string) {
  await getDb().delete(generationRecords).where(eq(generationRecords.id, id))
}

/** 重置生成记录为 pending 状态（重试时清除 errorMessage，递增 retryCount，清除 dedupeKey） */
export async function resetGenerationToPending(id: string) {
  await getDb()
    .update(generationRecords)
    .set({ status: 'pending', errorMessage: null, retryCount: sql`${generationRecords.retryCount} + 1`, dedupeKey: null, updatedAt: new Date() })
    .where(eq(generationRecords.id, id))
}

export type ProviderCancelStatus = 'not_requested' | 'no_task' | 'requested' | 'succeeded' | 'failed'

/** 取消生成记录（用户主动取消，状态直接设为 cancelled） */
export async function cancelGenerationRecord(id: string, providerCancelStatus: ProviderCancelStatus = 'not_requested') {
  await getDb()
    .update(generationRecords)
    .set({
      status: 'cancelled',
      errorMessage: '用户取消',
      dedupeKey: null,
      cancelRequestedAt: new Date(),
      providerCancelStatus,
      updatedAt: new Date(),
    })
    .where(eq(generationRecords.id, id))
}

/** 非终态生成状态：仅这些状态的记录可被级联取消（避免覆盖已 succeeded/failed 的记录） */
const ACTIVE_GENERATION_STATUSES = ['pending', 'submitting', 'processing', 'saving_output'] as const

/**
 * 仅当生成记录处于非终态（pending/submitting/processing/saving_output）时取消。
 *
 * 用于管理后台任务取消的跨业务级联：running 态取消任务时 worker 可能已完成并
 * markGenerationSucceeded，此时不应把成功产物覆盖为 cancelled。
 *
 * @returns 是否实际取消（false = 记录已终态，跳过；true = 已置 cancelled）
 */
export async function cancelGenerationRecordIfActive(
  id: string,
  errorMessage = '管理员取消任务',
  providerCancelStatus: ProviderCancelStatus = 'not_requested',
): Promise<boolean> {
  const [updated] = await getDb()
    .update(generationRecords)
    .set({
      status: 'cancelled',
      errorMessage,
      dedupeKey: null,
      cancelRequestedAt: new Date(),
      providerCancelStatus,
      updatedAt: new Date(),
    })
    .where(and(
      eq(generationRecords.id, id),
      inArray(generationRecords.status, [...ACTIVE_GENERATION_STATUSES]),
    ))
    .returning()
  return !!updated
}

/** 可被重排级联重置的终态：failed/cancelled（非成功的终态，重跑有意义） */
const REQUEUEABLE_GENERATION_STATUSES = ['failed', 'cancelled'] as const

/**
 * 仅当生成记录处于非成功终态（failed/cancelled）时重置为 pending，配合管理后台任务重排。
 *
 * `cancelGenerationRecordIfActive` 的对偶：取消级联只动 active 记录，重排级联只动终态记录。
 * requeue 后 worker 重跑会自然把记录推到终态，此处仅为重跑窗口内的 UI 一致性——
 * 把滞留 failed/cancelled 的记录重置为 pending（清 errorMessage、递增 retryCount、清 dedupeKey），
 * 使其反映"正在重试"。已 active（processing 等）或 succeeded 的记录不动（避免回退/覆盖成功产物）。
 *
 * @returns 是否实际重置（false = 记录非可重排终态，跳过；true = 已置 pending）
 */
export async function requeueGenerationRecordIfRequeueable(id: string): Promise<boolean> {
  const [updated] = await getDb()
    .update(generationRecords)
    .set({ status: 'pending', errorMessage: null, retryCount: sql`${generationRecords.retryCount} + 1`, dedupeKey: null, updatedAt: new Date() })
    .where(and(
      eq(generationRecords.id, id),
      inArray(generationRecords.status, [...REQUEUEABLE_GENERATION_STATUSES]),
    ))
    .returning()
  return !!updated
}

/**
 * 按 dedupeKey 查询记录，防止同参数重复提交
 */
export async function findGenerationByDedupeKey(dedupeKey: string) {
  const [record] = await getDb()
    .select()
    .from(generationRecords)
    .where(eq(generationRecords.dedupeKey, dedupeKey))
    .limit(1)
  return record ?? null
}

/**
 * 按 dedupeKey + accountId 查询记录，防止同用户同参数重复提交
 */
export async function findGenerationByDedupeKeyForAccount(dedupeKey: string, accountId: string) {
  const [record] = await getDb()
    .select()
    .from(generationRecords)
    .where(and(eq(generationRecords.dedupeKey, dedupeKey), eq(generationRecords.accountId, accountId)))
    .limit(1)
  return record ?? null
}
/** 获取含费用信息的记录，用于账单统计 */
export async function getCostRecords(accountId: string, dateRange?: { from: Date, to: Date }) {
  const conditions = [isNotNull(generationRecords.cost), eq(generationRecords.accountId, accountId)]
  if (dateRange) {
    conditions.push(gte(generationRecords.createdAt, dateRange.from))
    conditions.push(lte(generationRecords.createdAt, dateRange.to))
  }

  const records = await getDb()
    .select({
      model: generationRecords.model,
      category: generationRecords.category,
      status: generationRecords.status,
      cost: generationRecords.cost,
      createdAt: generationRecords.createdAt,
    })
    .from(generationRecords)
    .where(and(...conditions))

  return records.filter(r => r.cost && (typeof r.cost.totalPriceCents === 'number' || typeof r.cost.totalPrice === 'number'))
}

/** 隐藏生成记录（从资产中心移除，不删除 DB 记录） */
export async function hideGenerationRecord(id: string) {
  const [updated] = await getDb()
    .update(generationRecords)
    .set({ hiddenAt: new Date(), updatedAt: new Date() })
    .where(eq(generationRecords.id, id))
    .returning()
  return updated ?? null
}

/** 恢复已隐藏的生成记录（repository 层，暂不做 UI） */
export async function unhideGenerationRecord(id: string) {
  const [updated] = await getDb()
    .update(generationRecords)
    .set({ hiddenAt: null, updatedAt: new Date() })
    .where(eq(generationRecords.id, id))
    .returning()
  return updated ?? null
}

/**
 * 查询 Canvas 项目关联的所有生成记录 — 用于资产轮询接口
 *
 * 通过 JSONB path 提取 inputParams 中的 source/projectId/shotId 字段，
 * 避免在 generation_records 表上增加 canvas 专用列。
 *
 * 注意：character/location 参考图生成不走 generation_records，
 * 所以 shotId 是唯一可提取的 targetId。
 */
export async function listCanvasGenerationRecordsByProject(projectId: string) {
  return getDb()
    .select({
      id: generationRecords.id,
      category: generationRecords.category,
      status: generationRecords.status,
      totalPriceCents: generationRecords.totalPriceCents,
      cost: generationRecords.cost,
      errorMessage: generationRecords.errorMessage,
      retryCount: generationRecords.retryCount,
      updatedAt: generationRecords.updatedAt,
      shotId: sql<string | null>`input_params->>'shotId'`,
    })
    .from(generationRecords)
    .where(
      and(
        sql`input_params->>'source' = 'canvas'`,
        sql`input_params->>'projectId' = ${projectId}`,
      ),
    )
}

/**
 * Gateway 用量查询过滤条件 — 用于 OpenAI 兼容网关的 /v1/usage 路由
 */
export interface ListGatewayUsageRecordsFilter {
  accountId: string
  createdFrom?: Date
  createdTo?: Date
  limit?: number
  offset?: number
}

/**
 * 查询当前用户的 Gateway 调用记录 — 用于 /v1/usage 用量查询
 *
 * 通过 JSONB `input_params->>'source' = 'gateway'` 过滤，
 * 与 Canvas 生成记录共用 generation_records 表，无需 migration。
 * 按 createdAt desc 排序，limit 默认 50，调用方需自行 clamp 上限。
 */
export async function listGatewayUsageRecords(filter: ListGatewayUsageRecordsFilter) {
  const { accountId, createdFrom, createdTo, limit = 50, offset = 0 } = filter

  const conditions = [
    eq(generationRecords.accountId, accountId),
    sql`input_params->>'source' = 'gateway'`,
  ]
  if (createdFrom)
    conditions.push(gte(generationRecords.createdAt, createdFrom))
  if (createdTo)
    conditions.push(lte(generationRecords.createdAt, createdTo))

  return getDb()
    .select()
    .from(generationRecords)
    .where(and(...conditions))
    .orderBy(desc(generationRecords.createdAt))
    .limit(limit)
    .offset(offset)
}
