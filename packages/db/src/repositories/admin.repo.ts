import type { SQL } from 'drizzle-orm'
import type { TaskRow } from '../types'
import { and, asc, between, count, desc, eq, ilike, inArray, ne, or, sql } from 'drizzle-orm'
import { getDb } from '../db'
import { accounts, apiKeys, canvasPipelineRuns, canvasProjects, canvasShots, creditAccounts, generationRecords, tasks } from '../schema'
import { listAdminApiKeysByAccount } from './api-keys.repo'
import { cancelGenerationRecordIfActive, listGatewayUsageRecords, requeueGenerationRecordIfRequeueable } from './generation-records.repo'

export interface AdminOverview {
  summary: AdminSummary
  generationStatus: AdminStatusCount[]
  canvasProjectStatus: AdminStatusCount[]
  taskQueue: AdminTaskQueueCount[]
  recentFailures: AdminRecentFailure[]
}

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

export interface AdminSummary {
  totalUsers: number
  activeUsers: number
  totalGenerationRecords: number
  failedGenerationRecords: number
  totalCostCents: number
  activeTasks: number
  activeCanvasProjects: number
}

export interface AdminStatusCount {
  status: string
  count: number
}

export interface AdminTaskQueueCount {
  domain: string
  status: string
  count: number
}

export interface AdminRecentFailure {
  id: string
  kind: 'generation' | 'task' | 'canvas_pipeline'
  accountId: string | null
  title: string
  status: string
  errorMessage: string | null
  createdAt: string
  updatedAt: string | null
}

type AdminTaskStatus = TaskRow['status']
type AdminTaskDomain = TaskRow['domain']

const TASK_STATUSES: AdminTaskStatus[] = ['queued', 'running', 'retrying', 'succeeded', 'failed', 'cancelled']
const TASK_DOMAINS: AdminTaskDomain[] = ['canvas', 'generate', 'subtitle', 'gateway']
const REQUEUEABLE_STATUSES: AdminTaskStatus[] = ['failed', 'retrying', 'queued']
const CANCELLABLE_STATUSES: AdminTaskStatus[] = ['queued', 'running', 'retrying']

function numberValue(value: unknown): number {
  return Number(value ?? 0)
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value)
    return null
  return value instanceof Date ? value.toISOString() : value
}

function mapStatusCounts(rows: Array<{ status: string, count: unknown }>): AdminStatusCount[] {
  return rows.map(row => ({
    status: row.status,
    count: numberValue(row.count),
  }))
}

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

export async function getAdminOverview(): Promise<AdminOverview> {
  const [
    userRows,
    generationRows,
    activeTaskRows,
    activeCanvasRows,
    generationStatusRows,
    canvasProjectStatusRows,
    taskQueueRows,
    generationFailures,
    taskFailures,
    pipelineFailures,
  ] = await Promise.all([
    getDb()
      .select({
        totalUsers: sql<number>`count(*)::int`,
        activeUsers: sql<number>`count(*) filter (where ${accounts.isActive} = true)::int`,
      })
      .from(accounts),
    getDb()
      .select({
        totalGenerationRecords: sql<number>`count(*)::int`,
        failedGenerationRecords: sql<number>`count(*) filter (where ${generationRecords.status} = 'failed')::int`,
        totalCostCents: sql<number>`coalesce(sum(${generationRecords.totalPriceCents}), 0)::int`,
      })
      .from(generationRecords),
    getDb()
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(inArray(tasks.status, ['queued', 'running', 'retrying'])),
    getDb()
      .select({ count: sql<number>`count(*)::int` })
      .from(canvasProjects)
      .where(and(
        eq(canvasProjects.isDeleted, false),
        ne(canvasProjects.status, 'completed'),
        ne(canvasProjects.status, 'failed'),
      )),
    getDb()
      .select({
        status: generationRecords.status,
        count: count(),
      })
      .from(generationRecords)
      .groupBy(generationRecords.status),
    getDb()
      .select({
        status: canvasProjects.status,
        count: count(),
      })
      .from(canvasProjects)
      .where(eq(canvasProjects.isDeleted, false))
      .groupBy(canvasProjects.status),
    getDb()
      .select({
        domain: tasks.domain,
        status: tasks.status,
        count: count(),
      })
      .from(tasks)
      .groupBy(tasks.domain, tasks.status),
    getDb()
      .select({
        id: generationRecords.id,
        accountId: generationRecords.accountId,
        title: generationRecords.model,
        status: generationRecords.status,
        errorMessage: generationRecords.errorMessage,
        createdAt: generationRecords.createdAt,
        updatedAt: generationRecords.updatedAt,
      })
      .from(generationRecords)
      .where(eq(generationRecords.status, 'failed'))
      .orderBy(desc(generationRecords.updatedAt))
      .limit(8),
    getDb()
      .select({
        id: tasks.id,
        accountId: tasks.accountId,
        title: tasks.type,
        status: tasks.status,
        errorMessage: tasks.errorMessage,
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
      })
      .from(tasks)
      .where(eq(tasks.status, 'failed'))
      .orderBy(desc(tasks.updatedAt))
      .limit(8),
    getDb()
      .select({
        id: canvasPipelineRuns.id,
        accountId: canvasPipelineRuns.createdBy,
        title: canvasPipelineRuns.phase,
        status: canvasPipelineRuns.status,
        errorMessage: canvasPipelineRuns.errorMessage,
        createdAt: canvasPipelineRuns.createdAt,
        updatedAt: canvasPipelineRuns.finishedAt,
      })
      .from(canvasPipelineRuns)
      .where(eq(canvasPipelineRuns.status, 'failed'))
      .orderBy(desc(canvasPipelineRuns.finishedAt))
      .limit(8),
  ])

  const failures: AdminRecentFailure[] = [
    ...generationFailures.map(row => ({
      id: row.id,
      kind: 'generation' as const,
      accountId: row.accountId,
      title: row.title,
      status: row.status,
      errorMessage: row.errorMessage,
      createdAt: iso(row.createdAt)!,
      updatedAt: iso(row.updatedAt),
    })),
    ...taskFailures.map(row => ({
      id: row.id,
      kind: 'task' as const,
      accountId: row.accountId,
      title: row.title,
      status: row.status,
      errorMessage: row.errorMessage,
      createdAt: iso(row.createdAt)!,
      updatedAt: iso(row.updatedAt),
    })),
    ...pipelineFailures.map(row => ({
      id: row.id,
      kind: 'canvas_pipeline' as const,
      accountId: row.accountId,
      title: row.title,
      status: row.status,
      errorMessage: row.errorMessage,
      createdAt: iso(row.createdAt)!,
      updatedAt: iso(row.updatedAt),
    })),
  ]
    .sort((a, b) => new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime())
    .slice(0, 12)

  const taskQueue: AdminTaskQueueCount[] = taskQueueRows.map(row => ({
    domain: row.domain,
    status: row.status,
    count: numberValue(row.count),
  }))

  return {
    summary: {
      totalUsers: numberValue(userRows[0]?.totalUsers),
      activeUsers: numberValue(userRows[0]?.activeUsers),
      totalGenerationRecords: numberValue(generationRows[0]?.totalGenerationRecords),
      failedGenerationRecords: numberValue(generationRows[0]?.failedGenerationRecords),
      totalCostCents: numberValue(generationRows[0]?.totalCostCents),
      activeTasks: numberValue(activeTaskRows[0]?.count),
      activeCanvasProjects: numberValue(activeCanvasRows[0]?.count),
    },
    generationStatus: mapStatusCounts(generationStatusRows),
    canvasProjectStatus: mapStatusCounts(canvasProjectStatusRows),
    taskQueue,
    recentFailures: failures,
  }
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

// ── 用户级运营统计 ──────────────────────────────────────────────────────────

export interface AdminUserListQuery {
  search?: string
  isActive?: boolean
  limit?: number
  offset?: number
}

export interface AdminUserSummaryRow {
  id: string
  username: string
  email: string | null
  isActive: boolean
  createdAt: string
  lastActivityAt: string | null
  creditBalanceCents: number
  totalCostCents: number
  totalCalls: number
}

export interface AdminUserDailyCostRow {
  date: string
  costCents: number
  calls: number
}

export interface AdminUserModelBreakdownRow {
  model: string
  calls: number
  costCents: number
}

export interface AdminUserRecentRecordRow {
  id: string
  model: string
  status: string
  costCents: number
  createdAt: string
  providerTaskId: string | null
  executionKind: 'inline' | 'legacy-provider-task' | 'canvas-worker' | 'gateway'
}

export interface AdminUserDetailRow {
  summary: AdminUserSummaryRow
  dailyCost: AdminUserDailyCostRow[]
  modelBreakdown: AdminUserModelBreakdownRow[]
  recentRecords: AdminUserRecentRecordRow[]
}

export interface AdminProviderStatsDbRow {
  model: string
  category: string
  totalCalls: number
  succeededCalls: number
  failedCalls: number
  totalCostCents: number
  totalInputTokens: number
  totalOutputTokens: number
}

function buildAdminUserListFilters(query: AdminUserListQuery): SQL | undefined {
  const conditions: SQL[] = []

  if (query.isActive !== undefined)
    conditions.push(eq(accounts.isActive, query.isActive))

  const search = query.search?.trim()
  if (search) {
    const pattern = `%${search}%`
    const searchCondition = or(
      ilike(accounts.username, pattern),
      ilike(accounts.email, pattern),
    )
    if (searchCondition)
      conditions.push(searchCondition)
  }

  return conditions.length > 0 ? and(...conditions) : undefined
}

export async function listAdminUsers(
  query: AdminUserListQuery = {},
): Promise<{ items: AdminUserSummaryRow[], total: number }> {
  const limit = Math.min(Math.max(query.limit ?? 20, 1), 100)
  const offset = Math.max(query.offset ?? 0, 0)
  const where = buildAdminUserListFilters(query)

  const [rows, totalRows] = await Promise.all([
    getDb()
      .select({
        id: accounts.id,
        username: accounts.username,
        email: accounts.email,
        isActive: accounts.isActive,
        createdAt: accounts.createdAt,
        creditBalanceCents: sql<number>`coalesce(${creditAccounts.availableCents}, 0)::int`,
        totalCostCents: sql<number>`coalesce(agg.total_cost, 0)::int`,
        totalCalls: sql<number>`coalesce(agg.total_calls, 0)::int`,
        lastActivityAt: sql<Date | null>`agg.last_activity`,
      })
      .from(accounts)
      .leftJoin(creditAccounts, eq(creditAccounts.accountId, accounts.id))
      .leftJoin(
        sql`(SELECT account_id, sum(total_price_cents)::int AS total_cost, count(*)::int AS total_calls, max(created_at) AS last_activity FROM generation_records GROUP BY account_id) AS agg`,
        sql`agg.account_id = ${accounts.id}`,
      )
      .where(where)
      .orderBy(desc(accounts.createdAt))
      .limit(limit)
      .offset(offset),
    getDb()
      .select({ count: sql<number>`count(*)::int` })
      .from(accounts)
      .where(where),
  ])

  return {
    items: rows.map(row => ({
      id: row.id,
      username: row.username,
      email: row.email,
      isActive: row.isActive,
      createdAt: iso(row.createdAt)!,
      creditBalanceCents: numberValue(row.creditBalanceCents),
      totalCostCents: numberValue(row.totalCostCents),
      totalCalls: numberValue(row.totalCalls),
      lastActivityAt: iso(row.lastActivityAt),
    })),
    total: numberValue(totalRows[0]?.count),
  }
}

export async function getAdminUserDetail(
  accountId: string,
): Promise<AdminUserDetailRow | null> {
  const [summaryRows, dailyRows, modelRows, recentRows] = await Promise.all([
    getDb()
      .select({
        id: accounts.id,
        username: accounts.username,
        email: accounts.email,
        isActive: accounts.isActive,
        createdAt: accounts.createdAt,
        creditBalanceCents: sql<number>`coalesce(${creditAccounts.availableCents}, 0)::int`,
        totalCostCents: sql<number>`coalesce(agg.total_cost, 0)::int`,
        totalCalls: sql<number>`coalesce(agg.total_calls, 0)::int`,
        lastActivityAt: sql<Date | null>`agg.last_activity`,
      })
      .from(accounts)
      .leftJoin(creditAccounts, eq(creditAccounts.accountId, accounts.id))
      .leftJoin(
        sql`(SELECT account_id, sum(total_price_cents)::int AS total_cost, count(*)::int AS total_calls, max(created_at) AS last_activity FROM generation_records GROUP BY account_id) AS agg`,
        sql`agg.account_id = ${accounts.id}`,
      )
      .where(eq(accounts.id, accountId))
      .limit(1),
    getDb()
      .select({
        date: sql<string>`to_char(date_trunc('day', ${generationRecords.createdAt}), 'YYYY-MM-DD')`,
        costCents: sql<number>`coalesce(sum(${generationRecords.totalPriceCents}), 0)::int`,
        calls: sql<number>`count(*)::int`,
      })
      .from(generationRecords)
      .where(and(
        eq(generationRecords.accountId, accountId),
        sql`${generationRecords.createdAt} > now() - interval '30 days'`,
      ))
      .groupBy(sql`date_trunc('day', ${generationRecords.createdAt})`)
      .orderBy(sql`date_trunc('day', ${generationRecords.createdAt})`),
    getDb()
      .select({
        model: generationRecords.model,
        calls: sql<number>`count(*)::int`,
        costCents: sql<number>`coalesce(sum(${generationRecords.totalPriceCents}), 0)::int`,
      })
      .from(generationRecords)
      .where(eq(generationRecords.accountId, accountId))
      .groupBy(generationRecords.model)
      .orderBy(desc(sql`sum(${generationRecords.totalPriceCents})`))
      .limit(10),
    getDb()
      .select({
        id: generationRecords.id,
        model: generationRecords.model,
        status: generationRecords.status,
        costCents: sql<number>`coalesce(${generationRecords.totalPriceCents}, 0)::int`,
        createdAt: generationRecords.createdAt,
        providerTaskId: generationRecords.taskId,
        source: sql<string | null>`${generationRecords.inputParams}->>'source'`,
      })
      .from(generationRecords)
      .where(eq(generationRecords.accountId, accountId))
      .orderBy(desc(generationRecords.createdAt))
      .limit(10),
  ])

  const summaryRow = summaryRows[0]
  if (!summaryRow)
    return null

  return {
    summary: {
      id: summaryRow.id,
      username: summaryRow.username,
      email: summaryRow.email,
      isActive: summaryRow.isActive,
      createdAt: iso(summaryRow.createdAt)!,
      creditBalanceCents: numberValue(summaryRow.creditBalanceCents),
      totalCostCents: numberValue(summaryRow.totalCostCents),
      totalCalls: numberValue(summaryRow.totalCalls),
      lastActivityAt: iso(summaryRow.lastActivityAt),
    },
    dailyCost: dailyRows.map(row => ({
      date: row.date,
      costCents: numberValue(row.costCents),
      calls: numberValue(row.calls),
    })),
    modelBreakdown: modelRows.map(row => ({
      model: row.model,
      calls: numberValue(row.calls),
      costCents: numberValue(row.costCents),
    })),
    recentRecords: recentRows.map(row => ({
      id: row.id,
      model: row.model,
      status: row.status,
      costCents: numberValue(row.costCents),
      createdAt: iso(row.createdAt)!,
      providerTaskId: row.providerTaskId,
      executionKind: row.source === 'canvas'
        ? 'canvas-worker'
        : row.source === 'gateway'
          ? 'gateway'
          : row.providerTaskId
            ? 'legacy-provider-task'
            : 'inline',
    })),
  }
}

/**
 * Provider 错误率 + 模型成本统计（DB 部分）。
 *
 * 只返回 generation_records 聚合的 count + cost + tokens；延迟部分
 * （avgLatencyMs / p50 / p95）由 route 层从 metricsCollector.snapshot().providerCalls
 * 注入并合并，因为 packages/db 不持有 server runtime 单例。
 */
export async function getAdminProviderStats(
  windowHours: number = 24,
): Promise<AdminProviderStatsDbRow[]> {
  const safeWindowHours = Math.min(Math.max(Math.trunc(windowHours), 1), 24 * 30)
  const rows = await getDb()
    .select({
      model: generationRecords.model,
      category: generationRecords.category,
      totalCalls: sql<number>`count(*)::int`,
      succeededCalls: sql<number>`count(*) filter (where ${generationRecords.status} = 'succeeded')::int`,
      failedCalls: sql<number>`count(*) filter (where ${generationRecords.status} = 'failed')::int`,
      totalCostCents: sql<number>`coalesce(sum(${generationRecords.totalPriceCents}), 0)::int`,
      totalInputTokens: sql<number>`coalesce(sum((${generationRecords.cost}->>'inputTokens')::numeric), 0)::int`,
      totalOutputTokens: sql<number>`coalesce(sum((${generationRecords.cost}->>'outputTokens')::numeric), 0)::int`,
    })
    .from(generationRecords)
    .where(sql`${generationRecords.createdAt} > now() - interval '${sql.raw(String(safeWindowHours))} hours'`)
    .groupBy(generationRecords.model, generationRecords.category)
    .orderBy(desc(sql`count(*)`))

  return rows.map(row => ({
    model: row.model,
    category: row.category,
    totalCalls: numberValue(row.totalCalls),
    succeededCalls: numberValue(row.succeededCalls),
    failedCalls: numberValue(row.failedCalls),
    totalCostCents: numberValue(row.totalCostCents),
    totalInputTokens: numberValue(row.totalInputTokens),
    totalOutputTokens: numberValue(row.totalOutputTokens),
  }))
}

// ── Project row types ───────────────────────────────────────────────────────

export interface AdminProjectDbRow {
  id: string
  accountId: string
  username: string | null
  title: string | null
  status: string
  shotCount: number
  completedShotCount: number
  modelPreferencesJson: Record<string, unknown> | null
  isDeleted: boolean
  createdAt: Date
  updatedAt: Date | null
}

/**
 * 查询 Canvas 项目列表（管理后台用）。
 * 支持按标题搜索、按状态过滤、软删除过滤、分页。
 */
export async function listAdminProjects(
  query: {
    search?: string
    status?: string
    isDeleted?: boolean
    limit?: number
    offset?: number
  } = {},
): Promise<{ items: AdminProjectDbRow[], total: number }> {
  const conditions: SQL[] = []

  if (query.search) {
    conditions.push(ilike(canvasProjects.title, `%${query.search}%`))
  }
  if (query.status) {
    conditions.push(eq(canvasProjects.status, query.status as never))
  }
  if (query.isDeleted !== undefined) {
    conditions.push(eq(canvasProjects.isDeleted, query.isDeleted))
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined
  const limit = Math.min(Math.max(query.limit ?? 20, 1), 100)
  const offset = Math.max(query.offset ?? 0, 0)

  const shotStats = getDb().$with('shot_stats').as(
    getDb()
      .select({
        projectId: canvasShots.projectId,
        shotCount: sql<number>`count(*)::int`.as('shot_count'),
        completedShotCount: sql<number>`count(*) filter (where ${canvasShots.status} = 'completed')::int`.as('completed_shot_count'),
      })
      .from(canvasShots)
      .groupBy(canvasShots.projectId),
  )

  const [rows, totalRows] = await Promise.all([
    getDb()
      .with(shotStats)
      .select({
        id: canvasProjects.id,
        accountId: canvasProjects.accountId,
        username: accounts.username,
        title: canvasProjects.title,
        status: canvasProjects.status,
        shotCount: sql<number>`coalesce(${shotStats.shotCount}, 0)::int`,
        completedShotCount: sql<number>`coalesce(${shotStats.completedShotCount}, 0)::int`,
        modelPreferencesJson: canvasProjects.modelPreferencesJson,
        isDeleted: canvasProjects.isDeleted,
        createdAt: canvasProjects.createdAt,
        updatedAt: canvasProjects.updatedAt,
      })
      .from(canvasProjects)
      .leftJoin(accounts, eq(canvasProjects.accountId, accounts.id))
      .leftJoin(shotStats, eq(canvasProjects.id, shotStats.projectId))
      .where(where)
      .orderBy(desc(canvasProjects.createdAt))
      .limit(limit)
      .offset(offset),
    getDb()
      .select({ total: count() })
      .from(canvasProjects)
      .where(where),
  ])

  return {
    items: rows.map(row => ({
      id: row.id,
      accountId: row.accountId,
      username: row.username,
      title: row.title ?? '',
      status: row.status,
      shotCount: numberValue(row.shotCount),
      completedShotCount: numberValue(row.completedShotCount),
      modelPreferencesJson: row.modelPreferencesJson as Record<string, unknown> | null,
      isDeleted: row.isDeleted,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
    total: Number(totalRows[0]?.total ?? 0),
  }
}

// ── Gateway 客户管理 ──────────────────────────────────────────────────────────

export interface AdminGatewayClientListQuery {
  search?: string
  limit?: number
  offset?: number
}

export interface AdminGatewayClientItemRow {
  accountId: string
  username: string
  email: string | null
  activeKeyCount: number
  totalKeyCount: number
  totalSpendCents: number
  /** 任一 key 无限额（quotaMaxCents is null）则为 null */
  totalQuotaCents: number | null
  lastKeyActivityAt: string | null
}

/**
 * 查询持有 ≥1 个 API Key 的账户（即 Gateway 客户），按账户聚合 key 计数 / 消耗 / 额度上限。
 *
 * INNER JOIN api_keys 确保只返回有 key 的账户；totalQuotaCents 在任一 key 无限额时返回 null
 * （整体视为无硬上限）。`total` 用 `count(distinct account_id)` 与列表同口径。
 */
export async function listAdminGatewayClients(
  query: AdminGatewayClientListQuery = {},
): Promise<{ items: AdminGatewayClientItemRow[], total: number }> {
  const limit = Math.min(Math.max(query.limit ?? 20, 1), 100)
  const offset = Math.max(query.offset ?? 0, 0)

  const search = query.search?.trim()
  const searchCondition = search
    ? or(ilike(accounts.username, `%${search}%`), ilike(accounts.email, `%${search}%`))
    : undefined

  const [rows, totalRows] = await Promise.all([
    getDb()
      .select({
        accountId: accounts.id,
        username: accounts.username,
        email: accounts.email,
        totalKeyCount: sql<number>`count(*)::int`,
        activeKeyCount: sql<number>`count(*) filter (where ${apiKeys.revokedAt} is null)::int`,
        totalSpendCents: sql<number>`coalesce(sum(${apiKeys.totalSpendCents}), 0)::int`,
        totalQuotaCents: sql<number | null>`case when count(*) filter (where ${apiKeys.quotaMaxCents} is null) > 0 then null else coalesce(sum(${apiKeys.quotaMaxCents}), 0)::int end`,
        lastKeyActivityAt: sql<Date | null>`max(${apiKeys.lastUsedAt})`,
      })
      .from(accounts)
      .innerJoin(apiKeys, eq(apiKeys.accountId, accounts.id))
      .where(searchCondition)
      .groupBy(accounts.id, accounts.username, accounts.email)
      .orderBy(sql`max(${apiKeys.lastUsedAt}) desc nulls last`)
      .limit(limit)
      .offset(offset),
    getDb()
      .select({ count: sql<number>`count(distinct ${accounts.id})::int` })
      .from(accounts)
      .innerJoin(apiKeys, eq(apiKeys.accountId, accounts.id))
      .where(searchCondition),
  ])

  return {
    items: rows.map(row => ({
      accountId: row.accountId,
      username: row.username,
      email: row.email,
      totalKeyCount: numberValue(row.totalKeyCount),
      activeKeyCount: numberValue(row.activeKeyCount),
      totalSpendCents: numberValue(row.totalSpendCents),
      totalQuotaCents: row.totalQuotaCents,
      lastKeyActivityAt: iso(row.lastKeyActivityAt),
    })),
    total: numberValue(totalRows[0]?.count),
  }
}

export interface AdminGatewayClientSummaryRow {
  accountId: string
  username: string
  email: string | null
  creditBalanceCents: number
  activeKeyCount: number
  totalKeyCount: number
  totalSpendCents: number
  totalQuotaCents: number | null
  gatewayCalls: number
  gatewaySpendCents: number
  lastKeyActivityAt: string | null
}

export interface AdminGatewayRecentRecordRow {
  id: string
  model: string
  status: string
  costCents: number
  createdAt: string
}

export interface AdminGatewayClientDetailRow {
  summary: AdminGatewayClientSummaryRow
  keys: Awaited<ReturnType<typeof listAdminApiKeysByAccount>>
  recentGatewayRecords: AdminGatewayRecentRecordRow[]
}

/**
 * 单个 Gateway 客户详情：账户摘要 + 全部 key（含已撤销）+ 最近 50 条 Gateway 调用记录。
 *
 * 5 个并行查询（镜像 getAdminUserDetail 的 Promise.all 风格）：账户基本信息、key 聚合、
 * gateway 调用聚合、key 列表（复用 listAdminApiKeysByAccount）、gateway 调用记录（复用
 * listGatewayUsageRecords）。账户不存在返回 null（route 层 404）。
 */
export async function getAdminGatewayClientDetail(
  accountId: string,
): Promise<AdminGatewayClientDetailRow | null> {
  const [accountRows, keyAggRows, gatewayAggRows, keys, gatewayRecords] = await Promise.all([
    getDb()
      .select({
        id: accounts.id,
        username: accounts.username,
        email: accounts.email,
        creditBalanceCents: sql<number>`coalesce(${creditAccounts.availableCents}, 0)::int`,
      })
      .from(accounts)
      .leftJoin(creditAccounts, eq(creditAccounts.accountId, accounts.id))
      .where(eq(accounts.id, accountId))
      .limit(1),
    getDb()
      .select({
        totalKeyCount: sql<number>`count(*)::int`,
        activeKeyCount: sql<number>`count(*) filter (where ${apiKeys.revokedAt} is null)::int`,
        totalSpendCents: sql<number>`coalesce(sum(${apiKeys.totalSpendCents}), 0)::int`,
        totalQuotaCents: sql<number | null>`case when count(*) filter (where ${apiKeys.quotaMaxCents} is null) > 0 then null else coalesce(sum(${apiKeys.quotaMaxCents}), 0)::int end`,
        lastKeyActivityAt: sql<Date | null>`max(${apiKeys.lastUsedAt})`,
      })
      .from(apiKeys)
      .where(eq(apiKeys.accountId, accountId)),
    getDb()
      .select({
        gatewayCalls: sql<number>`count(*)::int`,
        gatewaySpendCents: sql<number>`coalesce(sum(${generationRecords.totalPriceCents}), 0)::int`,
      })
      .from(generationRecords)
      .where(and(eq(generationRecords.accountId, accountId), sql`input_params->>'source' = 'gateway'`)),
    listAdminApiKeysByAccount(accountId),
    listGatewayUsageRecords({ accountId, limit: 50 }),
  ])

  const account = accountRows[0]
  if (!account)
    return null

  const keyAgg = keyAggRows[0]
  const gatewayAgg = gatewayAggRows[0]

  return {
    summary: {
      accountId: account.id,
      username: account.username,
      email: account.email,
      creditBalanceCents: numberValue(account.creditBalanceCents),
      activeKeyCount: numberValue(keyAgg?.activeKeyCount),
      totalKeyCount: numberValue(keyAgg?.totalKeyCount),
      totalSpendCents: numberValue(keyAgg?.totalSpendCents),
      totalQuotaCents: keyAgg?.totalQuotaCents ?? null,
      gatewayCalls: numberValue(gatewayAgg?.gatewayCalls),
      gatewaySpendCents: numberValue(gatewayAgg?.gatewaySpendCents),
      lastKeyActivityAt: iso(keyAgg?.lastKeyActivityAt),
    },
    keys,
    recentGatewayRecords: gatewayRecords.map(record => ({
      id: record.id,
      model: record.model,
      status: record.status,
      costCents: numberValue(record.totalPriceCents),
      createdAt: iso(record.createdAt)!,
    })),
  }
}
