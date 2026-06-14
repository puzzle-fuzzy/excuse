import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'

/**
 * 资产标签 CRUD 路由测试 — GET / POST / DELETE /api/asset-tags
 *
 * Mock @excuse/db 的 tag CRUD 函数，验证：
 *   - 认证守卫（401）
 *   - accountId 隔离（mock 收到当前 userId）
 *   - GET 列表序列化（Date → ISO）
 *   - POST 重名 23505 → 409
 *   - POST 空名 / 超长 → 422
 *   - DELETE 幂等
 */

import { createAssetTagRoutes } from '../src/routes/asset-tags'
import { makeTestConfig, signTestToken } from './helpers/test-factory'

// ─── Mocks ───────────────────────────────────────────────

interface AssetTagRowFixture {
  id: string
  accountId: string
  name: string
  createdAt: Date
}

const mockListAssetTags = mock<(accountId: string) => Promise<AssetTagRowFixture[]>>(() => Promise.resolve([]))
const mockCreateAssetTag = mock<(opts: { accountId: string, name: string }) => Promise<AssetTagRowFixture>>(() => Promise.resolve({
  id: 'tag-001',
  accountId: 'acc-001',
  name: '高亮',
  createdAt: new Date('2024-01-01T00:00:00Z'),
}))
const mockDeleteAssetTag = mock<(opts: { accountId: string, tagId: string }) => Promise<void>>(() => Promise.resolve())

mock.module('@excuse/db', () => ({
  listAssetTags: mockListAssetTags,
  createAssetTag: mockCreateAssetTag,
  deleteAssetTag: mockDeleteAssetTag,
}))

// ─── 测试配置 ────────────────────────────────────────────

const testConfig = makeTestConfig({ jwtSecret: 'test-asset-tags-secret' })

async function getAuthToken(): Promise<string> {
  return signTestToken(testConfig.jwtSecret, 'acc-001')
}

const AUTH = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } })

// ─── 测试 ────────────────────────────────────────────────

describe('asset-tags routes', () => {
  let app: ReturnType<typeof createAssetTagRoutes>
  let token: string

  beforeAll(async () => {
    token = await getAuthToken()
  })

  beforeEach(() => {
    mockListAssetTags.mockClear()
    mockCreateAssetTag.mockClear()
    mockDeleteAssetTag.mockClear()
    mockListAssetTags.mockResolvedValue([])
    app = createAssetTagRoutes(testConfig)
  })

  it('未登录时返回 401', async () => {
    const res = await app.handle(new Request('http://localhost/api/asset-tags/'))
    expect(res.status).toBe(401)
    expect(mockListAssetTags).not.toHaveBeenCalled()
  })

  describe('GET /api/asset-tags/', () => {
    it('空列表 → items=[]', async () => {
      mockListAssetTags.mockResolvedValueOnce([])

      const res = await app.handle(new Request('http://localhost/api/asset-tags/', {
        headers: { Authorization: `Bearer ${token}` },
      }))
      const body = await res.json()
      expect(res.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.items).toEqual([])
      expect(mockListAssetTags).toHaveBeenCalledWith('acc-001')
    })

    it('列表项 createdAt 序列化为 ISO 字符串', async () => {
      mockListAssetTags.mockResolvedValueOnce([
        { id: 'tag-1', accountId: 'acc-001', name: '高亮', createdAt: new Date('2024-06-01T00:00:00Z') },
      ])

      const res = await app.handle(new Request('http://localhost/api/asset-tags/', {
        headers: { Authorization: `Bearer ${token}` },
      }))
      const body = await res.json()
      expect(body.items).toHaveLength(1)
      expect(body.items[0].createdAt).toBe('2024-06-01T00:00:00.000Z')
    })
  })

  describe('POST /api/asset-tags/', () => {
    it('POST { name: " 高亮 " } → 200，data.name="高亮"（trim 验证）', async () => {
      mockCreateAssetTag.mockResolvedValueOnce({
        id: 'tag-1',
        accountId: 'acc-001',
        name: '高亮',
        createdAt: new Date('2024-06-01T00:00:00Z'),
      })

      const res = await app.handle(new Request('http://localhost/api/asset-tags/', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: ' 高亮 ' }),
      }))
      const body = await res.json()
      expect(res.status).toBe(200)
      expect(body.data.name).toBe('高亮')
      expect(mockCreateAssetTag).toHaveBeenCalledWith({ accountId: 'acc-001', name: '高亮' })
    })

    it('POST 同名 → 409 conflict', async () => {
      // DrizzleQueryError 把 PG 错误码放在 cause.code
      const err = new Error('unique violation') as Error & { cause?: { code?: string } }
      err.cause = { code: '23505' }
      mockCreateAssetTag.mockRejectedValueOnce(err)

      const res = await app.handle(new Request('http://localhost/api/asset-tags/', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '高亮' }),
      }))
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.error).toMatch(/已存在/)
    })

    it('POST 空名（trim 后空）→ 422', async () => {
      const res = await app.handle(new Request('http://localhost/api/asset-tags/', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '   ' }),
      }))
      expect(res.status).toBe(422)
      expect(mockCreateAssetTag).not.toHaveBeenCalled()
    })

    it('POST 超长名（> 32 字符）→ 422', async () => {
      const longName = 'a'.repeat(33)
      const res = await app.handle(new Request('http://localhost/api/asset-tags/', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: longName }),
      }))
      expect(res.status).toBe(422)
      expect(mockCreateAssetTag).not.toHaveBeenCalled()
    })

    it('POST 非预期错误（非 23505）→ 抛出由 Elysia 兜底 500', async () => {
      mockCreateAssetTag.mockRejectedValueOnce(new Error('connection refused'))

      const res = await app.handle(new Request('http://localhost/api/asset-tags/', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'x' }),
      }))
      expect(res.status).toBe(500)
    })
  })

  describe('DELETE /api/asset-tags/:id', () => {
    it('DELETE 存在的 id → 200', async () => {
      const res = await app.handle(new Request('http://localhost/api/asset-tags/tag-1', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }))
      const body = await res.json()
      expect(res.status).toBe(200)
      expect(body.success).toBe(true)
      expect(mockDeleteAssetTag).toHaveBeenCalledWith({ accountId: 'acc-001', tagId: 'tag-1' })
    })

    it('DELETE 不存在的 id → 200（幂等）', async () => {
      const res = await app.handle(new Request('http://localhost/api/asset-tags/non-existent', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }))
      expect(res.status).toBe(200)
      // deleteAssetTag 仍然被调用（route 不预检存在性）
      expect(mockDeleteAssetTag).toHaveBeenCalledWith({ accountId: 'acc-001', tagId: 'non-existent' })
    })
  })
})
