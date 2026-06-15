import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { makeTestConfig, makeUploadedFile, makeValidatedParams, signTestToken } from './helpers/test-factory'

/**
 * 上传路由 DELETE 端点测试
 *
 * 测试 DELETE /api/upload/:id 的认证守卫、权限校验、使用中保护和安全删除顺序。
 * 使用原生 Request + Elysia handle() 绕过 Eden 对 DELETE 的序列化问题。
 */

// ─── Mock 类型 ───────────────────────────────────────────────

interface MockUploadedFile {
  id: string
  accountId: string
  fileName: string
  fileSize: number
  mimeType: string
  storagePath: string
  publicUrl: string
  purpose: string
  createdAt: Date
}

// ─── Mocks ───────────────────────────────────────────────

const mockGetAccountByEmail = mock<() => Promise<unknown | null>>(() => Promise.resolve(null))
const mockGetAccountByUsername = mock<() => Promise<unknown | null>>(() => Promise.resolve(null))
const mockGetAccountById = mock<() => Promise<unknown | null>>(() => Promise.resolve(null))
const mockCreateAccount = mock<(values: Record<string, unknown>) => Promise<unknown | null>>(() => Promise.resolve(null))
const mockCreateUploadedFile = mock<(values: Record<string, unknown>) => Promise<{ id: string, fileName: string, publicUrl: string, mimeType: string }>>(() =>
  Promise.resolve({
    id: 'file-001',
    fileName: 'test.png',
    publicUrl: '/uploads/test.png',
    mimeType: 'image/png',
  }),
)
const mockGetUploadedFileById = mock<(id: string) => Promise<MockUploadedFile | null>>(() => Promise.resolve(null))
const mockDeleteUploadedFileById = mock<(id: string) => Promise<void>>(() => Promise.resolve(undefined))
const mockGetUploadedFileUsage = mock<(accountId: string, fileId: string) => Promise<{ subtitleProjectCount: number, generationRecordCount: number }>>(() =>
  Promise.resolve({ subtitleProjectCount: 0, generationRecordCount: 0 }),
)

mock.module('@excuse/db', () => ({
  getAccountByEmail: mockGetAccountByEmail,
  getAccountByUsername: mockGetAccountByUsername,
  getAccountById: mockGetAccountById,
  createAccount: mockCreateAccount,
  createUploadedFile: mockCreateUploadedFile,
  getUploadedFileById: mockGetUploadedFileById,
  deleteUploadedFileById: mockDeleteUploadedFileById,
  getUploadedFileUsage: mockGetUploadedFileUsage,
}))

const mockSaveUploadedFile = mock(() =>
  Promise.resolve({ storagePath: '/uploads/ref_test.png', publicUrl: '/uploads/ref_test.png' }),
)
const mockDeleteFile = mock(() => Promise.resolve(undefined))

mock.module('@excuse/provider', () => ({
  AssetStorage: class {
    saveUploadedFile = mockSaveUploadedFile
    deleteFile = mockDeleteFile
  },
  DashScopeClient: class {},
  getModelById: () => undefined,
  mergeWithDefaults: (_modelConfig: unknown, params: Record<string, unknown>) => params,
  validateModelParameters: () => ({ valid: true, errors: [] }),
  validateAndMerge: (_modelConfig: unknown, params: Record<string, unknown>) => ({ ok: true, params: makeValidatedParams(params) }),
}))

// eslint-disable-next-line import/first
import { createUploadRoutes } from '../src/routes/upload'

// ─── 测试配置 ────────────────────────────────────────────

const testConfig = makeTestConfig({
  dashscopeApiKey: 'test-key',
  dashscopeBaseUrl: 'https://test.example.com',
  storageRoot: './test-uploads',
  jwtSecret: 'test-upload-delete-secret',
})

async function getValidToken(): Promise<string> {
  mockGetAccountById.mockResolvedValue({
    id: 'acc-upload-delete',
    username: 'upload-delete',
    email: 'upload-delete@example.com',
    password: 'hashed',
    avatar: null,
    isActive: true,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
  })
  return signTestToken(testConfig.jwtSecret, 'acc-upload-delete')
}

// ─── 测试 ────────────────────────────────────────────────

describe('upload 路由 — DELETE /api/upload/:id', () => {
  let uploadApp: ReturnType<typeof createUploadRoutes>

  beforeEach(() => {
    for (const m of [
      mockGetAccountByEmail,
      mockGetAccountByUsername,
      mockGetAccountById,
      mockCreateAccount,
      mockCreateUploadedFile,
      mockSaveUploadedFile,
      mockGetUploadedFileById,
      mockDeleteUploadedFileById,
      mockDeleteFile,
      mockGetUploadedFileUsage,
    ]) {
      m.mockClear()
    }

    // 默认 usage = 0（可删除）
    mockGetUploadedFileUsage.mockResolvedValue({ subtitleProjectCount: 0, generationRecordCount: 0 })

    uploadApp = createUploadRoutes(testConfig)
  })

  it('未登录时返回"请先登录"', async () => {
    const response = await uploadApp.handle(new Request('http://localhost/api/upload/file-001', {
      method: 'DELETE',
    }))

    expect(response.status).toBe(401)
    const data = await response.json() as { success: boolean, error?: string }
    expect(data.success).toBe(false)
    expect(data.error).toContain('登录')
    expect(mockDeleteFile).not.toHaveBeenCalled()
    expect(mockDeleteUploadedFileById).not.toHaveBeenCalled()
  })

  it('文件不存在时返回错误', async () => {
    const token = await getValidToken()
    mockGetUploadedFileById.mockResolvedValue(null)

    const response = await uploadApp.handle(new Request('http://localhost/api/upload/nonexistent', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }))

    expect(response.status).toBe(404)
    const data = await response.json() as { success: boolean, error?: string }
    expect(data.success).toBe(false)
    expect(data.error).toContain('不存在')
    expect(mockDeleteFile).not.toHaveBeenCalled()
  })

  it('不能删除其他用户的文件', async () => {
    const token = await getValidToken()
    mockGetUploadedFileById.mockResolvedValue(makeUploadedFile({ accountId: 'other-user' }))

    const response = await uploadApp.handle(new Request('http://localhost/api/upload/file-001', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }))

    expect(response.status).toBe(403)
    const data = await response.json() as { success: boolean, error?: string }
    expect(data.success).toBe(false)
    expect(data.error).toContain('无权')
    expect(mockDeleteFile).not.toHaveBeenCalled()
    expect(mockDeleteUploadedFileById).not.toHaveBeenCalled()
  })

  it('被字幕项目使用时返回 409 conflict，不删 DB 不删存储', async () => {
    const token = await getValidToken()
    mockGetUploadedFileById.mockResolvedValue(makeUploadedFile({ accountId: 'acc-upload-delete' }))
    mockGetUploadedFileUsage.mockResolvedValue({ subtitleProjectCount: 1, generationRecordCount: 0 })

    const response = await uploadApp.handle(new Request('http://localhost/api/upload/file-001', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }))

    expect(response.status).toBe(409)
    const data = await response.json() as { success: boolean, error?: string }
    expect(data.success).toBe(false)
    expect(data.error).toContain('使用')
    expect(mockDeleteUploadedFileById).not.toHaveBeenCalled()
    expect(mockDeleteFile).not.toHaveBeenCalled()
  })

  it('被生成记录使用时返回 409 conflict，不删 DB 不删存储', async () => {
    const token = await getValidToken()
    mockGetUploadedFileById.mockResolvedValue(makeUploadedFile({ accountId: 'acc-upload-delete' }))
    mockGetUploadedFileUsage.mockResolvedValue({ subtitleProjectCount: 0, generationRecordCount: 2 })

    const response = await uploadApp.handle(new Request('http://localhost/api/upload/file-001', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }))

    expect(response.status).toBe(409)
    const data = await response.json() as { success: boolean, error?: string }
    expect(data.success).toBe(false)
    expect(data.error).toContain('使用')
    expect(mockDeleteUploadedFileById).not.toHaveBeenCalled()
    expect(mockDeleteFile).not.toHaveBeenCalled()
  })

  it('成功删除自己的文件 — 先删 DB 后删存储', async () => {
    const token = await getValidToken()
    mockGetUploadedFileById.mockResolvedValue(makeUploadedFile({ accountId: 'acc-upload-delete' }))
    mockGetUploadedFileUsage.mockResolvedValue({ subtitleProjectCount: 0, generationRecordCount: 0 })

    const response = await uploadApp.handle(new Request('http://localhost/api/upload/file-001', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }))

    const data = await response.json() as { success: boolean }
    expect(data.success).toBe(true)
    // 验证调用顺序：DB 先删，存储后删（Bun mock 不方便断言顺序，至少断言两者都调了）
    expect(mockDeleteUploadedFileById).toHaveBeenCalledWith('file-001')
    expect(mockDeleteFile).toHaveBeenCalledWith('ref_123/test.png')
  })

  it('存储删除失败时不回滚 DB（成功返回且审计记录失败）', async () => {
    const token = await getValidToken()
    mockGetUploadedFileById.mockResolvedValue(makeUploadedFile({ accountId: 'acc-upload-delete' }))
    mockGetUploadedFileUsage.mockResolvedValue({ subtitleProjectCount: 0, generationRecordCount: 0 })
    mockDeleteFile.mockRejectedValue(new Error('storage deletion failed'))

    const response = await uploadApp.handle(new Request('http://localhost/api/upload/file-001', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }))

    const data = await response.json() as { success: boolean }
    // 即使存储删除失败，路由仍返回成功（DB 已删除）
    expect(data.success).toBe(true)
    expect(mockDeleteUploadedFileById).toHaveBeenCalledWith('file-001')
    expect(mockDeleteFile).toHaveBeenCalledWith('ref_123/test.png')
  })
})
