import type { SQL } from 'drizzle-orm'
import { and, count, desc, eq, ilike, sql } from 'drizzle-orm'
import { getDb } from '../../db'
import { accounts, canvasProjects, canvasShots } from '../../schema'
import { numberValue } from './internal'

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
