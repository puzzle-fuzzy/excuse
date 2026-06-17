import type { SQL } from 'drizzle-orm'
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { getDb } from '../../db'
import { accounts, creditAccounts, generationRecords } from '../../schema'
import { iso, numberValue } from './internal'

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
