import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { sql } from 'drizzle-orm'
import { getDb } from '../src/db'
import {
  getProviderModelHealth,
  listProviderModelHealth,
  recordProviderOutcome,
  restoreProviderModelHealth,
} from '../src/repositories/provider-model-health.repo'
import { teardownTestDb, useMigratedTestDb } from './helpers/test-db'

const CONFIG = { failureThreshold: 3, cooldownMs: 60_000 }

/** 用随机后缀避免跨测试 / 跨运行互相干扰（provider_model_health 以 model 为主键）。 */
function uniqueModel(): string {
  return `test-model-${crypto.randomUUID().slice(0, 8)}`
}

describe('provider-model-health repository', () => {
  beforeAll(async () => {
    await useMigratedTestDb()
  })

  afterAll(async () => {
    await teardownTestDb()
  })

  // 每个测试后清理本测试写入的行（repo 使用 drizzle transaction，无法靠 ROLLBACK 隔离）
  afterEach(async () => {
    await getDb().execute(sql`DELETE FROM provider_model_health WHERE model LIKE 'test-model-%'`)
  })

  beforeEach(() => {
    // 占位保持结构一致；隔离靠唯一 model 名 + afterEach DELETE
  })

  // ─── recordProviderOutcome ─────────────────────────────

  describe('recordProviderOutcome', () => {
    it('首次失败写入 healthy 态、累计失败计数', async () => {
      const model = uniqueModel()
      const res = await recordProviderOutcome(model, false, 'boom', CONFIG)
      expect(res).not.toBeNull()
      expect(res!.record.status).toBe('healthy')
      expect(res!.record.consecutiveFailures).toBe(1)
      expect(res!.record.totalFailures).toBe(1)
      expect(res!.record.lastErrorMessage).toBe('boom')
      expect(res!.transitionedTo).toBeUndefined()
    })

    it('达到阈值跳变到 degraded，落库 status + degradedUntil', async () => {
      const model = uniqueModel()
      await recordProviderOutcome(model, false, undefined, CONFIG)
      await recordProviderOutcome(model, false, undefined, CONFIG)
      const before = Date.now()
      const res = await recordProviderOutcome(model, false, undefined, CONFIG)
      expect(res!.record.status).toBe('degraded')
      expect(res!.record.consecutiveFailures).toBe(3)
      expect(res!.transitionedTo).toBe('degraded')
      expect(res!.record.degradedUntil).not.toBeNull()
      expect(res!.record.degradedUntil!).toBeGreaterThan(before)
    })

    it('成功清零计数并恢复为 healthy', async () => {
      const model = uniqueModel()
      for (let i = 0; i < 3; i++)
        await recordProviderOutcome(model, false, undefined, CONFIG)
      const res = await recordProviderOutcome(model, true, undefined, CONFIG)
      expect(res!.record.status).toBe('healthy')
      expect(res!.record.consecutiveFailures).toBe(0)
      expect(res!.record.totalSuccesses).toBe(1)
      expect(res!.transitionedTo).toBe('healthy')
    })

    it('持久化可读回（getProviderModelHealth）', async () => {
      const model = uniqueModel()
      await recordProviderOutcome(model, false, 'err', CONFIG)
      const read = await getProviderModelHealth(model)
      expect(read).not.toBeNull()
      expect(read!.model).toBe(model)
      expect(read!.consecutiveFailures).toBe(1)
      expect(read!.lastErrorMessage).toBe('err')
    })
  })

  // ─── restoreProviderModelHealth ────────────────────────

  describe('restoreProviderModelHealth', () => {
    it('强制恢复降级模型为 healthy', async () => {
      const model = uniqueModel()
      for (let i = 0; i < 3; i++)
        await recordProviderOutcome(model, false, undefined, CONFIG)
      expect((await getProviderModelHealth(model))!.status).toBe('degraded')

      const restored = await restoreProviderModelHealth(model)
      expect(restored).not.toBeNull()
      expect(restored!.status).toBe('healthy')
      expect(restored!.consecutiveFailures).toBe(0)
      expect(restored!.degradedUntil).toBeNull()
    })

    it('从未出现过的 model 返回 null', async () => {
      const restored = await restoreProviderModelHealth('test-model-nope')
      expect(restored).toBeNull()
    })
  })

  // ─── listProviderModelHealth ───────────────────────────

  describe('listProviderModelHealth', () => {
    it('列出已写入的记录', async () => {
      const model = uniqueModel()
      await recordProviderOutcome(model, false, undefined, CONFIG)
      const list = await listProviderModelHealth()
      const found = list.find(r => r.model === model)
      expect(found).toBeDefined()
      expect(found!.consecutiveFailures).toBe(1)
    })
  })
})
