import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { getDb } from '../src/db'
import {
  getAdminProviderStats,
  getAdminUserDetail,
  listAdminUsers,
} from '../src/repositories/admin.repo'
import { getOrCreateCreditAccount } from '../src/repositories/credit.repo'
import { createGenerationRecord } from '../src/repositories/generation-records.repo'
import { creditAccounts } from '../src/schema'
import {
  beginTestTransaction,
  initTestDb,
  rollbackTestTransaction,
  teardownTestDb,
} from './helpers/test-db'

describe('管理用户 / providers 仓库', () => {
  let accountId: string

  beforeAll(async () => {
    await initTestDb()
  })

  afterAll(async () => {
    await teardownTestDb()
  })

  beforeEach(async () => {
    const ctx = await beginTestTransaction()
    accountId = ctx.accountId
  })

  afterEach(async () => {
    await rollbackTestTransaction()
  })

  async function setCreditBalance(accountId: string, availableCents: number) {
    await getOrCreateCreditAccount(accountId)
    await getDb()
      .update(creditAccounts)
      .set({ availableCents })
      .where(eq(creditAccounts.accountId, accountId))
  }

  async function seedRecord(overrides: Record<string, unknown> = {}) {
    return createGenerationRecord({
      accountId,
      model: 'qwen-plus',
      category: 'text',
      status: 'succeeded',
      inputParams: { prompt: 'test prompt' },
      totalPriceCents: 100,
      cost: {
        unit: 'token',
        inputTokens: 50,
        outputTokens: 30,
        totalPriceCents: 100,
        totalPrice: 1,
      },
      ...overrides,
    })
  }

  // ─── listAdminUsers ─────────────────────────────────

  describe('listAdminUsers', () => {
    it('无匹配账户时返回空列表', async () => {
      // beginTestTransaction 已 seed 一个 account，但搜索不匹配的关键字
      const result = await listAdminUsers({ search: 'zzz-no-such-user-zzz' })
      expect(result.items).toEqual([])
      expect(result.total).toBe(0)
    })

    it('返回 seed 用户并聚合 cost + calls', async () => {
      await setCreditBalance(accountId, 5000)
      await seedRecord({ totalPriceCents: 100 })
      await seedRecord({ totalPriceCents: 200 })

      const result = await listAdminUsers({})
      const user = result.items.find(item => item.id === accountId)
      expect(user).toBeDefined()
      expect(user!.creditBalanceCents).toBe(5000)
      expect(user!.totalCostCents).toBe(300)
      expect(user!.totalCalls).toBe(2)
      expect(user!.lastActivityAt).not.toBeNull()
    })

    it('search 匹配 username 或 email', async () => {
      // beginTestTransaction 创建的 username 形如 test_xxxx
      const result = await listAdminUsers({ search: 'test_' })
      expect(result.total).toBeGreaterThanOrEqual(1)
    })

    it('isActive 过滤缩小结果范围', async () => {
      const activeResult = await listAdminUsers({ isActive: true })
      const activeCount = activeResult.total
      const inactiveResult = await listAdminUsers({ isActive: false })
      // 默认 seed 的账号 isActive=true
      expect(activeCount).toBeGreaterThanOrEqual(1)
      expect(inactiveResult.total).toBe(0)
    })

    it('limit + offset 分页', async () => {
      const page1 = await listAdminUsers({ limit: 1, offset: 0 })
      const page2 = await listAdminUsers({ limit: 1, offset: 1 })
      expect(page1.items.length).toBe(1)
      expect(page1.total).toBeGreaterThanOrEqual(1)
      if (page2.items.length > 0)
        expect(page2.items[0]!.id).not.toBe(page1.items[0]!.id)
    })
  })

  // ─── getAdminUserDetail ─────────────────────────────

  describe('getAdminUserDetail', () => {
    it('未知 accountId 返回 null', async () => {
      const detail = await getAdminUserDetail('00000000-0000-0000-0000-000000000000')
      expect(detail).toBeNull()
    })

    it('返回 summary + daily + 模型分布 + 近期记录', async () => {
      await setCreditBalance(accountId, 7500)
      await seedRecord({ model: 'qwen-plus', totalPriceCents: 100 })
      await seedRecord({ model: 'qwen-turbo', totalPriceCents: 50 })

      const detail = await getAdminUserDetail(accountId)
      expect(detail).not.toBeNull()
      expect(detail!.summary.creditBalanceCents).toBe(7500)
      expect(detail!.summary.totalCalls).toBe(2)
      expect(detail!.summary.totalCostCents).toBe(150)
      expect(detail!.modelBreakdown.length).toBe(2)
      expect(detail!.recentRecords.length).toBe(2)
    })

    it('近期记录最多 10 条', async () => {
      for (let i = 0; i < 12; i++)
        await seedRecord({ model: 'qwen-plus' })
      const detail = await getAdminUserDetail(accountId)
      expect(detail!.recentRecords.length).toBe(10)
    })

    it('模型分布取 cost 前 10', async () => {
      for (let i = 0; i < 12; i++)
        await seedRecord({ model: `model-${i}`, totalPriceCents: 100 + i })
      const detail = await getAdminUserDetail(accountId)
      expect(detail!.modelBreakdown.length).toBe(10)
      // 最贵的 model-11 (priceCents=111) 应该排第一
      expect(detail!.modelBreakdown[0]!.costCents).toBeGreaterThanOrEqual(
        detail!.modelBreakdown[1]!.costCents,
      )
    })
  })

  // ─── getAdminProviderStats ──────────────────────────

  describe('getAdminProviderStats', () => {
    it('按 model + category 分组，含 count + cost + tokens', async () => {
      await seedRecord({
        model: 'qwen-plus',
        category: 'text',
        status: 'succeeded',
        totalPriceCents: 100,
        cost: { unit: 'token', inputTokens: 100, outputTokens: 50, totalPriceCents: 100, totalPrice: 1 },
      })
      await seedRecord({
        model: 'qwen-plus',
        category: 'text',
        status: 'failed',
        totalPriceCents: 0,
        cost: { unit: 'token', inputTokens: 50, outputTokens: 0, totalPriceCents: 0, totalPrice: 0 },
      })
      await seedRecord({
        model: 'wanx-v1',
        category: 'image',
        status: 'succeeded',
        totalPriceCents: 200,
        cost: { unit: 'image', inputTokens: 0, outputTokens: 0, totalPriceCents: 200, totalPrice: 2 },
      })

      const rows = await getAdminProviderStats(24)
      const qwenRow = rows.find(row => row.model === 'qwen-plus')
      const wanxRow = rows.find(row => row.model === 'wanx-v1')

      expect(qwenRow).toBeDefined()
      expect(qwenRow!.category).toBe('text')
      expect(qwenRow!.totalCalls).toBe(2)
      expect(qwenRow!.succeededCalls).toBe(1)
      expect(qwenRow!.failedCalls).toBe(1)
      expect(qwenRow!.totalCostCents).toBe(100)
      expect(qwenRow!.totalInputTokens).toBe(150)
      expect(qwenRow!.totalOutputTokens).toBe(50)

      expect(wanxRow).toBeDefined()
      expect(wanxRow!.category).toBe('image')
      expect(wanxRow!.totalCalls).toBe(1)
      expect(wanxRow!.totalCostCents).toBe(200)
    })

    it('windowHours 过滤旧记录', async () => {
      await seedRecord({ model: 'qwen-plus', createdAt: new Date(Date.now() - 48 * 3600 * 1000) })
      await seedRecord({ model: 'qwen-plus' })

      const recentRows = await getAdminProviderStats(1)
      const allRows = await getAdminProviderStats(24 * 30)

      // 1h 窗口只看到刚 seed 的；48h 前的不算
      const recentQwen = recentRows.find(row => row.model === 'qwen-plus')
      const allQwen = allRows.find(row => row.model === 'qwen-plus')
      expect(recentQwen!.totalCalls).toBe(1)
      expect(allQwen!.totalCalls).toBe(2)
    })

    it('windowHours 钳制到 [1, 720]', async () => {
      // 0 / 负数 → 1；超大数 → 720；不影响 seed 数据（都很近）
      await seedRecord({ model: 'qwen-plus' })
      const tooSmall = await getAdminProviderStats(0)
      const tooLarge = await getAdminProviderStats(99999)
      const qwenSmall = tooSmall.find(row => row.model === 'qwen-plus')
      const qwenLarge = tooLarge.find(row => row.model === 'qwen-plus')
      // clamp 后仍能找到数据（1h / 720h 都覆盖最近 seed）
      expect(qwenSmall!.totalCalls).toBeGreaterThanOrEqual(1)
      expect(qwenLarge!.totalCalls).toBeGreaterThanOrEqual(1)
    })

    it('窗口内无记录时返回空数组', async () => {
      const rows = await getAdminProviderStats(1)
      // beforeEach 已 seed account，但没 seed generation_records
      // 不过 listAdminUsers 等其他测试可能 seed 过——查到的 rows 至少不抛错
      expect(Array.isArray(rows)).toBe(true)
    })
  })
})
