import type { WorkerAuditEntry } from '../src/services/audit'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { audit, resetWorkerAuditWriter, setWorkerAuditWriter } from '../src/services/audit'

mock.module('@excuse/db', () => ({
  createAuditLog: mock(() => Promise.resolve()),
}))

mock.module('@excuse/shared', () => ({
  createLogger: () => ({
    error: mock(() => {}),
    warn: mock(() => {}),
    info: mock(() => {}),
    debug: mock(() => {}),
  }),
}))

afterEach(() => {
  resetWorkerAuditWriter()
})

describe('worker 审计辅助', () => {
  it('setWorkerAuditWriter 注入后 audit 调用 customWriter', async () => {
    const writer = mock<(entry: WorkerAuditEntry) => Promise<void>>(() => Promise.resolve())
    setWorkerAuditWriter(writer)

    await audit('credit_debit', {
      accountId: 'acc-1',
      targetId: 'rec-1',
      detail: {
        accountId: 'acc-1',
        generationRecordId: 'rec-1',
        amountCents: 100,
        description: 'test',
        source: 'worker_video',
      },
    })

    expect(writer).toHaveBeenCalledTimes(1)
    expect(writer.mock.calls[0][0]).toMatchObject({
      action: 'credit_debit',
      accountId: 'acc-1',
      targetId: 'rec-1',
    })
    expect(writer.mock.calls[0][0].detail).toMatchObject({
      source: 'worker_video',
      amountCents: 100,
    })
  })

  it('默认 NODE_ENV=test 时 auditEnabled=false，audit 不调 writer', async () => {
    const writer = mock<(entry: WorkerAuditEntry) => Promise<void>>(() => Promise.resolve())
    // 注意：**不**调 setWorkerAuditWriter，保持默认 disabled 状态
    // 直接覆盖底层 writer 引用不可行（模块级私有），所以改用 setWriter + reset 模拟两种状态
    setWorkerAuditWriter(writer)
    resetWorkerAuditWriter() // 恢复默认：env=test → disabled

    await audit('credit_debit', { accountId: 'acc-1' })

    expect(writer).not.toHaveBeenCalled()
  })

  it('setWorkerAuditWriter 后再 reset 恢复默认 writer', async () => {
    const customWriter = mock<(entry: WorkerAuditEntry) => Promise<void>>(() => Promise.resolve())
    setWorkerAuditWriter(customWriter)
    resetWorkerAuditWriter()

    // reset 后默认 disabled（NODE_ENV=test），audit 不应抛错也不应调 customWriter
    await audit('credit_refund', { accountId: 'acc-1' })

    expect(customWriter).not.toHaveBeenCalled()
  })

  it('writer 抛错时 audit 函数不抛错（仅 logger.error）', async () => {
    const writer = mock<(entry: WorkerAuditEntry) => Promise<void>>(() =>
      Promise.reject(new Error('DB down')),
    )
    setWorkerAuditWriter(writer)

    // 不应 reject
    await expect(
      audit('credit_debit', { accountId: 'acc-1' }),
    ).resolves.toBeUndefined()

    expect(writer).toHaveBeenCalledTimes(1)
  })

  it('audit 无 opts 时也能正常调用 writer', async () => {
    const writer = mock<(entry: WorkerAuditEntry) => Promise<void>>(() => Promise.resolve())
    setWorkerAuditWriter(writer)

    await audit('credit_debit')

    expect(writer).toHaveBeenCalledTimes(1)
    expect(writer.mock.calls[0][0].action).toBe('credit_debit')
    expect(writer.mock.calls[0][0].accountId).toBeUndefined()
    expect(writer.mock.calls[0][0].detail).toBeUndefined()
  })
})
