import { and, count, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { getDb } from '../../db'
import { accounts, canvasPipelineRuns, canvasProjects, generationRecords, tasks } from '../../schema'
import { iso, numberValue } from './internal'

export interface AdminOverview {
  summary: AdminSummary
  generationStatus: AdminStatusCount[]
  canvasProjectStatus: AdminStatusCount[]
  taskQueue: AdminTaskQueueCount[]
  recentFailures: AdminRecentFailure[]
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

function mapStatusCounts(rows: Array<{ status: string, count: unknown }>): AdminStatusCount[] {
  return rows.map(row => ({
    status: row.status,
    count: numberValue(row.count),
  }))
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
        totalCostCents: sql<number>`coalesce(sum(${generationRecords.totalPriceCents}), 0)`,
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
