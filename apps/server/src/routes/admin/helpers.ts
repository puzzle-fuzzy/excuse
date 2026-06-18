import type { ProviderModelHealth } from '@excuse/db'
import type { ProviderCallStats } from '@excuse/metrics'
import type { AdminProviderHealthSummary } from '@excuse/shared'
import { serialize } from '@excuse/db'
import { degradedRemainingMs, isDegraded } from '@excuse/provider-health'

export function nearestRankPercentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0)
    return 0
  const idx = Math.max(0, Math.ceil(p * sortedAsc.length) - 1)
  return sortedAsc[idx] ?? 0
}

export function computeLatency(stats: ProviderCallStats | undefined): { avg: number | null, p50: number | null, p95: number | null } {
  if (!stats || stats.durations.length === 0)
    return { avg: null, p50: null, p95: null }
  const sorted = [...stats.durations].sort((a, b) => a - b)
  const sum = sorted.reduce((acc, value) => acc + value, 0)
  return {
    avg: sum / sorted.length,
    p50: nearestRankPercentile(sorted, 0.5),
    p95: nearestRankPercentile(sorted, 0.95),
  }
}

export function serializeApiKey(key: {
  id: string
  prefix: string
  name: string | null
  scope: string
  rateLimitPerMinute: number | null
  quotaMaxCents: number | null
  totalSpendCents: number | null
  quotaResetAt: Date | null
  lastUsedAt: Date | null
  createdAt: Date
  revokedAt: Date | null
}) {
  return {
    ...serialize(key),
    totalSpendCents: key.totalSpendCents ?? 0,
  }
}

export function toHealthSummary(record: ProviderModelHealth, now = Date.now()): AdminProviderHealthSummary {
  const blocking = isDegraded(record, now)
  const remaining = degradedRemainingMs(record, now)
  return {
    model: record.model,
    status: record.status,
    blocking,
    consecutiveFailures: record.consecutiveFailures,
    totalFailures: record.totalFailures,
    totalSuccesses: record.totalSuccesses,
    remainingSeconds: blocking ? Math.ceil(remaining / 1000) : null,
    degradedUntil: record.degradedUntil !== null ? new Date(record.degradedUntil).toISOString() : null,
    lastFailureAt: record.lastFailureAt !== null ? new Date(record.lastFailureAt).toISOString() : null,
    lastSuccessAt: record.lastSuccessAt !== null ? new Date(record.lastSuccessAt).toISOString() : null,
    lastErrorMessage: record.lastErrorMessage,
    degradedReason: record.degradedReason,
    updatedAt: new Date(record.updatedAt).toISOString(),
  }
}
