import type { ProviderCallStats } from '@excuse/metrics'
import type { AdminProviderHealthListResponse, AdminProviderHealthRestoreResponse, AdminProviderStatsItem, AdminProviderStatsResponse } from '@excuse/shared'
import type { ServerConfig } from '../../config'
import { getAdminProviderStats, getProviderModelHealthMap, listProviderModelHealth, restoreProviderModelHealth } from '@excuse/db'
import { mergeProviderCalls } from '@excuse/metrics'
import { audit } from '../../services/audit'
import { getProviderCallsSnapshot } from '../../services/metrics'
import { fetchWorkerProviderCalls } from '../../services/worker-metrics'
import { NotFoundError } from '../../utils/app-errors'
import { computeLatency, toHealthSummary } from './helpers'

export async function handleGetProviderStats(
  config: ServerConfig,
  query: { windowHours?: number },
): Promise<AdminProviderStatsResponse> {
  const requested = Number(query.windowHours ?? 24)
  const windowHours = Math.min(Math.max(Number.isFinite(requested) ? Math.trunc(requested) : 24, 1), 24 * 30)
  const [dbRows, serverCalls, workerCalls, healthMap] = await Promise.all([
    getAdminProviderStats(windowHours),
    Promise.resolve(getProviderCallsSnapshot()),
    fetchWorkerProviderCalls(config.workerMetricsUrl, config.metricsAccessToken),
    getProviderModelHealthMap(),
  ])
  const providerCalls = mergeProviderCalls(serverCalls, workerCalls)
  const now = Date.now()
  const items: AdminProviderStatsItem[] = dbRows.map((row) => {
    const stats: ProviderCallStats | undefined = providerCalls[row.model]
    const latency = computeLatency(stats)
    const failureRate = row.totalCalls > 0 ? row.failedCalls / row.totalCalls : 0
    const healthRecord = healthMap.get(row.model) ?? null
    return {
      model: row.model,
      category: row.category,
      totalCalls: row.totalCalls,
      succeededCalls: row.succeededCalls,
      failedCalls: row.failedCalls,
      failureRate,
      avgLatencyMs: latency.avg,
      p50LatencyMs: latency.p50,
      p95LatencyMs: latency.p95,
      totalCostCents: row.totalCostCents,
      totalInputTokens: row.totalInputTokens,
      totalOutputTokens: row.totalOutputTokens,
      health: healthRecord ? toHealthSummary(healthRecord, now) : null,
    }
  })
  return { success: true, windowHours, items }
}

export async function handleListProviderHealth(): Promise<AdminProviderHealthListResponse> {
  const records = await listProviderModelHealth()
  return { success: true, items: records.map(r => toHealthSummary(r)) }
}

export async function handleRestoreProviderHealth(model: string, userId: string): Promise<AdminProviderHealthRestoreResponse> {
  const restored = await restoreProviderModelHealth(model)
  if (!restored)
    throw new NotFoundError(`模型 ${model} 无健康记录（从未失败过）`)
  await audit('admin_action', {
    accountId: userId,
    targetId: model,
    detail: { model, action: 'restore', source: 'manual', previousStatus: 'degraded' },
  })
  return { success: true, health: toHealthSummary(restored) }
}
