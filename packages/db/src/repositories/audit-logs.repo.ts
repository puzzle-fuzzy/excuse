import type { AuditDetail } from '../domain-types'
import { and, count, desc, eq, gte, lte } from 'drizzle-orm'
import { getDb } from '../db'
import { auditLogs } from '../schema/audit-logs'

/** 写入审计日志 — action 与 auditActionEnum 对应，detail 使用结构化 AuditDetail DTO */
export async function createAuditLog(values: {
  accountId?: string
  action: typeof auditLogs.action.enumValues[number]
  targetId?: string
  detail?: AuditDetail
  ip?: string
}) {
  await getDb().insert(auditLogs).values(values)
}

function buildAuditFilters(filters: {
  accountId?: string
  action?: string
  from?: Date
  to?: Date
}) {
  const conditions = []
  if (filters.accountId)
    conditions.push(eq(auditLogs.accountId, filters.accountId))
  if (filters.action)
    conditions.push(eq(auditLogs.action, filters.action as typeof auditLogs.action.enumValues[number]))
  if (filters.from)
    conditions.push(gte(auditLogs.createdAt, filters.from))
  if (filters.to)
    conditions.push(lte(auditLogs.createdAt, filters.to))
  return conditions
}

/**
 * 分页查询审计日志 — 支持按用户/操作类型/时间范围过滤
 * 默认按创建时间倒序，limit=100
 */
export async function queryAuditLogs(filters: {
  accountId?: string
  action?: string
  from?: Date
  to?: Date
  limit?: number
  offset?: number
}) {
  const conditions = buildAuditFilters(filters)

  return getDb()
    .select()
    .from(auditLogs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditLogs.createdAt))
    .limit(filters.limit ?? 100)
    .offset(filters.offset ?? 0)
}

/** 审计日志计数 — 与 queryAuditLogs 同条件，用于分页 total */
export async function countAuditLogs(filters: {
  accountId?: string
  action?: string
  from?: Date
  to?: Date
}) {
  const conditions = buildAuditFilters(filters)

  const result = await getDb()
    .select({ total: count() })
    .from(auditLogs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)

  return result[0]?.total ?? 0
}
