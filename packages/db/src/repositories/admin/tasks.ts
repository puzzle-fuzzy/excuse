import type { SQL } from 'drizzle-orm'
import type { TaskRow } from '../../types'
import { and, asc, between, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { getDb } from '../../db'
import { canvasPipelineRuns, generationRecords, tasks } from '../../schema'
import { cancelGenerationRecordIfActive, requeueGenerationRecordIfRequeueable } from '../generation-records.repo'
import { iso, numberValue } from './internal'

export interface AdminTaskListQuery {
  status?: string
  domain?: string
  search?: string
  limit?: number
  offset?: number
}

export interface AdminTaskItem {
  id: string
  accountId: string
  type: string
  domain: string
  status: string
  priority: number
  attempts: number
  maxAttempts: number
  projectId: string | null
  targetType: string | null
  targetId: string | null
  generationRecordId: string | null
  lockedBy: string
  lockedUntil: string | null
  nextRunAt: string
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
  errorMessage: string | null
  canRequeue: boolean
  canCancel: boolean
}

type AdminTaskStatus = TaskRow['status']
type AdminTaskDomain = TaskRow['domain']

const TASK_STATUSES: AdminTaskStatus[] = ['queued', 'running', 'retrying', 'succeeded', 'failed', 'cancelled']
const TASK_DOMAINS: AdminTaskDomain[] = ['canvas', 'generate', 'subtitle', 'gateway']
const REQUEUEABLE_STATUSES: AdminTaskStatus[] = ['failed', 'retrying', 'queued']
const CANCELLABLE_STATUSES: AdminTaskStatus[] = ['queued', 'running', 'retrying']

function isTaskStatus(value: string | undefined): value is AdminTaskStatus {
  return TASK_STATUSES.includes(value as AdminTaskStatus)
}

function isTaskDomain(value: string | undefined): value is AdminTaskDomain {
  return TASK_DOMAINS.includes(value as AdminTaskDomain)
}

function canRequeueTaskStatus(status: string): boolean {
  return REQUEUEABLE_STATUSES.includes(status as AdminTaskStatus)
}

function canCancelTaskStatus(status: string): boolean {
  return CANCELLABLE_STATUSES.includes(status as AdminTaskStatus)
}

function serializeAdminTask(row: TaskRow): AdminTaskItem {
  return {
    id: row.id,
    accountId: row.accountId,
    type: row.type,
    domain: row.domain,
    status: row.status,
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    projectId: row.projectId,
    targetType: row.targetType,
    targetId: row.targetId,
    generationRecordId: row.generationRecordId,
    lockedBy: row.lockedBy,
    lockedUntil: iso(row.lockedUntil),
    nextRunAt: iso(row.nextRunAt)!,
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
    errorMessage: row.errorMessage,
    canRequeue: canRequeueTaskStatus(row.status),
    canCancel: canCancelTaskStatus(row.status),
  }
}

function buildAdminTaskFilters(query: AdminTaskListQuery): SQL | undefined {
  const conditions: SQL[] = []

  if (isTaskStatus(query.status))
    conditions.push(eq(tasks.status, query.status))

  if (isTaskDomain(query.domain))
    conditions.push(eq(tasks.domain, query.domain))

  const search = query.search?.trim()
  if (search) {
    const pattern = `%${search}%`
    const searchCondition = or(
      ilike(tasks.type, pattern),
      ilike(tasks.errorMessage, pattern),
      sql`${tasks.id}::text ilike ${pattern}`,
      sql`${tasks.accountId}::text ilike ${pattern}`,
      sql`${tasks.projectId}::text ilike ${pattern}`,
      sql`${tasks.generationRecordId}::text ilike ${pattern}`,
    )
    if (searchCondition)
      conditions.push(searchCondition)
  }

  return conditions.length > 0 ? and(...conditions) : undefined
}

export async function listAdminTasks(query: AdminTaskListQuery = {}): Promise<{ items: AdminTaskItem[], total: number }> {
  const limit = Math.min(Math.max(query.limit ?? 40, 1), 100)
  const offset = Math.max(query.offset ?? 0, 0)
  const where = buildAdminTaskFilters(query)

  const [rows, totalRows] = await Promise.all([
    getDb()
      .select()
      .from(tasks)
      .where(where)
      .orderBy(desc(tasks.updatedAt))
      .limit(limit)
      .offset(offset),
    getDb()
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(where),
  ])

  return {
    items: rows.map(serializeAdminTask),
    total: numberValue(totalRows[0]?.count),
  }
}

export interface AdminPipelineRunRow {
  id: string
  projectId: string | null
  phase: string
  status: string
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  errorMessage: string | null
  outputSummary: Record<string, unknown> | null
  createdAt: string
}

export interface AdminTaskGenerationRecordRow {
  id: string
  model: string
  category: string
  status: string
  costCents: number | null
  createdAt: string
  errorMessage: string | null
  matchReason: 'direct' | 'worker-task' | 'pipeline-run' | 'time-window'
}

export interface AdminTaskDetailRow {
  task: AdminTaskItem
  pipelineRuns: AdminPipelineRunRow[]
  generationRecords: AdminTaskGenerationRecordRow[]
}

/**
 * 单任务详情 + Canvas pipeline run 级联 + 关联生成记录（诊断用）。
 *
 * - pipeline_runs：通过 `canvas_pipeline_runs.taskId = tasks.id` 关联（软外键，无 FK 约束）。
 * - generation_records：多段策略——
 *   1) `task.generationRecordId` 非空时直接命中（`matchReason='direct'`，如 subtitle 烧录导出回填）；
 *   2) Canvas worker 写入 `input_params.workerTaskId/pipelineRunId` 时精确命中；
 *   3) 否则按 `accountId + 任务执行时间窗口` 返回候选（`matchReason='time-window'`），
 *      覆盖 canvas 等任务（其 generation_records 由 worker 在执行期间创建，无 task 列直接关联）。
 *      时间窗口匹配可能含并发记录，前端按候选展示。
 *
 * task 不存在返回 null（route 层 404）。非 canvas 域任务通常 pipelineRuns 为空。
 */
export async function getAdminTaskDetail(
  taskId: string,
): Promise<AdminTaskDetailRow | null> {
  const [taskRows, runRows] = await Promise.all([
    getDb()
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1),
    getDb()
      .select({
        id: canvasPipelineRuns.id,
        projectId: canvasPipelineRuns.projectId,
        phase: canvasPipelineRuns.phase,
        status: canvasPipelineRuns.status,
        startedAt: canvasPipelineRuns.startedAt,
        finishedAt: canvasPipelineRuns.finishedAt,
        errorMessage: canvasPipelineRuns.errorMessage,
        outputSummary: canvasPipelineRuns.outputSummaryJson,
        createdAt: canvasPipelineRuns.createdAt,
      })
      .from(canvasPipelineRuns)
      .where(eq(canvasPipelineRuns.taskId, taskId))
      .orderBy(asc(canvasPipelineRuns.createdAt)),
  ])

  const taskRow = taskRows[0]
  if (!taskRow)
    return null

  const pipelineRuns: AdminPipelineRunRow[] = runRows.map((row) => {
    const startedAtMs = row.startedAt ? new Date(row.startedAt).getTime() : null
    const finishedAtMs = row.finishedAt ? new Date(row.finishedAt).getTime() : null
    const durationMs = startedAtMs !== null && finishedAtMs !== null
      ? finishedAtMs - startedAtMs
      : null
    return {
      id: row.id,
      projectId: row.projectId,
      phase: row.phase,
      status: row.status,
      startedAt: iso(row.startedAt),
      finishedAt: iso(row.finishedAt),
      durationMs,
      errorMessage: row.errorMessage,
      outputSummary: (row.outputSummary as Record<string, unknown> | null) ?? null,
      createdAt: iso(row.createdAt)!,
    }
  })

  const generationRecords = await fetchTaskGenerationRecords(taskRow)

  return {
    task: serializeAdminTask(taskRow),
    pipelineRuns,
    generationRecords,
  }
}

/** 生成记录诊断查询的时间窗口前后缓冲（毫秒），覆盖任务执行期间 worker 创建的记录 */
const GEN_RECORD_WINDOW_PAD_MS = 2 * 60 * 1000
/** 时间窗口候选返回上限，避免长任务窗口拉回过多并发记录 */
const GEN_RECORD_CANDIDATE_LIMIT = 10

/**
 * 取任务关联的生成记录（诊断用）。
 * - task.generationRecordId 非空 → 精确命中（direct）。
 * - Canvas worker 元数据存在 → 按 workerTaskId / pipelineRunId 精确命中。
 * - 否则 → accountId + 时间窗口候选（time-window），按 createdAt asc，limit 上限。
 */
async function fetchTaskGenerationRecords(task: TaskRow): Promise<AdminTaskGenerationRecordRow[]> {
  const projection = {
    id: generationRecords.id,
    model: generationRecords.model,
    category: generationRecords.category,
    status: generationRecords.status,
    costCents: generationRecords.totalPriceCents,
    createdAt: generationRecords.createdAt,
    errorMessage: generationRecords.errorMessage,
  }

  if (task.generationRecordId) {
    const [direct] = await getDb()
      .select(projection)
      .from(generationRecords)
      .where(eq(generationRecords.id, task.generationRecordId))
      .limit(1)
    return direct
      ? [{ ...direct, costCents: direct.costCents ?? null, createdAt: iso(direct.createdAt)!, matchReason: 'direct' as const }]
      : []
  }

  const diagnosticConditions: SQL[] = [
    sql`${generationRecords.inputParams}->>'workerTaskId' = ${task.id}`,
  ]
  if (task.targetId)
    diagnosticConditions.push(sql`${generationRecords.inputParams}->>'pipelineRunId' = ${task.targetId}`)

  const diagnosticRows = await getDb()
    .select({
      ...projection,
      workerTaskId: sql<string | null>`${generationRecords.inputParams}->>'workerTaskId'`,
      pipelineRunId: sql<string | null>`${generationRecords.inputParams}->>'pipelineRunId'`,
    })
    .from(generationRecords)
    .where(and(
      eq(generationRecords.accountId, task.accountId),
      or(...diagnosticConditions),
    ))
    .orderBy(asc(generationRecords.createdAt))
    .limit(GEN_RECORD_CANDIDATE_LIMIT)

  if (diagnosticRows.length > 0) {
    return diagnosticRows.map(row => ({
      id: row.id,
      model: row.model,
      category: row.category,
      status: row.status,
      costCents: row.costCents ?? null,
      createdAt: iso(row.createdAt)!,
      errorMessage: row.errorMessage,
      matchReason: row.workerTaskId === task.id ? 'worker-task' as const : 'pipeline-run' as const,
    }))
  }

  // 任务执行时间窗口（createdAt ~ finishedAt，finishedAt 缺失时延伸至 now）
  const windowStart = new Date(task.createdAt.getTime() - GEN_RECORD_WINDOW_PAD_MS)
  const windowEnd = new Date(
    (task.finishedAt ?? new Date()).getTime() + GEN_RECORD_WINDOW_PAD_MS,
  )
  const rows = await getDb()
    .select(projection)
    .from(generationRecords)
    .where(and(
      eq(generationRecords.accountId, task.accountId),
      between(generationRecords.createdAt, windowStart, windowEnd),
    ))
    .orderBy(asc(generationRecords.createdAt))
    .limit(GEN_RECORD_CANDIDATE_LIMIT)

  return rows.map(row => ({
    ...row,
    costCents: row.costCents ?? null,
    createdAt: iso(row.createdAt)!,
    matchReason: 'time-window' as const,
  }))
}

export async function requeueAdminTask(id: string): Promise<AdminTaskItem | null> {
  const [updated] = await getDb()
    .update(tasks)
    .set({
      status: 'queued',
      attempts: 0,
      nextRunAt: new Date(),
      lockedBy: '',
      lockedUntil: null,
      startedAt: null,
      finishedAt: null,
      errorJson: null,
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(and(eq(tasks.id, id), inArray(tasks.status, REQUEUEABLE_STATUSES)))
    .returning()

  if (!updated)
    return null

  // 跨业务状态联动：级联重置关联 generation_record（仅终态 failed/cancelled）。
  // requeue 后 worker 重跑会自然推到终态，此处仅为重跑窗口内 UI 一致性——把滞留
  // failed/cancelled 的记录重置为 pending，使其反映"正在重试"。已 active 或 succeeded
  // 的记录不重置（避免回退/覆盖成功产物）。best-effort：任务已重排，级联失败不影响主操作
  // （repo 无 logger，静默降级）。cancelGenerationRecordIfActive 的对偶。
  if (updated.generationRecordId) {
    await requeueGenerationRecordIfRequeueable(updated.generationRecordId).catch(() => {})
  }

  return serializeAdminTask(updated)
}

export async function cancelAdminTask(id: string): Promise<AdminTaskItem | null> {
  const [updated] = await getDb()
    .update(tasks)
    .set({
      status: 'cancelled',
      lockedBy: '',
      lockedUntil: null,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(tasks.id, id), inArray(tasks.status, CANCELLABLE_STATUSES)))
    .returning()

  if (!updated)
    return null

  // 跨业务状态联动：级联取消关联 generation_record（仅非终态）。
  // 修复 queued 态取消任务后关联记录滞留 processing 的 bug；running 态取消时若 worker
  // 已完成并 markGenerationSucceeded，cancelGenerationRecordIfActive 跳过（不覆盖成功产物）。
  // best-effort：任务已取消，级联失败不影响主操作（repo 无 logger，静默降级）。
  if (updated.generationRecordId) {
    await cancelGenerationRecordIfActive(updated.generationRecordId).catch(() => {})
  }

  return serializeAdminTask(updated)
}
