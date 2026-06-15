import type { GenerationStatus } from '../src/types'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { cancelAdminTask } from '../src/repositories/admin.repo'
import { createGenerationRecord, getGenerationRecordById } from '../src/repositories/generation-records.repo'
import { createTask } from '../src/repositories/tasks.repo'
import {
  beginTestTransaction,
  initTestDb,
  rollbackTestTransaction,
  teardownTestDb,
} from './helpers/test-db'

describe('cancelAdminTask — 跨业务级联取消 generation_record', () => {
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

  it('取消 queued 任务时级联取消关联的非终态 generation_record', async () => {
    const record = await createGenerationRecord({
      accountId,
      model: 'ffmpeg-burn',
      category: 'subtitle' as const,
      status: 'processing',
      inputParams: { prompt: 'burn export' },
    })
    const task = await createTask({
      accountId,
      type: 'media.burn-subtitle',
      domain: 'subtitle',
      status: 'queued',
      generationRecordId: record.id,
    })

    const result = await cancelAdminTask(task.id)
    expect(result?.status).toBe('cancelled')

    const after = await getGenerationRecordById(record.id)
    expect(after?.status).toBe('cancelled')
    expect(after?.errorMessage).toBe('管理员取消任务')
  })

  it('关联 generation_record 已 succeeded 时取消任务不覆盖（级联跳过成功产物）', async () => {
    const record = await createGenerationRecord({
      accountId,
      model: 'ffmpeg-burn',
      category: 'subtitle' as const,
      status: 'succeeded' as GenerationStatus,
      inputParams: { prompt: 'burn export' },
      totalPriceCents: 100,
    })
    const task = await createTask({
      accountId,
      type: 'media.burn-subtitle',
      domain: 'subtitle',
      status: 'running',
      generationRecordId: record.id,
    })

    const result = await cancelAdminTask(task.id)
    expect(result?.status).toBe('cancelled')

    // worker 已完成烧录标记 succeeded，取消任务不应覆盖为 cancelled
    const after = await getGenerationRecordById(record.id)
    expect(after?.status).toBe('succeeded')
  })

  it('无 generationRecordId 的任务取消不触发级联（不报错）', async () => {
    const task = await createTask({
      accountId,
      type: 'canvas.videos',
      domain: 'canvas',
      status: 'queued',
    })
    const result = await cancelAdminTask(task.id)
    expect(result?.status).toBe('cancelled')
  })

  it('已终态任务取消返回 null（无副作用）', async () => {
    const task = await createTask({
      accountId,
      type: 'media.burn-subtitle',
      domain: 'subtitle',
      status: 'succeeded',
      generationRecordId: '00000000-0000-0000-0000-000000000000',
    })
    const result = await cancelAdminTask(task.id)
    expect(result).toBeNull()
  })
})
