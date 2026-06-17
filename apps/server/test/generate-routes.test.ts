import type { GenerationRecordRow, UploadedFileRow } from '@excuse/db'
import { treaty } from '@elysia/eden'
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'

/**
 * 生成路由单元测试
 *
 * Mock @excuse/db, @excuse/provider, @excuse/billing 全部外部依赖，
 * 测试 /api/generate, /api/records, /api/records/:id, DELETE /api/records/:id 的 HTTP 行为
 */

// ─── Mock 类型 ───────────────────────────────────────────────

// mock.module 提升到 import 之前（Bun 会自动提升 mock.module）

import { createServerContext } from '../src/context'
import { createGenerateRoutes } from '../src/routes/generate'

import { resetCategoryRateLimit } from '../src/utils/category-rate-limit'
import { extractEdenError, makeRecord, makeTestConfig, makeValidatedParams, signTestToken } from './helpers/test-factory'

/** Provider 返回结构（涵盖同步/异步/成功/失败所有变体） */
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

const mockCreateRecord = mock<(values: Record<string, unknown>) => Promise<RecordOrNull>>(() => Promise.resolve(null))
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

const mockNotifyStatus = mock<(payload: Record<string, unknown>) => Promise<void>>(() => Promise.resolve(undefined))
const mockGetUploadedFilesByIdsForAccount = mock<(ids: string[], accountId: string) => Promise<unknown[]>>(() => Promise.resolve([]))
const mockCancelRecord = mock<(id: string) => Promise<void>>(() => Promise.resolve(undefined))
const mockResetToPending = mock<(id: string) => Promise<void>>(() => Promise.resolve(undefined))
const mockFindGenerationByDedupeKeyForAccount = mock<(key: string, accountId: string) => Promise<RecordOrNull>>(() => Promise.resolve(null))
const mockValidateModelParameters = mock<(modelConfig: unknown, params: Record<string, unknown>) => { valid: boolean, errors: Array<{ field: string, message: string }> }>(() => ({ valid: true, errors: [] }))
const mockNotifyNotification = mock<(opts: Record<string, unknown>) => Promise<unknown>>(() => Promise.resolve(undefined))

// P2-2：CreditError mock 类 — 供 route 中 `error instanceof CreditError` 解析到同一引用
class MockCreditError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'CreditError'
    this.code = code
  }
}

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
  CreditError: MockCreditError,
  notifyNotification: mockNotifyNotification,
}))

mock.module('@excuse/provider', () => ({
  DashScopeClient: class {
    generate = mockGenerate
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
      'qwen-image-2.0-pro': {
        id: 'qwen-image-2.0-pro',
        category: 'image',
        type: 'generation',
        pricing: { inputPriceCents: 25, unit: 'image' },
        parameters: [],
        requestType: 'image',
        inputMapping: { prompt: { target: 'prompt' } },
      },
      'wan2.1-i2v-t2v-720p': {
        id: 'wan2.1-i2v-t2v-720p',
        category: 'video',
        type: 'generation',
        pricing: { inputPriceCents: 50, unit: 'video' },
        parameters: [],
        requestType: 'video-t2v',
        inputMapping: { prompt: { target: 'prompt' } },
        async: true,
      },
    }
    return models[id]
  },
  mergeWithDefaults: (_modelConfig: unknown, params: Record<string, unknown>) => params,
  validateModelParameters: mockValidateModelParameters,
  validateAndMerge: (modelConfig: unknown, params: Record<string, unknown>) => {
    const result = mockValidateModelParameters(modelConfig, params)
    if (!result.valid) {
      return { ok: false, errors: result.errors }
    }
    return { ok: true, params: makeValidatedParams(params) }
  },
  AssetStorage: class {
    downloadAndMap = mock(() => Promise.resolve(['https://saved.url/img.png']))
  },
}))

mock.module('@excuse/billing', () => ({
  calculateCost: mockCalculateCost,
}))

// ─── 测试配置 ────────────────────────────────────────────

const testConfig = makeTestConfig({
  dashscopeApiKey: 'test-key',
  dashscopeBaseUrl: 'https://test.local',
  storageRoot: '/tmp/test-uploads',
  jwtSecret: 'test-generate-secret',
})

// ─── 辅助：获取有效 token ────────────────────────────────

async function getAuthToken(): Promise<string> {
  return signTestToken(testConfig.jwtSecret, 'acc-001')
}

// ─── 测试 ────────────────────────────────────────────────

describe('generate routes', () => {
  let client: ReturnType<typeof treaty>
  let token: string

  beforeAll(async () => {
    token = await getAuthToken()
  })

  beforeEach(() => {
    resetCategoryRateLimit()
    mockCreateRecord.mockClear()
    mockListRecords.mockClear()
    mockGetRecordById.mockClear()
    mockDeleteRecord.mockClear()
    mockMarkFailed.mockClear()
    mockMarkProcessing.mockClear()
    mockMarkSucceeded.mockClear()
    mockReserveCredit.mockClear()
    mockDebitCredit.mockClear()
    mockRefundCredit.mockClear()
    mockCalculateCost.mockClear()
    mockGenerate.mockClear()
    mockNotifyStatus.mockClear()
    mockGetUploadedFilesByIdsForAccount.mockClear()
    mockCancelRecord.mockClear()
    mockResetToPending.mockClear()
    mockFindGenerationByDedupeKeyForAccount.mockClear()
    mockValidateModelParameters.mockClear()
    mockGetUploadedFilesByIdsForAccount.mockClear()
    mockNotifyNotification.mockClear()

    const ctx = createServerContext(testConfig)
    const app = createGenerateRoutes(testConfig, ctx)
    client = treaty(app)
  })

  // ═══════════════════════════════════════════════════
  //  POST /api/generate
  // ═══════════════════════════════════════════════════

  describe('POST /api/generate', () => {
    it('未登录时返回 401 错误', async () => {
      const res = await client.api.generate.post({
        model: 'qwen-max',
        parameters: { prompt: 'test' },
      })

      // auth plugin 应该拦截 — 401
      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(401)
    })

    it('未知模型返回 422 错误', async () => {
      const res = await client.api.generate.post(
        { model: 'nonexistent', parameters: { prompt: 'test' } },
        { headers: { Authorization: `Bearer ${token}` } },
      )

      // getModelById 返回 undefined → validationError 422
      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(422)
      expect(err!.error).toContain('Unknown model')
      expect(mockCreateRecord).not.toHaveBeenCalled()
    })

    it('参数校验失败返回 422 — 必填参数缺失', async () => {
      // mockReturnValueOnce 只影响本次调用，不影响后续测试
      mockValidateModelParameters.mockReturnValueOnce({
        valid: false,
        errors: [{ field: 'prompt', message: '必填参数 "prompt" 缺失' }],
      })

      const res = await client.api.generate.post(
        { model: 'qwen-max', parameters: {} }, // 缺少 prompt
        { headers: { Authorization: `Bearer ${token}` } },
      )

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(422)
      expect(err!.error).toContain('prompt')
      expect(mockCreateRecord).not.toHaveBeenCalled()
      expect(mockGenerate).not.toHaveBeenCalled()
    })

    it('参数校验失败返回 422 — 未知参数', async () => {
      mockValidateModelParameters.mockReturnValueOnce({
        valid: false,
        errors: [{ field: 'illegal_param', message: '未知参数 "illegal_param"' }],
      })

      const res = await client.api.generate.post(
        { model: 'qwen-max', parameters: { prompt: '你好', illegal_param: 'nope' } },
        { headers: { Authorization: `Bearer ${token}` } },
      )

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(422)
      expect(err!.error).toContain('illegal_param')
      expect(mockCreateRecord).not.toHaveBeenCalled()
    })

    it('余额不足时返回 402 并推送 balance_warning 通知（P2-2）', async () => {
      mockCreateRecord.mockResolvedValue(makeRecord())
      mockCalculateCost.mockReturnValue({ unit: 'token', totalPriceCents: 100, totalPrice: 1 })
      mockReserveCredit.mockImplementationOnce(async () => {
        throw new MockCreditError('INSUFFICIENT_BALANCE', '余额不足')
      })

      const res = await client.api.generate.post(
        { model: 'qwen-max', parameters: { prompt: '你好' } },
        { headers: { Authorization: `Bearer ${token}` } },
      )

      // 返回 paymentRequired (402)
      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(402)
      // 标记记录失败
      expect(mockMarkFailed).toHaveBeenCalled()
      // 余额不足通知触发（notifyInsufficientBalance → pushNotification → notifyNotification）
      expect(mockNotifyNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'balance_warning' }),
      )
    })

    it('同步模型（文本）成功时标记为 succeeded', async () => {
      mockCreateRecord.mockResolvedValue(makeRecord())
      mockGetRecordById.mockResolvedValue(makeRecord({ status: 'succeeded' }))
      mockGenerate.mockResolvedValue({
        success: true,
        output: { text: '你好' },
        usage: { inputTokens: 10, outputTokens: 20 },
      })
      mockCalculateCost.mockReturnValue({ unit: 'token', totalPriceCents: 1, totalPrice: 0.01 })

      const { data } = await client.api.generate.post(
        { model: 'qwen-max', parameters: { prompt: '你好' } },
        { headers: { Authorization: `Bearer ${token}` } },
      )

      expect(data?.success).toBe(true)
      expect(data?.record?.status).toBe('succeeded')
      expect(mockReserveCredit).toHaveBeenCalledWith(expect.objectContaining({
        accountId: 'acc-001',
        generationRecordId: 'rec-001',
        amountCents: 1,
      }))
      expect(mockDebitCredit).toHaveBeenCalledWith(expect.objectContaining({
        accountId: 'acc-001',
        generationRecordId: 'rec-001',
        actualCents: 1,
      }))
      expect(mockMarkSucceeded).toHaveBeenCalled()
    })

    it('相同语义参数顺序不同也生成相同 dedupeKey', async () => {
      mockCreateRecord.mockResolvedValue(makeRecord())
      mockGetRecordById.mockResolvedValue(makeRecord({ status: 'succeeded' }))
      mockGenerate.mockResolvedValue({
        success: true,
        output: { text: '你好' },
        usage: { inputTokens: 10, outputTokens: 20 },
      })

      await client.api.generate.post(
        { model: 'qwen-max', parameters: { prompt: '你好', temperature: 0.7 } },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      await client.api.generate.post(
        { model: 'qwen-max', parameters: { temperature: 0.7, prompt: '你好' } },
        { headers: { Authorization: `Bearer ${token}` } },
      )

      const firstDedupeKey = mockFindGenerationByDedupeKeyForAccount.mock.calls[0]?.[0]
      const secondDedupeKey = mockFindGenerationByDedupeKeyForAccount.mock.calls[1]?.[0]

      expect(firstDedupeKey).toBeDefined()
      expect(firstDedupeKey).toBe(secondDedupeKey)
      expect(firstDedupeKey).toStartWith('sha256:')
      expect(mockCreateRecord.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ dedupeKey: firstDedupeKey }))
      expect(mockCreateRecord.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ dedupeKey: secondDedupeKey }))
    })

    it('同步模型 API 失败时标记为 failed（HTTP 200 业务失败）', async () => {
      mockCreateRecord.mockResolvedValue(makeRecord())
      mockGetRecordById.mockResolvedValue(makeRecord({ status: 'failed' }))
      mockGenerate.mockResolvedValue({
        success: false,
        error: 'API 错误',
      })

      const { data } = await client.api.generate.post(
        { model: 'qwen-max', parameters: { prompt: '你好' } },
        { headers: { Authorization: `Bearer ${token}` } },
      )

      // Provider 失败是业务层面失败，路由仍返回 HTTP 200
      expect(data?.success).toBe(false)
      expect(data?.record?.status).toBe('failed')
      expect(mockMarkFailed).toHaveBeenCalled()
      expect(mockRefundCredit).toHaveBeenCalledWith(expect.objectContaining({
        accountId: 'acc-001',
        generationRecordId: 'rec-001',
      }))
    })

    it('缺少 prompt 参数时由模型验证层拒绝', async () => {
      mockCreateRecord.mockResolvedValue(makeRecord())
      mockGetRecordById.mockResolvedValue(makeRecord({ status: 'failed' }))
      mockGenerate.mockResolvedValue({
        success: false,
        error: 'prompt is required',
      })
      mockMarkFailed.mockResolvedValue(undefined)

      const { data } = await client.api.generate.post(
        { model: 'qwen-max', parameters: {} },
        { headers: { Authorization: `Bearer ${token}` } },
      )

      // Provider 拒绝 = 业务失败，HTTP 200
      expect(data?.success).toBe(false)
      expect(data?.record?.status).toBe('failed')
    })

    it('异步视频模型返回 video_task，标记为 processing', async () => {
      mockCreateRecord.mockResolvedValue(makeRecord({ category: 'video', model: 'wan2.1-i2v-t2v-720p' }))
      mockGetRecordById.mockResolvedValue(makeRecord({ status: 'processing', category: 'video' }))
      mockGenerate.mockResolvedValue({
        type: 'video_task',
        success: true,
        model: 'wan2.1-i2v-t2v-720p',
        taskId: 'dashscope-task-123',
        output: { type: 'processing', taskId: 'dashscope-task-123', status: 'submitted' },
      })
      mockCalculateCost.mockReturnValue({ unit: 'video', totalPriceCents: 1, totalPrice: 0.01 })

      const { data } = await client.api.generate.post(
        { model: 'wan2.1-i2v-t2v-720p', parameters: { prompt: '一段视频' } },
        { headers: { Authorization: `Bearer ${token}` } },
      )

      expect(data?.success).toBe(true)
      expect(data?.record?.status).toBe('processing')
      expect(mockReserveCredit).toHaveBeenCalledWith(expect.objectContaining({
        accountId: 'acc-001',
        generationRecordId: 'rec-001',
        amountCents: 1,
      }))
      expect(mockDebitCredit).not.toHaveBeenCalled()
      expect(mockMarkProcessing).toHaveBeenCalledWith(
        'rec-001',
        expect.objectContaining({ taskId: 'dashscope-task-123' }),
      )
      expect(mockNotifyStatus).toHaveBeenCalled()
    })

    it('referenceFileIds 不属于当前用户时不创建记录（403）', async () => {
      // 模拟部分文件不属于当前用户 — 返回数量少于请求数量
      mockGetUploadedFilesByIdsForAccount.mockResolvedValue([
        { id: 'file-001', publicUrl: '/uploads/file1.png' } as UploadedFileRow,
      ] as unknown as UploadedFileRow[])

      const res = await client.api.generate.post(
        {
          model: 'qwen-max',
          parameters: { prompt: '你好' },
          referenceFileIds: ['file-001', 'file-002'], // 请求 2 个，但只有 1 个属于用户
        },
        { headers: { Authorization: `Bearer ${token}` } },
      )

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(403)
      expect(err!.error).toContain('参考文件')
      // 关键：校验失败时不创建任何 DB 记录
      expect(mockCreateRecord).not.toHaveBeenCalled()
      expect(mockGenerate).not.toHaveBeenCalled()
    })

    it('referenceFileIds 全部属于当前用户时正常创建记录', async () => {
      mockCreateRecord.mockResolvedValue(makeRecord())
      mockGetRecordById.mockResolvedValue(makeRecord({ status: 'succeeded' }))
      mockGenerate.mockResolvedValue({
        success: true,
        output: { text: '你好' },
        usage: { inputTokens: 10, outputTokens: 20 },
      })
      mockCalculateCost.mockReturnValue({ unit: 'token', totalPriceCents: 1, totalPrice: 0.01 })

      // 模拟所有文件都属于当前用户
      mockGetUploadedFilesByIdsForAccount.mockResolvedValue([
        { id: 'file-001', publicUrl: '/uploads/file1.png' } as unknown as UploadedFileRow,
        { id: 'file-002', publicUrl: '/uploads/file2.png' } as unknown as UploadedFileRow,
      ])

      const { data } = await client.api.generate.post(
        {
          model: 'qwen-max',
          parameters: { prompt: '你好' },
          referenceFileIds: ['file-001', 'file-002'],
        },
        { headers: { Authorization: `Bearer ${token}` } },
      )

      expect(data?.success).toBe(true)
      expect(mockCreateRecord).toHaveBeenCalled()
      // referenceUrls 应传给 provider
      expect(mockGenerate).toHaveBeenCalledWith(
        'qwen-max',
        expect.objectContaining({ prompt: '你好' }),
        ['/uploads/file1.png', '/uploads/file2.png'],
      )
    })
  })

  // ═══════════════════════════════════════════════════
  //  GET /api/records
  // ═══════════════════════════════════════════════════

  describe('GET /api/records', () => {
    it('未登录时返回 401 错误', async () => {
      const res = await client.api.records.get()

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(401)
    })

    it('返回用户的生成记录列表', async () => {
      mockListRecords.mockResolvedValue([makeRecord(), makeRecord({ id: 'rec-002' })])

      const { data } = await client.api.records.get({
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(data?.items).toHaveLength(2)
      expect(data?.total).toBe(2)
    })

    it('空列表返回空数组', async () => {
      mockListRecords.mockResolvedValue([])

      const { data } = await client.api.records.get({
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(data?.items).toHaveLength(0)
      expect(data?.total).toBe(0)
    })

    it('支持 category 筛选', async () => {
      mockListRecords.mockResolvedValue([makeRecord({ category: 'text' })])

      const { data } = await client.api.records.get({
        query: { category: 'text' },
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(data?.items).toHaveLength(1)
      expect(mockListRecords).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'text' }),
      )
    })

    it('支持 limit/offset 分页', async () => {
      mockListRecords.mockResolvedValue([])

      await client.api.records.get({
        query: { limit: 10, offset: 20 },
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(mockListRecords).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10, offset: 20 }),
      )
    })
  })

  // ═══════════════════════════════════════════════════
  //  GET /api/records/:id
  // ═══════════════════════════════════════════════════

  describe('GET /api/records/:id', () => {
    it('未登录时返回 401 错误', async () => {
      mockGetRecordById.mockResolvedValue(makeRecord())

      const res = await client.api.records({ id: 'rec-001' }).get()

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(401)
    })

    it('登录后返回自己的记录', async () => {
      mockGetRecordById.mockResolvedValue(makeRecord())

      const { data } = await client.api.records({ id: 'rec-001' }).get({
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(data?.success).toBe(true)
      expect(data?.record).toBeDefined()
    })

    it('记录不存在返回 404', async () => {
      mockGetRecordById.mockResolvedValue(null)

      const res = await client.api.records({ id: 'nonexistent' }).get({
        headers: { Authorization: `Bearer ${token}` },
      })

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(404)
      expect(err!.error).toContain('不存在')
    })

    it('不能查看其他用户的记录（403）', async () => {
      mockGetRecordById.mockResolvedValue(makeRecord({ accountId: 'other-user-id' }))

      const res = await client.api.records({ id: 'rec-001' }).get({
        headers: { Authorization: `Bearer ${token}` },
      })

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(403)
      expect(err!.error).toContain('无权')
    })
  })

  // ═══════════════════════════════════════════════════
  //  DELETE /api/records/:id
  // ═══════════════════════════════════════════════════

  describe('DELETE /api/records/:id', () => {
    it('未登录时返回 401 错误', async () => {
      const res = await client.api.records({ id: 'rec-001' }).delete()

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(401)
    })

    it('成功删除自己的记录', async () => {
      mockGetRecordById.mockResolvedValue(makeRecord({ accountId: 'acc-001' }))

      const { data } = await client.api.records({ id: 'rec-001' }).delete(
        null,
        { headers: { Authorization: `Bearer ${token}` } },
      )

      expect(data?.success).toBe(true)
      expect(mockDeleteRecord).toHaveBeenCalledWith('rec-001')
    })

    it('记录不存在返回 404', async () => {
      mockGetRecordById.mockResolvedValue(null)

      const res = await client.api.records({ id: 'nonexistent' }).delete(
        null,
        { headers: { Authorization: `Bearer ${token}` } },
      )

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(404)
      expect(err!.error).toContain('不存在')
    })

    it('不能删除其他用户的记录（403）', async () => {
      mockGetRecordById.mockResolvedValue(
        makeRecord({ accountId: 'other-user-id' }),
      )

      const res = await client.api.records({ id: 'rec-001' }).delete(
        null,
        { headers: { Authorization: `Bearer ${token}` } },
      )

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(403)
      expect(err!.error).toContain('无权')
      expect(mockDeleteRecord).not.toHaveBeenCalled()
    })
  })

  // ═══════════════════════════════════════════════════
  //  视频模型独立限流 (P2.18.1)
  // ═══════════════════════════════════════════════════

  describe('视频模型独立限流', () => {
    it('视频模型 5 次内允许通过', async () => {
      mockGenerate.mockResolvedValue({ success: true, output: { text: 'ok' }, usage: {} })
      mockCreateRecord.mockResolvedValue(makeRecord({ model: 'wan2.1-i2v-t2v-720p', category: 'video' }))
      mockMarkSucceeded.mockResolvedValue(undefined)

      for (let i = 0; i < 5; i++) {
        const res = await client.api.generate.post(
          { model: 'wan2.1-i2v-t2v-720p', parameters: { prompt: `video ${i}` } },
          { headers: { Authorization: `Bearer ${token}` } },
        )
        // 前 5 次不应被限流拒绝（可能成功或 provider 错误，但不是 429）
        const err = extractEdenError(res)
        if (err) {
          expect(err.status).not.toBe(429)
        }
      }
    })

    it('视频模型第 6 次返回 429', async () => {
      mockGenerate.mockResolvedValue({ success: true, output: { text: 'ok' }, usage: {} })

      // 先消费 5 次
      for (let i = 0; i < 5; i++) {
        mockCreateRecord.mockResolvedValueOnce(makeRecord({ model: 'wan2.1-i2v-t2v-720p', category: 'video' }))
        await client.api.generate.post(
          { model: 'wan2.1-i2v-t2v-720p', parameters: { prompt: `burst ${i}` } },
          { headers: { Authorization: `Bearer ${token}` } },
        )
      }

      // 第 6 次应被限流
      const res = await client.api.generate.post(
        { model: 'wan2.1-i2v-t2v-720p', parameters: { prompt: 'burst 6' } },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(429)
      expect(err!.error).toContain('视频生成')
    })

    it('文本模型不受视频限流影响', async () => {
      mockGenerate.mockResolvedValue({ success: true, output: { text: 'ok' }, usage: {} })

      // 先消费 5 次视频额度
      for (let i = 0; i < 5; i++) {
        mockCreateRecord.mockResolvedValueOnce(makeRecord({ model: 'wan2.1-i2v-t2v-720p', category: 'video' }))
        await client.api.generate.post(
          { model: 'wan2.1-i2v-t2v-720p', parameters: { prompt: `vid ${i}` } },
          { headers: { Authorization: `Bearer ${token}` } },
        )
      }

      // 文本模型应不受影响
      mockCreateRecord.mockResolvedValueOnce(makeRecord({ model: 'qwen-max', category: 'text' }))
      const res = await client.api.generate.post(
        { model: 'qwen-max', parameters: { prompt: 'text after video burst' } },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      const err = extractEdenError(res)
      // 不应是 429（可能成功或有其他错误，但不受视频限流）
      if (err) {
        expect(err.status).not.toBe(429)
      }
    })
  })
})
