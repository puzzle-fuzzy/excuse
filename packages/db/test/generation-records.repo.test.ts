import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import {
  createGenerationRecord,
  getCostRecords,
  getGenerationRecordById,
  listGenerationRecords,
  markGenerationFailed,
  markGenerationProcessing,
  markGenerationSucceeded,
  pollPendingVideoTasks,
  releaseVideoTaskClaims,
} from '../src/repositories/generation-records.repo'
import {
  beginTestTransaction,
  expectDbConstraintError,
  initTestDb,
  rollbackTestTransaction,
  teardownTestDb,
} from './helpers/test-db'

describe('generation-records repository', () => {
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

  // ─── 辅助：构造合法插入数据 ────────────────────────────

  function validInsert(overrides: Record<string, unknown> = {}) {
    return {
      accountId,
      model: 'qwen-vl',
      category: 'text' as const,
      status: 'pending' as const,
      inputParams: { prompt: 'test prompt' },
      ...overrides,
    }
  }

  // ─── createGenerationRecord ───────────────────────────

  describe('createGenerationRecord', () => {
    it('插入并返回包含所有字段的记录', async () => {
      const result = await createGenerationRecord(validInsert({
        taskId: 'task-001',
      }))

      expect(result.id).toBeDefined()
      expect(result.accountId).toBe(accountId)
      expect(result.model).toBe('qwen-vl')
      expect(result.category).toBe('text')
      expect(result.status).toBe('pending')
      expect(result.inputParams).toEqual({ prompt: 'test prompt' })
      expect(result.createdAt).toBeInstanceOf(Date)
    })
  })

  // ─── getGenerationRecordById ───────────────────────────

  describe('getGenerationRecordById', () => {
    it('找到时返回记录', async () => {
      const created = await createGenerationRecord(validInsert())
      const found = await getGenerationRecordById(created.id)

      expect(found).not.toBeNull()
      expect(found!.id).toBe(created.id)
      expect(found!.model).toBe('qwen-vl')
    })

    it('不存在的 ID 返回 null', async () => {
      const result = await getGenerationRecordById('00000000-0000-0000-0000-000000000000')
      expect(result).toBeNull()
    })
  })

  // ─── listGenerationRecords ─────────────────────────────

  describe('listGenerationRecords', () => {
    it('按 createdAt 降序返回记录', async () => {
      await createGenerationRecord(validInsert({ category: 'image' }))
      await createGenerationRecord(validInsert({ category: 'text' }))

      const results = await listGenerationRecords()
      expect(results.length).toBeGreaterThanOrEqual(2)
      // 最新的排在前面
      expect(results[0].createdAt.getTime()).toBeGreaterThanOrEqual(
        results[1].createdAt.getTime(),
      )
    })

    it('按 category 过滤', async () => {
      await createGenerationRecord(validInsert({ category: 'image' }))
      await createGenerationRecord(validInsert({ category: 'text' }))

      const images = await listGenerationRecords({ category: 'image' })
      expect(images.length).toBeGreaterThanOrEqual(1)
      expect(images.every(r => r.category === 'image')).toBe(true)
    })

    it('按 status 过滤', async () => {
      await createGenerationRecord(validInsert({ status: 'pending' }))

      const pending = await listGenerationRecords({ status: 'pending' })
      expect(pending.length).toBeGreaterThanOrEqual(1)
      expect(pending.every(r => r.status === 'pending')).toBe(true)
    })

    it('遵守 limit 和 offset', async () => {
      // 创建 3 条记录
      for (let i = 0; i < 3; i++) {
        await createGenerationRecord(validInsert())
      }

      const page1 = await listGenerationRecords({ limit: 2, offset: 0 })
      const page2 = await listGenerationRecords({ limit: 2, offset: 2 })

      expect(page1).toHaveLength(2)
      expect(page2).toHaveLength(1)
    })

    it('无匹配记录时返回空数组', async () => {
      // 'video' 是合法 category enum，但此测试只插入 text/image 记录
      const results = await listGenerationRecords({ category: 'video' })
      expect(results).toHaveLength(0)
    })
  })

  // ─── markGenerationFailed ──────────────────────────────

  describe('markGenerationFailed', () => {
    it('更新状态为 failed 并设置错误信息', async () => {
      const record = await createGenerationRecord(validInsert())
      await markGenerationFailed(record.id, 'Out of credits')

      const updated = await getGenerationRecordById(record.id)
      expect(updated!.status).toBe('failed')
      expect(updated!.errorMessage).toBe('Out of credits')
    })
  })

  // ─── markGenerationProcessing ──────────────────────────

  describe('markGenerationProcessing', () => {
    it('更新状态为 processing', async () => {
      const record = await createGenerationRecord(validInsert())
      await markGenerationProcessing(record.id)

      const updated = await getGenerationRecordById(record.id)
      expect(updated!.status).toBe('processing')
    })

    it('提供时设置 taskId 和 outputResult', async () => {
      const record = await createGenerationRecord(validInsert())
      await markGenerationProcessing(record.id, {
        taskId: 'provider-123',
        outputResult: { url: 'test.mp4' },
      })

      const updated = await getGenerationRecordById(record.id)
      expect(updated!.status).toBe('processing')
      expect(updated!.taskId).toBe('provider-123')
      expect(updated!.outputResult).toEqual({ url: 'test.mp4' })
    })
  })

  // ─── markGenerationSucceeded ───────────────────────────

  describe('markGenerationSucceeded', () => {
    it('更新状态并设置 output 和 cost', async () => {
      const record = await createGenerationRecord(validInsert())
      await markGenerationSucceeded(record.id, { url: 'result.png' }, { totalPrice: 0.01 })

      const updated = await getGenerationRecordById(record.id)
      expect(updated!.status).toBe('succeeded')
      expect(updated!.outputResult).toEqual({ url: 'result.png' })
      expect(updated!.cost!.totalPrice).toBe(0.01)
    })

    it('无 cost 时也能成功', async () => {
      const record = await createGenerationRecord(validInsert())
      await markGenerationSucceeded(record.id, { text: 'hello' })

      const updated = await getGenerationRecordById(record.id)
      expect(updated!.status).toBe('succeeded')
      expect(updated!.cost).toBeNull()
    })
  })

  // ─── pollPendingVideoTasks ─────────────────────────────

  describe('pollPendingVideoTasks', () => {
    it('claim 视频任务并跳过已锁行，释放后可再次 claim', async () => {
      await createGenerationRecord(validInsert({ category: 'video', status: 'pending' }))
      await createGenerationRecord(validInsert({ category: 'video', status: 'processing' }))
      // 非视频任务，不应返回
      await createGenerationRecord(validInsert({ category: 'text', status: 'pending' }))

      const tasks = await pollPendingVideoTasks('worker-a', 30_000)
      expect(tasks).toHaveLength(2)
      expect(tasks.every(t => t.category === 'video')).toBe(true)
      expect(tasks.every(t => ['pending', 'processing'].includes(t.status))).toBe(true)

      const secondClaim = await pollPendingVideoTasks('worker-b', 30_000)
      expect(secondClaim).toHaveLength(0)

      await releaseVideoTaskClaims(tasks.map(task => task.id), 'worker-a')
      const afterRelease = await pollPendingVideoTasks('worker-b', 30_000)
      expect(afterRelease).toHaveLength(2)
    })

    it('无视频任务时返回空数组', async () => {
      await createGenerationRecord(validInsert({ category: 'text' }))

      const tasks = await pollPendingVideoTasks()
      expect(tasks).toHaveLength(0)
    })
  })

  // ─── getCostRecords ────────────────────────────────────

  describe('getCostRecords', () => {
    it('仅返回 cost 中含数字 totalPrice 的记录', async () => {
      const r1 = await createGenerationRecord(validInsert())
      await markGenerationSucceeded(r1.id, { url: 'a.png' }, { totalPrice: 0.01 })

      const r2 = await createGenerationRecord(validInsert())
      await markGenerationSucceeded(r2.id, { url: 'b.png' }, { totalPrice: 0.05 })

      // 成功但无 cost
      const r3 = await createGenerationRecord(validInsert())
      await markGenerationSucceeded(r3.id, { url: 'c.png' })

      const costs = await getCostRecords(accountId)
      const testCosts = costs.filter(c => c.model === 'qwen-vl')
      expect(testCosts.length).toBeGreaterThanOrEqual(2)
      testCosts.forEach((c) => {
        expect(typeof c.cost!.totalPrice).toBe('number')
      })
    })

    it('无费用记录时返回空', async () => {
      await createGenerationRecord(validInsert({ status: 'pending' }))

      const costs = await getCostRecords(accountId)
      const testCosts = costs.filter(c => c.model === 'qwen-vl')
      expect(testCosts).toHaveLength(0)
    })
  })

  // ─── 约束验证 ─────────────────────────────────────────

  describe('constraints', () => {
    it('重复 taskId 时拒绝（唯一约束）', async () => {
      await createGenerationRecord(validInsert({ taskId: 'unique-task-001' }))

      const error = await expectDbConstraintError(() =>
        createGenerationRecord(validInsert({ taskId: 'unique-task-001' })),
      )
      expect(error).toBeInstanceOf(Error)
    })

    it('无效 accountId 时拒绝（FK 约束）', async () => {
      const error = await expectDbConstraintError(() =>
        createGenerationRecord(validInsert({ accountId: '00000000-0000-0000-0000-000000000000' })),
      )
      expect(error).toBeInstanceOf(Error)
    })
  })
})
