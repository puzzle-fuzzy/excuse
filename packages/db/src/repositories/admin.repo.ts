import type { SQL } from 'drizzle-orm'
import type { TaskRow } from '../types'
import { and, count, desc, eq, ilike, inArray, ne, or, sql } from 'drizzle-orm'
import { getDb } from '../db'
import { accounts, canvasPipelineRuns, canvasProjects, creditAccounts, generationRecords, tasks } from '../schema'

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

  return updated ? serializeAdminTask(updated) : null
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

  return updated ? serializeAdminTask(updated) : null
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
