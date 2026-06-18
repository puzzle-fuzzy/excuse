import type { AdminAuditLogItem, AdminAuditLogListResponse } from '@excuse/shared'
import { countAuditLogs, queryAuditLogs } from '@excuse/db'

export async function handleListAuditLogs(query: {
  accountId?: string
  action?: string
  from?: string
  to?: string
  limit?: number
  offset?: number
}): Promise<AdminAuditLogListResponse> {
  const from = query.from ? new Date(query.from) : undefined
  const to = query.to ? new Date(query.to) : undefined
  const [rows, total] = await Promise.all([
    queryAuditLogs({ accountId: query.accountId, action: query.action, from, to, limit: query.limit, offset: query.offset }),
    countAuditLogs({ accountId: query.accountId, action: query.action, from, to }),
  ])
  const items: AdminAuditLogItem[] = rows.map((row: typeof rows[number]) => ({
    id: row.id,
    accountId: row.accountId,
    action: row.action,
    targetId: row.targetId,
    detail: row.detail as Record<string, unknown> | null,
    ip: row.ip,
    createdAt: row.createdAt.toISOString(),
  }))
  return { success: true, items, total }
}
