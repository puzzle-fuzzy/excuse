import type { GenerationRecordRow, UploadedFileRow } from '@excuse/db'
import { treaty } from '@elysia/eden'
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'

/**
 * Generate 路由 retry / cancel 端点测试
 *
 * 测试 POST /api/records/:id/retry 和 POST /api/records/:id/cancel
 */

// ─── Mock 类型 ───────────────────────────────────────────────

import { extractEdenError, makeFailedRecord, makeProcessingRecord, makeTestConfig, makeValidatedParams, signTestToken } from './helpers/test-factory'

interface MockProviderResult {
  type?: 'text' | 'image' | 'video_task' | 'failed'
  success: boolean
  model?: string
  error?: string
  output?: Record<string, unknown>
  usage?: Record<string, unknown>
  taskId?: string
}

// ─── Mocks ───────────────────────────────────────────────

type RecordOrNull = GenerationRecordRow | null

const mockCreateRecord = mock<() => Promise<RecordOrNull>>(() => Promise.resolve(null))
const mockListRecords = mock<(filter: Record<string, unknown>) => Promise<GenerationRecordRow[]>>(() => Promise.resolve([]))
const mockGetRecordById = mock<(id: string) => Promise<RecordOrNull>>(() => Promise.resolve(null))
const mockDeleteRecord = mock<(id: string) => Promise<void>>(() => Promise.resolve(undefined))
const mockMarkFailed = mock<(id: string, error: string) => Promise<void>>(() => Promise.resolve(undefined))
const mockMarkProcessing = mock<(id: string, data: Record<string, unknown>) => Promise<void>>(() => Promise.resolve(undefined))
const mockMarkSucceeded = mock<(id: string, output: unknown, cost: unknown) => Promise<void>>(() => Promise.resolve(undefined))
const mockReserveCredit = mock<(opts: Record<string, unknown>) => Promise<void>>(() => Promise.resolve(undefined))
const mockDebitCredit = mock<(opts: Record<string, unknown>) => Promise<void>>(() => Promise.resolve(undefined))
const mockRefundCredit = mock<(opts: Record<string, unknown>) => Promise<void>>(() => Promise.resolve(undefined))
const mockCalculateCost = mock<() => Record<string, unknown>>(() => ({ unit: 'token', totalPriceCents: 1, totalPrice: 0.01 }))
const mockGenerate = mock<(model: string, params: Record<string, unknown>, refs?: string[]) => Promise<MockProviderResult>>(() =>
  Promise.resolve({ type: 'failed', success: false, error: 'mock error' }),
)
const mockCancelTask = mock(() => Promise.resolve(true))
const mockNotifyStatus = mock<(payload: Record<string, unknown>) => Promise<void>>(() => Promise.resolve(undefined))
const mockGetUploadedFilesByIdsForAccount = mock<(ids: string[], accountId: string) => Promise<unknown[]>>(() => Promise.resolve([]))
const mockCancelRecord = mock<(id: string) => Promise<void>>(() => Promise.resolve(undefined))
const mockResetToPending = mock<(id: string) => Promise<RecordOrNull>>(() => Promise.resolve(null))
const mockFindGenerationByDedupeKeyForAccount = mock<(key: string, accountId: string) => Promise<RecordOrNull>>(() => Promise.resolve(null))

mock.module('@excuse/db', () => ({
  createGenerationRecord: mockCreateRecord,
  listGenerationRecords: mockListRecords,
  getGenerationRecordById: mockGetRecordById,
  deleteGenerationRecord: mockDeleteRecord,
  markGenerationFailed: mockMarkFailed,
  markGenerationProcessing: mockMarkProcessing,
  markGenerationSucceeded: mockMarkSucceeded,
  reserveCredit: mockReserveCredit,
  debitCredit: mockDebitCredit,
  refundCredit: mockRefundCredit,
  notifyGenerationStatus: mockNotifyStatus,
  getUploadedFilesByIdsForAccount: mockGetUploadedFilesByIdsForAccount,
  cancelGenerationRecord: mockCancelRecord,
  resetGenerationToPending: mockResetToPending,
  findGenerationByDedupeKeyForAccount: mockFindGenerationByDedupeKeyForAccount,
}))

mock.module('@excuse/provider', () => ({
  DashScopeClient: class {
    generate = mockGenerate
    cancelTask = mockCancelTask
  },
  getModelById: (id: string) => {
    const models: Record<string, unknown> = {
      'qwen-max': {
        id: 'qwen-max',
        category: 'text',
        type: 'generation',
        pricing: { inputPriceCents: 240, outputPriceCents: 960, unit: 'token' },
        parameters: [],
        requestType: 'chat',
        inputMapping: { prompt: { target: 'prompt' } },
      },
    }
    return models[id]
  },
  mergeWithDefaults: (_modelConfig: unknown, params: Record<string, unknown>) => params,
  validateModelParameters: () => ({ valid: true, errors: [] }),
  validateAndMerge: (_modelConfig: unknown, params: Record<string, unknown>) => ({ ok: true, params: makeValidatedParams(params) }),
  AssetStorage: class {
    downloadAndMap = mock(() => Promise.resolve(['https://saved.url/img.png']))
  },
}))

mock.module('@excuse/billing', () => ({
  calculateCost: mockCalculateCost,
  getBillingPolicy: mock(() => ({
    mode: 'credit-ledger',
    lifecycle: ['reserve', 'debit', 'refund'],
    usageEventRequired: true,
    generationRecordRequired: true,
  })),
  assertCreditLedgerPolicy: mock(() => undefined),
}))

// eslint-disable-next-line import/first
import { createServerContext } from '../src/context'

// eslint-disable-next-line import/first
import { createGenerateRoutes } from '../src/routes/generate'

// ─── 测试配置 ────────────────────────────────────────────

const testConfig = makeTestConfig({
  dashscopeApiKey: 'test-key',
  dashscopeBaseUrl: 'https://test.local',
  storageRoot: '/tmp/test-uploads',
  jwtSecret: 'test-retry-cancel-secret',
})

async function getAuthToken(): Promise<string> {
  return signTestToken(testConfig.jwtSecret, 'acc-001')
}

// ─── 测试 ────────────────────────────────────────────────

describe('generate 路由 — 重试与取消', () => {
  let client: ReturnType<typeof treaty>
  let token: string

  beforeAll(async () => {
    token = await getAuthToken()
  })

  beforeEach(() => {
    for (const m of [
      mockCreateRecord,
      mockListRecords,
      mockGetRecordById,
      mockDeleteRecord,
      mockMarkFailed,
      mockMarkProcessing,
      mockMarkSucceeded,
      mockReserveCredit,
      mockDebitCredit,
      mockRefundCredit,
      mockCalculateCost,
      mockGenerate,
      mockCancelTask,
      mockNotifyStatus,
      mockGetUploadedFilesByIdsForAccount,
      mockCancelRecord,
      mockResetToPending,
      mockFindGenerationByDedupeKeyForAccount,
    ]) {
      m.mockClear()
    }

    const ctx = createServerContext(testConfig)
    const app = createGenerateRoutes(testConfig, ctx)
    client = treaty(app)
    mockCancelTask.mockResolvedValue(true)
    mockResetToPending.mockResolvedValue(makeFailedRecord({ status: 'pending' }))
  })

  // ═══════════════════════════════════════════════════
  //  POST /api/records/:id/retry
  // ═══════════════════════════════════════════════════

  describe('POST /api/records/:id/retry', () => {
    it('未登录时返回错误', async () => {
      const res = await client.api.records({ id: 'rec-001' }).retry.post()

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(401)
    })

    it('记录不存在时返回错误', async () => {
      mockGetRecordById.mockResolvedValue(null)

      const res = await client.api.records({ id: 'nonexistent' }).retry.post(
        null,
        { headers: { Authorization: `Bearer ${token}` } },
      )

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.error).toContain('不存在')
      expect(err!.status).toBe(404)
      expect(mockResetToPending).not.toHaveBeenCalled()
    })

    it('非失败记录返回错误（只能重试失败任务）', async () => {
      mockGetRecordById.mockResolvedValue(makeFailedRecord({ status: 'succeeded' }))

      const res = await client.api.records({ id: 'rec-001' }).retry.post(
        null,
        { headers: { Authorization: `Bearer ${token}` } },
      )

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.error).toContain('失败')
      expect(err!.status).toBe(422)
      expect(mockResetToPending).not.toHaveBeenCalled()
    })

    it('无权操作其他用户的记录', async () => {
      mockGetRecordById.mockResolvedValue(makeFailedRecord({ accountId: 'other-user' }))

      const res = await client.api.records({ id: 'rec-001' }).retry.post(
        null,
        { headers: { Authorization: `Bearer ${token}` } },
      )

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.error).toContain('无权')
      expect(err!.status).toBe(403)
    })

    it('重试失败任务 — 同步模型成功', async () => {
      mockGetRecordById.mockResolvedValue(makeFailedRecord())
      mockGenerate.mockResolvedValue({
        success: true,
        output: { text: '重试结果' },
        usage: { inputTokens: 10, outputTokens: 20 },
      })
      mockCalculateCost.mockReturnValue({ unit: 'token', totalPriceCents: 1, totalPrice: 0.01 })

      const { data } = await client.api.records({ id: 'rec-failed-001' }).retry.post(
        null,
        { headers: { Authorization: `Bearer ${token}` } },
      )

      expect(data?.success).toBe(true)
      expect(mockResetToPending).toHaveBeenCalledWith('rec-failed-001')
      expect(mockReserveCredit).toHaveBeenCalledWith(expect.objectContaining({
        accountId: 'acc-001',
        generationRecordId: 'rec-failed-001',
        amountCents: 1,
      }))
      expect(mockDebitCredit).toHaveBeenCalledWith(expect.objectContaining({
        accountId: 'acc-001',
        generationRecordId: 'rec-failed-001',
        actualCents: 1,
      }))
      expect(mockMarkSucceeded).toHaveBeenCalled()
      expect(mockNotifyStatus).toHaveBeenCalled()
    })

    it('重试连点时只有抢到状态转换的请求会调用 provider', async () => {
      mockGetRecordById
        .mockResolvedValueOnce(makeFailedRecord())
        .mockResolvedValueOnce(makeFailedRecord({ status: 'pending' }))
      mockResetToPending.mockResolvedValueOnce(null)

      const { data } = await client.api.records({ id: 'rec-failed-001' }).retry.post(
        null,
        { headers: { Authorization: `Bearer ${token}` } },
      )

      expect(data?.success).toBe(true)
      expect(data?.duplicated).toBe(true)
      expect(mockGenerate).not.toHaveBeenCalled()
      expect(mockReserveCredit).not.toHaveBeenCalled()
    })

    it('重试失败任务 — API 再次失败', async () => {
      mockGetRecordById.mockResolvedValue(makeFailedRecord())
      mockGenerate.mockResolvedValue({ success: false, error: 'API 仍然失败' })

      const { data } = await client.api.records({ id: 'rec-failed-001' }).retry.post(
        null,
        { headers: { Authorization: `Bearer ${token}` } },
      )

      expect(data?.success).toBe(false)
      expect(mockRefundCredit).toHaveBeenCalledWith(expect.objectContaining({
        accountId: 'acc-001',
        generationRecordId: 'rec-failed-001',
      }))
      expect(mockMarkFailed).toHaveBeenCalled()
    })

    it('重试时未知模型返回错误', async () => {
      mockGetRecordById.mockResolvedValue(makeFailedRecord({ model: 'nonexistent-model' }))

      const res = await client.api.records({ id: 'rec-001' }).retry.post(
        null,
        { headers: { Authorization: `Bearer ${token}` } },
      )

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.error).toContain('Unknown model')
    })

    it('重试时 reference 文件不再属于用户时不重置状态（403）', async () => {
      // 记录包含 referenceFileIds 但文件已不再属于用户
      mockGetRecordById.mockResolvedValue(makeFailedRecord({
        inputParams: { prompt: '你好', referenceFileIds: ['file-001', 'file-002'] },
      }))
      // 只返回 1 个文件（说明 file-002 不属于用户）
      mockGetUploadedFilesByIdsForAccount.mockResolvedValue([
        { id: 'file-001', publicUrl: '/uploads/file1.png' } as unknown as UploadedFileRow,
      ])

      const res = await client.api.records({ id: 'rec-failed-001' }).retry.post(
        null,
        { headers: { Authorization: `Bearer ${token}` } },
      )

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(403)
      expect(err!.error).toContain('参考文件')
      // 关键：校验失败时不重置记录状态
      expect(mockResetToPending).not.toHaveBeenCalled()
      expect(mockGenerate).not.toHaveBeenCalled()
    })
  })

  // ═══════════════════════════════════════════════════
  //  POST /api/records/:id/cancel
  // ═══════════════════════════════════════════════════

  describe('POST /api/records/:id/cancel', () => {
    it('未登录时返回错误', async () => {
      const res = await client.api.records({ id: 'rec-001' }).cancel.post()

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(401)
    })

    it('记录不存在时返回错误', async () => {
      mockGetRecordById.mockResolvedValue(null)

      const res = await client.api.records({ id: 'nonexistent' }).cancel.post(
        null,
        { headers: { Authorization: `Bearer ${token}` } },
      )

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.error).toContain('不存在')
      expect(err!.status).toBe(404)
    })

    it('无权操作其他用户的记录', async () => {
      mockGetRecordById.mockResolvedValue(makeProcessingRecord({ accountId: 'other-user' }))

      const res = await client.api.records({ id: 'rec-001' }).cancel.post(
        null,
        { headers: { Authorization: `Bearer ${token}` } },
      )

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.error).toContain('无权')
      expect(err!.status).toBe(403)
    })

    it('已完成任务不能取消', async () => {
      mockGetRecordById.mockResolvedValue(makeProcessingRecord({ status: 'succeeded' }))

      const res = await client.api.records({ id: 'rec-001' }).cancel.post(
        null,
        { headers: { Authorization: `Bearer ${token}` } },
      )

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.error).toContain('只能取消')
      expect(err!.status).toBe(422)
      expect(mockCancelRecord).not.toHaveBeenCalled()
    })

    it('成功取消 processing 任务', async () => {
      const record = makeProcessingRecord({ cost: { unit: 'video', totalPriceCents: 1, totalPrice: 0.01 } })
      mockGetRecordById
        .mockResolvedValueOnce(record)
        .mockResolvedValueOnce({ ...record, status: 'failed', errorMessage: '用户取消' })

      const { data } = await client.api.records({ id: 'rec-proc-001' }).cancel.post(
        null,
        { headers: { Authorization: `Bearer ${token}` } },
      )

      expect(data?.success).toBe(true)
      expect(mockCancelTask).toHaveBeenCalledWith('gen_proc_task')
      expect(mockCancelRecord).toHaveBeenCalledWith('rec-proc-001', 'succeeded')
      expect(mockRefundCredit).toHaveBeenCalledWith(expect.objectContaining({
        accountId: 'acc-001',
        generationRecordId: 'rec-proc-001',
      }))
      expect(mockNotifyStatus).toHaveBeenCalled()
    })

    it('成功取消 pending 任务并记录 no_task', async () => {
      const record = makeProcessingRecord({ status: 'pending', taskId: null, outputResult: null })
      mockGetRecordById
        .mockResolvedValueOnce(record)
        .mockResolvedValueOnce({
          ...record,
          status: 'cancelled',
          errorMessage: '用户取消',
          cancelRequestedAt: new Date('2026-06-16T00:00:00.000Z'),
          providerCancelStatus: 'no_task',
        })

      const { data } = await client.api.records({ id: 'rec-proc-001' }).cancel.post(
        null,
        { headers: { Authorization: `Bearer ${token}` } },
      )

      expect(data?.success).toBe(true)
      expect(new Date(data!.record.cancelRequestedAt!).toISOString()).toBe('2026-06-16T00:00:00.000Z')
      expect(data?.record.providerCancelStatus).toBe('no_task')
      expect(mockCancelTask).not.toHaveBeenCalled()
      expect(mockCancelRecord).toHaveBeenCalledWith('rec-proc-001', 'no_task')
    })

    it('provider 取消失败时仍本地取消并记录 failed', async () => {
      mockCancelTask.mockResolvedValueOnce(false)
      const record = makeProcessingRecord({ cost: { unit: 'video', totalPriceCents: 1, totalPrice: 0.01 } })
      mockGetRecordById
        .mockResolvedValueOnce(record)
        .mockResolvedValueOnce({
          ...record,
          status: 'cancelled',
          errorMessage: '用户取消',
          providerCancelStatus: 'failed',
          cancelRequestedAt: new Date('2026-06-16T00:01:00.000Z'),
        })

      const { data } = await client.api.records({ id: 'rec-proc-001' }).cancel.post(
        null,
        { headers: { Authorization: `Bearer ${token}` } },
      )

      expect(data?.success).toBe(true)
      expect(data?.record.providerCancelStatus).toBe('failed')
      expect(mockCancelRecord).toHaveBeenCalledWith('rec-proc-001', 'failed')
    })
  })
})
