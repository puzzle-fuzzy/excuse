import type { AccountRow } from '@excuse/db'
import { treaty } from '@elysia/eden'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { extractEdenError, makeAccount, makeTestConfig, makeValidatedParams } from './helpers/test-factory'

/**
 * 路由认证守卫测试
 *
 * 验证 generate 和 upload 路由在未认证时拒绝请求，
 * 在有效 JWT 下正确传递 userId。
 *
 * 使用 mock.module 模拟所有外部依赖，
 * 只测试认证守卫层的行为。
 */

// ─── Mock 类型 ──────────────────────────────────────────────

// ─── Mock 依赖 ─────────────────────────────────────

// @excuse/db — 账户查询 + 生成记录 + 上传文件
const mockGetAccountByEmail = mock<() => Promise<AccountRow | null>>(() => Promise.resolve(null))
const mockGetAccountByUsername = mock<() => Promise<AccountRow | null>>(() => Promise.resolve(null))
const mockGetAccountById = mock<() => Promise<AccountRow | null>>(() => Promise.resolve(null))
const mockCreateAccount = mock<(values: Record<string, unknown>) => Promise<AccountRow | null>>(() => Promise.resolve(null))
const mockCreateGenerationRecord = mock<(values: Record<string, unknown>) => Promise<{ id: string, taskId: string }>>(() =>
  Promise.resolve({ id: 'rec-001', taskId: 'task-001' }),
)
const mockListGenerationRecords = mock<(filter: Record<string, unknown>) => Promise<unknown[]>>(() => Promise.resolve([]))
const mockGetGenerationRecordById = mock<(id: string) => Promise<unknown | null>>(() => Promise.resolve(null))
const mockMarkGenerationFailed = mock<(id: string, error: string) => Promise<void>>(() => Promise.resolve(undefined))
const mockMarkGenerationProcessing = mock<(id: string, data: Record<string, unknown>) => Promise<void>>(() => Promise.resolve(undefined))
const mockMarkGenerationSucceeded = mock<(id: string, output: unknown, cost: unknown) => Promise<void>>(() => Promise.resolve(undefined))
const mockCreateUploadedFile = mock<() => Promise<Record<string, unknown>>>(() =>
  Promise.resolve({
    id: 'file-001',
    accountId: 'acc-guard-test',
    fileName: 'test.png',
    fileSize: 1024,
    publicUrl: '/uploads/test.png',
    mimeType: 'image/png',
    storagePath: '/uploads/test.png',
    purpose: 'reference',
    metadata: null,
    createdAt: new Date('2024-01-01'),
  }),
)
const mockNotifyStatus = mock<(payload: Record<string, unknown>) => Promise<void>>(() => Promise.resolve(undefined))
const mockGetUploadedFilesByIdsForAccount = mock<(ids: string[], accountId: string) => Promise<unknown[]>>(() => Promise.resolve([]))
const mockDeleteGenerationRecord = mock<(id: string) => Promise<void>>(() => Promise.resolve(undefined))
const mockCancelGenerationRecord = mock<(id: string) => Promise<void>>(() => Promise.resolve(undefined))
const mockResetGenerationToPending = mock<(id: string) => Promise<void>>(() => Promise.resolve(undefined))
const mockFindGenerationByDedupeKeyForAccount = mock<(key: string, accountId: string) => Promise<unknown | null>>(() => Promise.resolve(null))

mock.module('@excuse/db', () => ({
  getAccountByEmail: mockGetAccountByEmail,
  getAccountByUsername: mockGetAccountByUsername,
  getAccountById: mockGetAccountById,
  createAccount: mockCreateAccount,
  createGenerationRecord: mockCreateGenerationRecord,
  listGenerationRecords: mockListGenerationRecords,
  getGenerationRecordById: mockGetGenerationRecordById,
  markGenerationFailed: mockMarkGenerationFailed,
  markGenerationProcessing: mockMarkGenerationProcessing,
  markGenerationSucceeded: mockMarkGenerationSucceeded,
  createUploadedFile: mockCreateUploadedFile,
  notifyGenerationStatus: mockNotifyStatus,
  getUploadedFilesByIdsForAccount: mockGetUploadedFilesByIdsForAccount,
  deleteGenerationRecord: mockDeleteGenerationRecord,
  cancelGenerationRecord: mockCancelGenerationRecord,
  resetGenerationToPending: mockResetGenerationToPending,
  findGenerationByDedupeKeyForAccount: mockFindGenerationByDedupeKeyForAccount,
}))

// @excuse/provider — DashScope + AssetStorage
const mockGenerate = mock<(model: string, params: Record<string, unknown>, refs?: string[]) => Promise<{ success: boolean, error?: string }>>(() =>
  Promise.resolve({ success: false, error: 'mocked out' }),
)
const mockDownloadAndMap = mock(() =>
  Promise.resolve(['/uploads/img_0.png']),
)
const mockSaveUploadedFile = mock(() =>
  Promise.resolve({ storagePath: '/uploads/ref_test.png', publicUrl: '/uploads/ref_test.png' }),
)

mock.module('@excuse/provider', () => ({
  DashScopeClient: class {
    generate = mockGenerate
  },
  AssetStorage: class {
    downloadAndMap = mockDownloadAndMap
    saveUploadedFile = mockSaveUploadedFile
  },
  getModelById: mock(() => ({
    id: 'test-model',
    category: 'text',
    name: 'Test Model',
    parameters: [{ name: 'prompt', type: 'text', required: true }], // 最小参数声明，让 validateModelParameters 通过
  })),
  mergeWithDefaults: mock((_modelConfig: unknown, params: Record<string, unknown>) => params),
  validateModelParameters: mock(() => ({ valid: true, errors: [] })),
  validateAndMerge: mock((_modelConfig: unknown, params: Record<string, unknown>) => ({ ok: true, params: makeValidatedParams(params) })),
}))

// @excuse/billing
mock.module('@excuse/billing', () => ({
  calculateCost: mock(() => ({ totalPriceCents: 1, totalPrice: 0.01, estimated: true })),
}))

// ─── 在 mock 之后 import（Bun 会自动提升 mock.module 到 import 之前）──────
// eslint-disable-next-line import/first
import { createAuthRoutes } from '../src/routes/auth'
// eslint-disable-next-line import/first
import { createGenerateRoutes } from '../src/routes/generate'
// eslint-disable-next-line import/first
import { createUploadRoutes } from '../src/routes/upload'
// eslint-disable-next-line import/first
import { createServerContext } from '../src/context'

// ─── 测试配置 ──────────────────────────────────────

const testConfig = makeTestConfig({
  dashscopeApiKey: 'test-key',
  dashscopeBaseUrl: 'https://test.example.com',
  storageRoot: './test-uploads',
  jwtSecret: 'test-guard-secret',
})

// ─── 辅助：通过注册获取有效 token ─────────────────

async function getValidToken(client: ReturnType<typeof treaty>) {
  mockGetAccountByEmail.mockResolvedValue(null)
  mockGetAccountByUsername.mockResolvedValue(null)
  mockCreateAccount.mockResolvedValue(makeAccount({
    id: 'acc-guard-test',
    username: 'guarduser',
    email: 'guard@example.com',
  }))
  mockGetAccountById.mockResolvedValue(makeAccount({
    id: 'acc-guard-test',
    username: 'guarduser',
    email: 'guard@example.com',
  }))

  const res = await client.api.auth.register.post({
    username: 'guarduser',
    email: 'guard@example.com',
    password: 'password123456',
  })

  return (res.data as { data?: { token?: string } })?.data?.token as string
}

// ─── 测试 ──────────────────────────────────────────

describe('路由认证守卫', () => {
  let generateClient: ReturnType<typeof treaty>
  let _uploadClient: ReturnType<typeof treaty>
  let authClient: ReturnType<typeof treaty>

  beforeEach(() => {
    // 重置所有 mock
    for (const m of [
      mockGetAccountByEmail,
      mockGetAccountByUsername,
      mockGetAccountById,
      mockCreateAccount,
      mockCreateGenerationRecord,
      mockListGenerationRecords,
      mockGetGenerationRecordById,
      mockMarkGenerationFailed,
      mockMarkGenerationProcessing,
      mockMarkGenerationSucceeded,
      mockCreateUploadedFile,
      mockGenerate,
      mockDownloadAndMap,
      mockSaveUploadedFile,
    ]) {
      m.mockClear()
    }

    const ctx = createServerContext(testConfig)
    generateClient = treaty(createGenerateRoutes(testConfig, ctx))
    _uploadClient = treaty(createUploadRoutes(testConfig))
    authClient = treaty(createAuthRoutes(testConfig))
  })

  // ═══════════════════════════════════════════════════
  //  POST /api/generate
  // ═══════════════════════════════════════════════════

  describe('POST /api/generate — auth guard', () => {
    it('无 token 时拒绝请求', async () => {
      const res = await generateClient.api.generate.post({
        model: 'test-model',
        parameters: { prompt: 'test' },
      })

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(401)
      expect(err!.error).toContain('登录')
      // 不应调用 API
      expect(mockGenerate).not.toHaveBeenCalled()
      expect(mockCreateGenerationRecord).not.toHaveBeenCalled()
    })

    it('无效 token 时拒绝请求', async () => {
      const res = await generateClient.api.generate.post(
        { model: 'test-model', parameters: { prompt: 'test' } },
        { headers: { Authorization: 'Bearer invalid.token.here' } },
      )

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.error).toContain('登录')
    })

    it('有效 token 时接受请求并传递 userId', async () => {
      const token = await getValidToken(authClient)

      // 模拟 DashScope 返回失败（只测认证守卫，不测完整流程）
      mockGenerate.mockResolvedValue({
        success: false,
        error: 'API error',
      })
      mockMarkGenerationFailed.mockResolvedValue(undefined)

      const { data: _data } = await generateClient.api.generate.post(
        { model: 'test-model', parameters: { prompt: 'test' } },
        { headers: { Authorization: `Bearer ${token}` } },
      )

      // 应该通过了认证守卫（即使 API 调用失败，也不再是"请先登录"错误）
      // createGenerationRecord 应被调用，且 accountId 应为 token 中的 userId
      expect(mockCreateGenerationRecord).toHaveBeenCalledTimes(1)
      const createArg = mockCreateGenerationRecord.mock.calls[0][0]
      expect(createArg.accountId).toBe('acc-guard-test')
    })
  })

  // ═══════════════════════════════════════════════════
  //  GET /api/records
  // ═══════════════════════════════════════════════════

  describe('GET /api/records — auth guard', () => {
    it('无 token 时拒绝请求', async () => {
      const res = await generateClient.api.records.get()

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(401)
      expect(err!.error).toContain('登录')
      expect(mockListGenerationRecords).not.toHaveBeenCalled()
    })

    it('有效 token 时接受请求并按 userId 过滤', async () => {
      const token = await getValidToken(authClient)
      mockListGenerationRecords.mockResolvedValue([])

      await generateClient.api.records.get({
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(mockListGenerationRecords).toHaveBeenCalledTimes(1)
      const filterArg = mockListGenerationRecords.mock.calls[0][0]
      expect(filterArg.accountId).toBe('acc-guard-test')
    })
  })

  // ═══════════════════════════════════════════════════
  //  POST /api/upload
  // ═══════════════════════════════════════════════════

  describe('POST /api/upload — auth guard', () => {
    it('无 token 时拒绝请求', async () => {
      // 使用原生 Request 直接调用，绕过 Eden Treaty 的 FormData 序列化问题
      const uploadApp = createUploadRoutes(testConfig)
      const formData = new FormData()
      formData.append('file', new File(['test content'], 'test.png', { type: 'image/png' }))

      const response = await uploadApp.handle(new Request('http://localhost/api/upload', {
        method: 'POST',
        body: formData,
      }))

      // 现在 upload 路由返回 401 状态码
      expect(response.status).toBe(401)
      const data = await response.json() as { success: boolean, error?: string }
      expect(data.success).toBe(false)
      expect(data.error).toContain('登录')
      expect(mockSaveUploadedFile).not.toHaveBeenCalled()
      expect(mockCreateUploadedFile).not.toHaveBeenCalled()
    })

    it('有效 token 时接受请求并传递 userId', async () => {
      const token = await getValidToken(authClient)
      mockSaveUploadedFile.mockResolvedValue({
        storagePath: '/uploads/test.png',
        publicUrl: '/uploads/test.png',
      })
      mockCreateUploadedFile.mockResolvedValue({
        id: 'file-001',
        fileName: 'test.png',
        publicUrl: '/uploads/test.png',
        mimeType: 'image/png',
      })

      // 使用原生 Request 直接调用 Elysia handle
      const uploadApp = createUploadRoutes(testConfig)
      const formData = new FormData()
      formData.append('file', new File(['test content'], 'test.png', { type: 'image/png' }))

      const response = await uploadApp.handle(new Request('http://localhost/api/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      }))

      const text = await response.text()
      let data: Record<string, unknown>
      try {
        data = JSON.parse(text)
      }
      catch {
        data = { raw: text }
      }

      // 关键断言：认证守卫通过了 — 没有返回 "请先登录"
      const errorStr = String(data.error ?? data.raw ?? '')
      expect(errorStr).not.toContain('登录')
      expect(errorStr).not.toContain('请先')
    })
  })
})
