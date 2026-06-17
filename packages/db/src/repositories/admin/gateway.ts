import { and, eq, ilike, or, sql } from 'drizzle-orm'
import { getDb } from '../../db'
import { accounts, apiKeys, creditAccounts, generationRecords } from '../../schema'
import { listAdminApiKeysByAccount } from '../api-keys.repo'
import { listGatewayUsageRecords } from '../generation-records.repo'
import { iso, numberValue } from './internal'

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
        totalSpendCents: sql<number>`coalesce(sum(${apiKeys.totalSpendCents}), 0)`,
        totalQuotaCents: sql<number | null>`case when count(*) filter (where ${apiKeys.quotaMaxCents} is null) > 0 then null else coalesce(sum(${apiKeys.quotaMaxCents}), 0) end`,
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
        creditBalanceCents: sql<number>`coalesce(${creditAccounts.availableCents}, 0)`,
      })
      .from(accounts)
      .leftJoin(creditAccounts, eq(creditAccounts.accountId, accounts.id))
      .where(eq(accounts.id, accountId))
      .limit(1),
    getDb()
      .select({
        totalKeyCount: sql<number>`count(*)::int`,
        activeKeyCount: sql<number>`count(*) filter (where ${apiKeys.revokedAt} is null)::int`,
        totalSpendCents: sql<number>`coalesce(sum(${apiKeys.totalSpendCents}), 0)`,
        totalQuotaCents: sql<number | null>`case when count(*) filter (where ${apiKeys.quotaMaxCents} is null) > 0 then null else coalesce(sum(${apiKeys.quotaMaxCents}), 0) end`,
        lastKeyActivityAt: sql<Date | null>`max(${apiKeys.lastUsedAt})`,
      })
      .from(apiKeys)
      .where(eq(apiKeys.accountId, accountId)),
    getDb()
      .select({
        gatewayCalls: sql<number>`count(*)::int`,
        gatewaySpendCents: sql<number>`coalesce(sum(${generationRecords.totalPriceCents}), 0)`,
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
