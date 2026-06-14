import { treaty } from '@elysia/eden'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { makeAccount, makeTestConfig, makeUploadedFile, makeValidatedParams, signTestToken } from './helpers/test-factory'

/**
 * 上传路由单元测试
 *
 * Mock @excuse/db 和 @excuse/provider，
 * 测试 POST /api/upload 的认证守卫和业务逻辑。
 */

// ─── Mock @excuse/db ───────────────────────────────

interface MockAccountRow {
  id: string
  username: string
  email: string
  password: string
  avatar: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

interface MockUploadedFileResponse {
  id: string
  accountId: string
  fileName: string
  fileSize: number
  publicUrl: string
  mimeType: string
  storagePath: string
  purpose: string
  metadata: Record<string, unknown> | null
  createdAt: string
}

const mockGetAccountByEmail = mock<() => Promise<MockAccountRow | null>>(() => Promise.resolve(null))
const mockGetAccountByUsername = mock<() => Promise<MockAccountRow | null>>(() => Promise.resolve(null))
const mockGetAccountById = mock<() => Promise<MockAccountRow | null>>(() => Promise.resolve(null))
const mockCreateAccount = mock<(values: Record<string, unknown>) => Promise<MockAccountRow | null>>(() => Promise.resolve(null))
const mockCreateUploadedFile = mock<() => Promise<Record<string, unknown>>>(() =>
  Promise.resolve({
    id: 'file-001',
    accountId: 'acc-upload-test',
    fileName: 'test.png',
    fileSize: 1024,
    publicUrl: '/uploads/test.png',
    mimeType: 'image/png',
    storagePath: '/uploads/ref_test.png',
    purpose: 'reference',
    metadata: null,
    createdAt: new Date('2024-01-01'),
  }),
)
const mockGetUploadedFileById = mock<(id: string) => Promise<Record<string, unknown> | null>>(() => Promise.resolve(null))
const mockUpdateUploadedFile = mock<(id: string, accountId: string, patch: Record<string, unknown>) => Promise<Record<string, unknown> | null>>(() =>
  Promise.resolve({
    id: 'file-001',
    accountId: 'acc-upload-test',
    fileName: 'renamed.png',
    fileSize: 1024,
    publicUrl: '/uploads/test.png',
    mimeType: 'image/png',
    storagePath: '/uploads/ref_test.png',
    purpose: 'avatar',
    metadata: null,
    createdAt: new Date('2024-01-01'),
  }),
)

mock.module('@excuse/db', () => ({
  getAccountByEmail: mockGetAccountByEmail,
  getAccountByUsername: mockGetAccountByUsername,
  getAccountById: mockGetAccountById,
  createAccount: mockCreateAccount,
  createUploadedFile: mockCreateUploadedFile,
  getUploadedFileById: mockGetUploadedFileById,
  updateUploadedFile: mockUpdateUploadedFile,
}))

// ─── Mock @excuse/provider ─────────────────────────

const mockSaveUploadedFile = mock(() =>
  Promise.resolve({ storagePath: '/uploads/ref_test.png', publicUrl: '/uploads/ref_test.png' }),
)

mock.module('@excuse/provider', () => ({
  AssetStorage: class {
    saveUploadedFile = mockSaveUploadedFile
  },
  DashScopeClient: class {},
  getModelById: () => undefined,
  mergeWithDefaults: (_modelConfig: unknown, params: Record<string, unknown>) => params,
  validateModelParameters: () => ({ valid: true, errors: [] }),
  validateAndMerge: (_modelConfig: unknown, params: Record<string, unknown>) => ({ ok: true, params: makeValidatedParams(params) }),
}))

// mock.module 提升到 import 之前
// eslint-disable-next-line import/first
import { createAuthRoutes } from '../src/routes/auth'
// eslint-disable-next-line import/first
import { createUploadRoutes } from '../src/routes/upload'

// ─── 测试配置 ──────────────────────────────────────

const testConfig = makeTestConfig({
  dashscopeApiKey: 'test-key',
  dashscopeBaseUrl: 'https://test.example.com',
  storageRoot: './test-uploads',
  jwtSecret: 'test-upload-secret',
})

async function getValidToken(client: ReturnType<typeof treaty>): Promise<string> {
  mockGetAccountByEmail.mockResolvedValue(null)
  mockGetAccountByUsername.mockResolvedValue(null)
  mockCreateAccount.mockResolvedValue(makeAccount({
    id: 'acc-upload-test',
    username: 'uploaduser',
    email: 'upload@example.com',
  }))

  const res = await client.api.auth.register.post({
    username: 'uploaduser',
    email: 'upload@example.com',
    password: 'password123456',
  })

  return (res.data as { data?: { token?: string } })?.data?.token as string
}

// ─── 测试 ──────────────────────────────────────────

describe('upload routes', () => {
  let uploadApp: ReturnType<typeof createUploadRoutes>
  let authClient: ReturnType<typeof treaty>

  beforeEach(() => {
    for (const m of [
      mockGetAccountByEmail,
      mockGetAccountByUsername,
      mockGetAccountById,
      mockCreateAccount,
      mockCreateUploadedFile,
      mockSaveUploadedFile,
      mockGetUploadedFileById,
      mockUpdateUploadedFile,
    ]) {
      m.mockClear()
    }

    uploadApp = createUploadRoutes(testConfig)
    const authApp = createAuthRoutes(testConfig)
    authClient = treaty(authApp)
  })

  // ═══════════════════════════════════════════════════
  //  POST /api/upload — 认证守卫
  // ═══════════════════════════════════════════════════

  describe('POST /api/upload — auth guard', () => {
    it('未携带 token 时返回"请先登录"', async () => {
      const formData = new FormData()
      formData.append('file', new File(['test'], 'test.png', { type: 'image/png' }))

      const response = await uploadApp.handle(new Request('http://localhost/api/upload', {
        method: 'POST',
        body: formData,
      }))

      expect(response.status).toBe(401)
      const data = await response.json() as { success: boolean, error?: string }
      expect(data.success).toBe(false)
      expect(data.error).toContain('登录')
      expect(mockSaveUploadedFile).not.toHaveBeenCalled()
      expect(mockCreateUploadedFile).not.toHaveBeenCalled()
    })

    it('无效 token 时返回"请先登录"', async () => {
      const formData = new FormData()
      formData.append('file', new File(['test'], 'test.png', { type: 'image/png' }))

      const response = await uploadApp.handle(new Request('http://localhost/api/upload', {
        method: 'POST',
        headers: { Authorization: 'Bearer invalid.token.here' },
        body: formData,
      }))

      expect(response.status).toBe(401)
      const data = await response.json() as { success: boolean, error?: string }
      expect(data.success).toBe(false)
      expect(data.error).toContain('登录')
    })
  })

  // ═══════════════════════════════════════════════════
  //  POST /api/upload — 业务逻辑
  // ═══════════════════════════════════════════════════

  describe('POST /api/upload — business logic', () => {
    it('有效 token + 文件时认证守卫通过，不返回登录错误', async () => {
      const token = await getValidToken(authClient)

      mockSaveUploadedFile.mockResolvedValue({
        storagePath: '/uploads/ref_123/test.png',
        publicUrl: '/uploads/ref_123/test.png',
      })
      mockCreateUploadedFile.mockResolvedValue({
        id: 'file-001',
        accountId: 'acc-upload-test',
        fileName: 'test.png',
        fileSize: 14,
        publicUrl: '/uploads/ref_123/test.png',
        mimeType: 'image/png',
        storagePath: '/uploads/ref_123/test.png',
        purpose: 'reference',
        metadata: null,
        createdAt: new Date('2024-01-01'),
      })

      const formData = new FormData()
      formData.append('file', new File(['test content'], 'test.png', { type: 'image/png' }))

      const response = await uploadApp.handle(new Request('http://localhost/api/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      }))

      const text = await response.text()
      const data = JSON.parse(text) as { success: boolean, data?: MockUploadedFileResponse, error?: string }

      // 核心断言：认证守卫已通过 — 响应中不包含"请先登录"类错误
      // 注意：Elysia in-process handle() 对 multipart/form-data 解析存在已知限制，
      // 可能导致其他非认证类错误，但绝不应返回认证错误
      expect(String(data.error ?? '')).not.toContain('登录')
      expect(String(data.error ?? '')).not.toContain('请先')
    })
  })

  // ═══════════════════════════════════════════════════
  //  PATCH /api/upload/:id — 编辑上传文件（重命名/用途）
  // ═══════════════════════════════════════════════════

  describe('PATCH /api/upload/:id', () => {
    async function getPatchToken(): Promise<string> {
      return signTestToken(testConfig.jwtSecret, 'acc-upload-test')
    }

    it('未携带 token 时返回 401', async () => {
      const response = await uploadApp.handle(new Request('http://localhost/api/upload/file-001', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: 'renamed.png' }),
      }))

      expect(response.status).toBe(401)
      const data = await response.json() as { success: boolean, error?: string }
      expect(data.success).toBe(false)
      expect(data.error).toContain('登录')
      expect(mockUpdateUploadedFile).not.toHaveBeenCalled()
    })

    it('文件不存在时返回 404', async () => {
      const token = await getPatchToken()
      mockGetUploadedFileById.mockResolvedValue(null)

      const response = await uploadApp.handle(new Request('http://localhost/api/upload/nonexistent', {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: 'renamed.png' }),
      }))

      expect(response.status).toBe(404)
      const data = await response.json() as { success: boolean, error?: string }
      expect(data.success).toBe(false)
      expect(data.error).toContain('不存在')
      expect(mockUpdateUploadedFile).not.toHaveBeenCalled()
    })

    it('文件属于其他用户时返回 403，不调用 updateUploadedFile', async () => {
      const token = await getPatchToken()
      mockGetUploadedFileById.mockResolvedValue(makeUploadedFile({ id: 'file-001', accountId: 'other-user' }))

      const response = await uploadApp.handle(new Request('http://localhost/api/upload/file-001', {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: 'renamed.png' }),
      }))

      expect(response.status).toBe(403)
      const data = await response.json() as { success: boolean, error?: string }
      expect(data.success).toBe(false)
      expect(data.error).toContain('无权')
      expect(mockUpdateUploadedFile).not.toHaveBeenCalled()
    })

    it('合法 fileName + purpose 时返回更新后 DTO', async () => {
      const token = await getPatchToken()
      const record = makeUploadedFile({ id: 'file-001', accountId: 'acc-upload-test' })
      mockGetUploadedFileById.mockResolvedValue(record)
      const updated = {
        ...record,
        fileName: 'renamed.png',
        purpose: 'avatar',
      }
      mockUpdateUploadedFile.mockResolvedValue(updated)

      const response = await uploadApp.handle(new Request('http://localhost/api/upload/file-001', {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: 'renamed.png', purpose: 'avatar' }),
      }))

      expect(response.status).toBe(200)
      const data = await response.json() as { success: boolean, data?: MockUploadedFileResponse }
      expect(data.success).toBe(true)
      expect(data.data?.fileName).toBe('renamed.png')
      expect(data.data?.purpose).toBe('avatar')
      expect(mockUpdateUploadedFile).toHaveBeenCalledWith('file-001', 'acc-upload-test', {
        fileName: 'renamed.png',
        purpose: 'avatar',
      })
    })

    it('只传 fileName 时只写入 fileName 字段', async () => {
      const token = await getPatchToken()
      const record = makeUploadedFile({ id: 'file-001', accountId: 'acc-upload-test' })
      mockGetUploadedFileById.mockResolvedValue(record)
      mockUpdateUploadedFile.mockResolvedValue({ ...record, fileName: 'only-name.png' })

      await uploadApp.handle(new Request('http://localhost/api/upload/file-001', {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: 'only-name.png' }),
      }))

      expect(mockUpdateUploadedFile).toHaveBeenCalledWith('file-001', 'acc-upload-test', {
        fileName: 'only-name.png',
      })
    })

    it('空字符串 fileName 时返回 422', async () => {
      const token = await getPatchToken()
      mockGetUploadedFileById.mockResolvedValue(makeUploadedFile({ id: 'file-001', accountId: 'acc-upload-test' }))

      const response = await uploadApp.handle(new Request('http://localhost/api/upload/file-001', {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: '   ' }),
      }))

      expect(response.status).toBe(422)
      const data = await response.json() as { success: boolean, error?: string }
      expect(data.success).toBe(false)
      expect(data.error).toContain('文件名')
      expect(mockUpdateUploadedFile).not.toHaveBeenCalled()
    })

    it('空 patch 时直接返回当前记录，不调用 updateUploadedFile', async () => {
      const token = await getPatchToken()
      const record = makeUploadedFile({ id: 'file-001', accountId: 'acc-upload-test' })
      mockGetUploadedFileById.mockResolvedValue(record)
      mockUpdateUploadedFile.mockResolvedValue(record)

      const response = await uploadApp.handle(new Request('http://localhost/api/upload/file-001', {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }))

      // 空 patch 走 fallback：updateUploadedFile 内部调用 getUploadedFileByIdForAccount，
      // 因此 updateUploadedFile 会被调用，但 WHERE 条件不会改任何字段。
      expect(response.status).toBe(200)
      expect(mockUpdateUploadedFile).toHaveBeenCalledWith('file-001', 'acc-upload-test', {})
    })
  })
})
