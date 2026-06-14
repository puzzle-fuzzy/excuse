import type { SQL } from 'drizzle-orm'
import type { TaskRow } from '../types'
import { and, count, desc, eq, ilike, inArray, ne, or, sql } from 'drizzle-orm'
import { getDb } from '../db'
import { accounts, canvasPipelineRuns, canvasProjects, generationRecords, tasks } from '../schema'

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
