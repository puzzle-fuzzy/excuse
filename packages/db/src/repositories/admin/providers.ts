import { desc, sql } from 'drizzle-orm'
import { getDb } from '../../db'
import { generationRecords } from '../../schema'
import { numberValue } from './internal'

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
