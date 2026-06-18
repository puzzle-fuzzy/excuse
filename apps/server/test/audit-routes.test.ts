import type { GenerationRecordRow } from '@excuse/db'
import type { AuditEntry } from '../src/services/audit'
import { treaty } from '@elysia/eden'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Elysia } from 'elysia'
import { makeFailedRecord, makeProcessingRecord, makeRecord, makeTestConfig, makeValidatedParams, signTestToken } from './helpers/test-factory'

/**
 * 审计钩子路由测试 — 验证新增的 audit() 调用是否在正确的业务节点触发
 *
 * 覆盖 action:
 *   - gateway_call / credit_reserve / credit_debit / credit_refund（OpenAI 网关）
 *   - generation_retry / credit_reserve（generate 重试）
 *   - generation_cancel（generate 取消）
 *
 * 通过 setAuditWriter 注入捕获 writer（同时启用 audit），断言 writer 收到对应 entry。
 */

// ─── Mock 依赖 ──────────────────────────────────────────

const mockRecord = makeRecord({
  id: 'rec-audit-001',
  taskId: 'gen_audit_001',
  model: 'qwen-max',
  status: 'succeeded',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
})

const mockCreateRecord = mock<(values: Record<string, unknown>) => Promise<GenerationRecordRow>>(() => Promise.resolve(mockRecord))
const mockListRecords = mock<(filter: Record<string, unknown>) => Promise<GenerationRecordRow[]>>(() => Promise.resolve([]))
const mockGetRecordById = mock<(id: string) => Promise<GenerationRecordRow | null>>(() => Promise.resolve(null))
const mockDeleteRecord = mock<(id: string) => Promise<void>>(() => Promise.resolve(undefined))
const mockMarkFailed = mock<(id: string, error: string) => Promise<void>>(() => Promise.resolve(undefined))
const mockMarkProcessing = mock<(id: string, data: Record<string, unknown>) => Promise<void>>(() => Promise.resolve(undefined))
const mockMarkSucceeded = mock<(id: string, output: unknown, cost: unknown) => Promise<void>>(() => Promise.resolve(undefined))
const mockReserveCredit = mock<(opts: Record<string, unknown>) => Promise<void>>(() => Promise.resolve(undefined))
const mockDebitCredit = mock<(opts: Record<string, unknown>) => Promise<void>>(() => Promise.resolve(undefined))
const mockRefundCredit = mock<(opts: Record<string, unknown>) => Promise<void>>(() => Promise.resolve(undefined))
const mockCancelRecord = mock<(id: string) => Promise<void>>(() => Promise.resolve(undefined))
const mockResetToPending = mock<(id: string) => Promise<void>>(() => Promise.resolve(undefined))
const mockFindDedupe = mock<(key: string, accountId: string) => Promise<GenerationRecordRow | null>>(() => Promise.resolve(null))
const mockGetFiles = mock<(ids: string[], accountId: string) => Promise<unknown[]>>(() => Promise.resolve([]))
const mockNotifyStatus = mock<(payload: Record<string, unknown>) => Promise<void>>(() => Promise.resolve(undefined))

const mockGenerate = mock<(model: string, params: Record<string, unknown>, refs?: string[]) => Promise<Record<string, unknown>>>(() =>
  Promise.resolve({ success: true, output: { text: 'ok' }, usage: { inputTokens: 5, outputTokens: 7 } }),
)
const mockChatCompletion = mock<(model: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>>(() => Promise.resolve({
  success: true,
  output: { text: 'Hello!' },
  usage: { inputTokens: 10, outputTokens: 20 },
}))

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
  cancelGenerationRecord: mockCancelRecord,
  resetGenerationToPending: mockResetToPending,
  findGenerationByDedupeKeyForAccount: mockFindDedupe,
  getUploadedFilesByIdsForAccount: mockGetFiles,
  notifyGenerationStatus: mockNotifyStatus,
  createAuditLog: () => Promise.resolve(),
  CreditError: class CreditError extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  },
}))

mock.module('@excuse/provider', () => ({
  DashScopeClient: class {
    generate = mockGenerate
    chatCompletion = mockChatCompletion
    cancelTask = mock(() => Promise.resolve(undefined))
  },
  AssetStorage: class {},
  getModelById: (id: string) => {
    const models: Record<string, Record<string, unknown>> = {
      'qwen-max': {
        id: 'qwen-max',
        category: 'text',
        pricing: { inputPriceCents: 240, outputPriceCents: 960, unit: 'token' },
        parameters: [
          { name: 'prompt', type: 'text', required: true },
          { name: 'temperature', type: 'number', defaultValue: 0.7 },
        ],
        requestType: 'chat',
        inputMapping: { prompt: { target: 'prompt' } },
      },
    }
    return models[id] ?? null
  },
  getModelsByCategory: () => [],
  mergeWithDefaults: (_modelConfig: unknown, params: Record<string, unknown>) => params,
  validateModelParameters: () => ({ valid: true, errors: [] }),
  validateAndMerge: (_modelConfig: unknown, params: Record<string, unknown>) => ({ ok: true, params: makeValidatedParams(params) }),
  MODELS: {},
}))

mock.module('@excuse/billing', () => ({
  calculateCost: () => ({ unit: 'token', totalPriceCents: 1, totalPrice: 0.01 }),
  aggregateStatistics: () => ({ totalCents: 0, totalYuan: 0, byCategory: [], byModel: [], dailyTrend: [] }),
}))

// eslint-disable-next-line import/first
import { createServerContext } from '../src/context'
// eslint-disable-next-line import/first
import { createGenerateRoutes } from '../src/routes/generate'
// eslint-disable-next-line import/first
import { createOpenAIGatewayRoutes } from '../src/routes/openai-gateway'
// eslint-disable-next-line import/first
import { resetAuditWriter, setAuditWriter } from '../src/services/audit'

// ─── 测试配置 ──────────────────────────────────────────

const testConfig = makeTestConfig({
  dashscopeApiKey: 'test-key',
  dashscopeBaseUrl: 'https://test.local',
  storageRoot: '/tmp/test-uploads',
  jwtSecret: 'audit-routes-test-secret',
})

async function getAuthHeaders(accountId = 'acc-001') {
  const token = await signTestToken(testConfig.jwtSecret, accountId)
  return { Authorization: `Bearer ${token}` }
}

const auditCtx = createServerContext(testConfig)

function gatewayApp() {
  return new Elysia().use(createOpenAIGatewayRoutes(testConfig, auditCtx))
}

function generateApp() {
  return new Elysia().use(createGenerateRoutes(testConfig, auditCtx))
}

// ─── 测试 ──────────────────────────────────────────────

describe('审计钩子路由', () => {
  let auditCapture: ReturnType<typeof mock<(entry: AuditEntry) => Promise<void>>>

  beforeEach(async () => {
    auditCapture = mock<(entry: AuditEntry) => Promise<void>>(() => Promise.resolve())
    setAuditWriter(auditCapture)

    // 清除上一个测试遗留的调用计数（mockImplementation 不清 history）
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
      mockCancelRecord,
      mockResetToPending,
      mockFindDedupe,
      mockGetFiles,
      mockNotifyStatus,
      mockGenerate,
      mockChatCompletion,
    ]) {
      m.mockClear()
    }

    // 重置 db/provider mock 到成功默认值
    mockCreateRecord.mockImplementation(() => Promise.resolve(mockRecord))
    mockGetRecordById.mockImplementation(() => Promise.resolve(null))
    mockMarkFailed.mockImplementation(() => Promise.resolve(undefined))
    mockMarkProcessing.mockImplementation(() => Promise.resolve(undefined))
    mockMarkSucceeded.mockImplementation(() => Promise.resolve(undefined))
    mockReserveCredit.mockImplementation(() => Promise.resolve(undefined))
    mockDebitCredit.mockImplementation(() => Promise.resolve(undefined))
    mockRefundCredit.mockImplementation(() => Promise.resolve(undefined))
    mockCancelRecord.mockImplementation(() => Promise.resolve(undefined))
    mockResetToPending.mockImplementation(() => Promise.resolve(undefined))
    mockNotifyStatus.mockImplementation(() => Promise.resolve(undefined))
    mockGenerate.mockImplementation(() => Promise.resolve({ success: true, output: { text: 'ok' }, usage: { inputTokens: 5, outputTokens: 7 } }))
    mockChatCompletion.mockImplementation(() => Promise.resolve({
      success: true,
      output: { text: 'Hello!' },
      usage: { inputTokens: 10, outputTokens: 20 },
    }))
  })

  afterEach(() => {
    resetAuditWriter()
  })

  // ═══════════════════════════════════════════════════
  //  OpenAI 网关 — gateway_call + credit 三件套
  // ═══════════════════════════════════════════════════

  describe('OpenAI 网关审计', () => {
    it('成功时记录 gateway_call(succeeded) + credit_reserve + credit_debit', async () => {
      const headers = await getAuthHeaders()
      const client = treaty(gatewayApp())

      await client.v1.chat.completions.post({
        model: 'qwen-max',
        messages: [{ role: 'user', content: '你好' }],
      }, { headers })

      expect(auditCapture).toHaveBeenCalledWith(expect.objectContaining({
        action: 'credit_reserve',
        detail: expect.objectContaining({ source: 'gateway', amountCents: 1 }),
      }))
      expect(auditCapture).toHaveBeenCalledWith(expect.objectContaining({
        action: 'credit_debit',
        detail: expect.objectContaining({ source: 'gateway', amountCents: 1 }),
      }))
      expect(auditCapture).toHaveBeenCalledWith(expect.objectContaining({
        action: 'gateway_call',
        detail: expect.objectContaining({ model: 'qwen-max', status: 'succeeded', inputTokens: 10, outputTokens: 20 }),
      }))
    })

    it('失败时记录 gateway_call(failed) + credit_refund', async () => {
      mockChatCompletion.mockImplementation(() => Promise.resolve({ success: false, error: 'provider down' }))

      const headers = await getAuthHeaders()
      const client = treaty(gatewayApp())

      await client.v1.chat.completions.post({
        model: 'qwen-max',
        messages: [{ role: 'user', content: '你好' }],
      }, { headers })

      expect(auditCapture).toHaveBeenCalledWith(expect.objectContaining({
        action: 'credit_refund',
        detail: expect.objectContaining({ source: 'gateway' }),
      }))
      expect(auditCapture).toHaveBeenCalledWith(expect.objectContaining({
        action: 'gateway_call',
        detail: expect.objectContaining({ model: 'qwen-max', status: 'failed', error: 'provider down' }),
      }))
      // 成功路径的 debit/gateway_call(succeeded) 不应出现
      expect(auditCapture).not.toHaveBeenCalledWith(expect.objectContaining({
        action: 'credit_debit',
      }))
    })
  })

  // ═══════════════════════════════════════════════════
  //  Generate 重试 / 取消
  // ═══════════════════════════════════════════════════

  describe('generate 重试审计', () => {
    it('重试失败任务时记录 generation_retry + credit_reserve(retry)', async () => {
      mockGetRecordById.mockResolvedValue(makeFailedRecord())
      mockResetToPending.mockResolvedValue(makeFailedRecord())
      mockGenerate.mockResolvedValue({ success: true, output: { text: '重试结果' }, usage: { inputTokens: 10, outputTokens: 20 } })

      const headers = await getAuthHeaders()
      const client = treaty(generateApp())

      await client.api.records({ id: 'rec-failed-001' }).retry.post(null, { headers })

      expect(auditCapture).toHaveBeenCalledWith(expect.objectContaining({
        action: 'generation_retry',
        accountId: 'acc-001',
        targetId: 'rec-failed-001',
        detail: expect.objectContaining({ recordId: 'rec-failed-001', model: 'qwen-max', previousStatus: 'failed' }),
      }))
      expect(auditCapture).toHaveBeenCalledWith(expect.objectContaining({
        action: 'credit_reserve',
        detail: expect.objectContaining({ source: 'retry', amountCents: 1 }),
      }))
    })

    it('校验失败（非 failed 状态）时不记录 generation_retry', async () => {
      mockGetRecordById.mockResolvedValue(makeFailedRecord({ status: 'succeeded' }))

      const headers = await getAuthHeaders()
      const client = treaty(generateApp())

      await client.api.records({ id: 'rec-001' }).retry.post(null, { headers })

      expect(auditCapture).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'generation_retry' }))
      expect(mockResetToPending).not.toHaveBeenCalled()
    })
  })

  describe('generate 取消审计', () => {
    it('取消 processing 任务时记录 generation_cancel', async () => {
      const record = makeProcessingRecord({ cost: { unit: 'video', totalPriceCents: 1, totalPrice: 0.01 } })
      mockGetRecordById
        .mockResolvedValueOnce(record)
        .mockResolvedValueOnce({ ...record, status: 'failed', errorMessage: '用户取消' })

      const headers = await getAuthHeaders()
      const client = treaty(generateApp())

      await client.api.records({ id: 'rec-proc-001' }).cancel.post(null, { headers })

      expect(auditCapture).toHaveBeenCalledWith(expect.objectContaining({
        action: 'generation_cancel',
        accountId: 'acc-001',
        targetId: 'rec-proc-001',
        detail: expect.objectContaining({ recordId: 'rec-proc-001', previousStatus: 'processing' }),
      }))
    })

    it('已完成任务不能取消 → 不记录 generation_cancel', async () => {
      mockGetRecordById.mockResolvedValue(makeProcessingRecord({ status: 'succeeded' }))

      const headers = await getAuthHeaders()
      const client = treaty(generateApp())

      await client.api.records({ id: 'rec-001' }).cancel.post(null, { headers })

      expect(auditCapture).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'generation_cancel' }))
      expect(mockCancelRecord).not.toHaveBeenCalled()
    })
  })
})
