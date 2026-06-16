import type { DegradationConfig } from '@excuse/provider-health'
import type { ProviderModelHealth } from '@excuse/shared'
import { applyProviderOutcome, DEFAULT_DEGRADATION_CONFIG } from '@excuse/provider-health'
import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { providerModelHealth } from '../schema/provider-model-health'

/** DB 行类型（drizzle InferSelectModel） */
type ProviderModelHealthRow = typeof providerModelHealth.$inferSelect

/** DB timestamptz 行 ↔ domain epoch-ms 映射 */
function rowToHealth(row: ProviderModelHealthRow): ProviderModelHealth {
  return {
    model: row.model,
    status: row.status,
    consecutiveFailures: row.consecutiveFailures,
    totalFailures: row.totalFailures,
    totalSuccesses: row.totalSuccesses,
    degradedUntil: row.degradedUntil ? row.degradedUntil.getTime() : null,
    lastFailureAt: row.lastFailureAt ? row.lastFailureAt.getTime() : null,
    lastSuccessAt: row.lastSuccessAt ? row.lastSuccessAt.getTime() : null,
    lastErrorMessage: row.lastErrorMessage,
    degradedReason: row.degradedReason,
    updatedAt: row.updatedAt.getTime(),
  }
}

/**
 * 记录一次 provider 调用结果，原子更新模型健康状态。
 *
 * 使用事务 + SELECT FOR UPDATE 串行化同一 model 的并发更新（server + worker
 * 都会调用），保证连续失败计数正确递增。状态跳变由纯函数 `applyProviderOutcome`
 * 决定，DB 层只负责持久化与并发控制。
 *
 * 任何异常向上抛出由调用方（observer）兜底，不得影响主调用流程。
 */
export async function recordProviderOutcome(
  model: string,
  success: boolean,
  errorMessage?: string,
  config: DegradationConfig = DEFAULT_DEGRADATION_CONFIG,
): Promise<{ record: ProviderModelHealth, transitionedTo?: 'healthy' | 'degraded' } | null> {
  const ts = Date.now()

  return await getDb().transaction(async (tx) => {
    // 先确保行存在（race-safe：并发首写时 ON CONFLICT DO NOTHING 让一方胜出）
    await tx.insert(providerModelHealth)
      .values({ model })
      .onConflictDoNothing({ target: providerModelHealth.model })

    // 行级锁 + 读取当前状态
    const locked = await tx.select()
      .from(providerModelHealth)
      .where(eq(providerModelHealth.model, model))
      .for('update')
    const row = locked[0]
    if (!row)
      return null

    const state = rowToHealth(row)
    const { record, transitionedTo } = applyProviderOutcome(
      state,
      { model, success, errorMessage, ts },
      config,
    )

    await tx.update(providerModelHealth)
      .set({
        status: record.status,
        consecutiveFailures: record.consecutiveFailures,
        totalFailures: record.totalFailures,
        totalSuccesses: record.totalSuccesses,
        degradedUntil: record.degradedUntil !== null ? new Date(record.degradedUntil) : null,
        lastFailureAt: record.lastFailureAt !== null ? new Date(record.lastFailureAt) : null,
        lastSuccessAt: record.lastSuccessAt !== null ? new Date(record.lastSuccessAt) : null,
        lastErrorMessage: record.lastErrorMessage,
        degradedReason: record.degradedReason,
        updatedAt: new Date(record.updatedAt),
      })
      .where(eq(providerModelHealth.model, model))

    return { record, transitionedTo }
  })
}

/** 读取单个模型的当前健康状态（无锁）。 */
export async function getProviderModelHealth(model: string): Promise<ProviderModelHealth | null> {
  const rows = await getDb().select().from(providerModelHealth).where(eq(providerModelHealth.model, model))
  const row = rows[0]
  return row ? rowToHealth(row) : null
}

/** 列出全部模型健康记录，按 updatedAt 倒序（admin 后台用）。 */
export async function listProviderModelHealth(): Promise<ProviderModelHealth[]> {
  const rows = await getDb().select().from(providerModelHealth).orderBy(providerModelHealth.updatedAt)
  return rows.map(rowToHealth)
}

/** 以 model 为键的健康快照映射（admin /providers 按模型名 join 用）。 */
export async function getProviderModelHealthMap(): Promise<Map<string, ProviderModelHealth>> {
  const list = await listProviderModelHealth()
  return new Map(list.map(h => [h.model, h]))
}

/**
 * 管理员手动恢复模型为健康态。
 *
 * 清零 consecutiveFailures、置 status=healthy、清 degradedUntil/degradedReason。
 * 用于运营在确认模型恢复后强制解除降级（不等待冷却窗口自然过期）。
 *
 * @returns 恢复后的记录；null 表示该 model 从未出现过（无行可恢复）
 */
export async function restoreProviderModelHealth(model: string): Promise<ProviderModelHealth | null> {
  const rows = await getDb().update(providerModelHealth).set({
    status: 'healthy',
    consecutiveFailures: 0,
    degradedUntil: null,
    degradedReason: null,
    updatedAt: new Date(),
  }).where(eq(providerModelHealth.model, model)).returning()
  const row = rows[0]
  return row ? rowToHealth(row) : null
}
