import type { ServerConfig } from '../src/config'
import { treaty } from '@elysia/eden'
import { createApiKeySecret } from '@excuse/auth'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { Elysia, t } from 'elysia'
import { createAuthPlugin } from '../src/plugins/auth'

/**
 * 认证插件单元测试
 *
 * 测试 createAuthPlugin 的核心功能：
 *   - 无 Bearer token → userId = null
 *   - 有效 JWT 且账号活跃 → userId 提取正确
 *   - 禁用/不存在账号 → userId = null
 *   - 无效 JWT → userId = null
 *   - 错误 secret 签发的 JWT → userId = null
 *   - 空 Bearer → userId = null
 */

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

interface MockApiKeyRow {
  id: string
  accountId: string
  scope: string
  rateLimitPerMinute: number | null
  totalSpendCents: number
  quotaMaxCents: number | null
  quotaResetAt: Date | null
}

function makeActiveAccount(id: string): MockAccountRow {
  return {
    id,
    username: 'active-user',
    email: `${id}@example.com`,
    password: 'hashed',
    avatar: null,
    isActive: true,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
  }
}

const mockGetAccountById = mock<(id: string) => Promise<MockAccountRow | null>>(async (id: string) => makeActiveAccount(id))
const mockFindApiKeyByHash = mock<() => Promise<MockApiKeyRow | null>>(async () => null)
const mockFindRevokedApiKeyByHash = mock<() => Promise<MockApiKeyRow | null>>(async () => null)
const mockTouchApiKeyLastUsed = mock(async () => undefined)

mock.module('@excuse/db', () => ({
  getAccountById: mockGetAccountById,
  findApiKeyByHash: mockFindApiKeyByHash,
  findRevokedApiKeyByHash: mockFindRevokedApiKeyByHash,
  touchApiKeyLastUsed: mockTouchApiKeyLastUsed,
}))

const testConfig: ServerConfig = {
  port: 0,
  databaseUrl: '',
  dashscopeApiKey: '',
  dashscopeBaseUrl: '',
  storageRoot: '',
  frontendUrl: '',
  workerPollIntervalMs: 0,
  jwtSecret: 'test-plugin-secret-key',
  jwtExpiresIn: '1h',
  oss: undefined,
  metricsAccessToken: undefined,
  metricsAllowedCidrs: ['127.0.0.1/32', '::1/128'],
}

/**
 * 构造测试用 Elysia 实例：
 *   - 注册 auth plugin（JWT + Bearer + derive userId）
 *   - /sign  签发测试 token
 *   - /check 返回当前 userId
 */
function createTestApp(config: ServerConfig = testConfig) {
  return new Elysia()
    .use(createAuthPlugin(config))
    .post('/sign', async ({ jwt, body }) => {
      const { sub } = body as { sub: string }
      const token = await jwt.sign({ sub })
      return { token }
    }, {
      body: t.Object({ sub: t.String() }),
    })
    .get('/check', ({ userId }) => ({ userId }))
}

describe('auth 插件 (createAuthPlugin)', () => {
  beforeEach(() => {
    mockGetAccountById.mockClear()
    mockFindApiKeyByHash.mockClear()
    mockFindRevokedApiKeyByHash.mockClear()
    mockTouchApiKeyLastUsed.mockClear()
    mockGetAccountById.mockImplementation(async (id: string) => makeActiveAccount(id))
    mockFindApiKeyByHash.mockResolvedValue(null)
    mockFindRevokedApiKeyByHash.mockResolvedValue(null)
    mockTouchApiKeyLastUsed.mockResolvedValue(undefined)
  })

  // ─── 无 Bearer token ────────────────────────────────

  it('无 Authorization header 时设置 userId=null', async () => {
    const app = createTestApp()
    const client = treaty(app)

    const { data, error } = await client.check.get()

    expect(error).toBeNull()
    expect(data).toEqual({ userId: null })
  })

  // ─── 有效 JWT ───────────────────────────────────────

  it('从有效 JWT 中提取 userId', async () => {
    const app = createTestApp()
    const client = treaty(app)

    // 先签发 token
    const signRes = await client.sign.post({ sub: 'user-abc-123' })
    const token = (signRes.data as { token?: string } | null)?.token
    expect(token).toBeDefined()

    // 带 token 请求
    const { data, error } = await client.check.get({
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(error).toBeNull()
    expect(data).toEqual({ userId: 'user-abc-123' })
    expect(mockGetAccountById).toHaveBeenCalledWith('user-abc-123')
  })

  it('JWT 对应账号不存在时设置 userId=null', async () => {
    mockGetAccountById.mockResolvedValueOnce(null)
    const app = createTestApp()
    const client = treaty(app)
    const signRes = await client.sign.post({ sub: 'missing-user' })
    const token = (signRes.data as { token?: string } | null)?.token

    const { data } = await client.check.get({
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(data).toEqual({ userId: null })
  })

  it('JWT 对应账号已禁用时设置 userId=null', async () => {
    mockGetAccountById.mockResolvedValueOnce({
      id: 'disabled-user',
      username: 'disabled-user',
      email: 'disabled@example.com',
      password: 'hashed',
      avatar: null,
      isActive: false,
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    })
    const app = createTestApp()
    const client = treaty(app)
    const signRes = await client.sign.post({ sub: 'disabled-user' })
    const token = (signRes.data as { token?: string } | null)?.token

    const { data } = await client.check.get({
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(data).toEqual({ userId: null })
  })

  it('API Key 对应活跃账号时注入 userId', async () => {
    const { key } = createApiKeySecret()
    mockFindApiKeyByHash.mockResolvedValueOnce({
      id: 'key-1',
      accountId: 'api-user',
      scope: 'gateway',
      rateLimitPerMinute: 60,
      totalSpendCents: 0,
      quotaMaxCents: null,
      quotaResetAt: null,
    })
    const app = createTestApp()
    const client = treaty(app)

    const { data } = await client.check.get({
      headers: { Authorization: `Bearer ${key}` },
    })

    expect(data).toEqual({ userId: 'api-user' })
    expect(mockTouchApiKeyLastUsed).toHaveBeenCalledWith('key-1')
  })

  it('API Key 对应账号已禁用时拒绝认证且不更新 lastUsedAt', async () => {
    const { key } = createApiKeySecret()
    mockFindApiKeyByHash.mockResolvedValueOnce({
      id: 'key-1',
      accountId: 'disabled-api-user',
      scope: 'gateway',
      rateLimitPerMinute: 60,
      totalSpendCents: 0,
      quotaMaxCents: null,
      quotaResetAt: null,
    })
    mockGetAccountById.mockResolvedValueOnce({
      id: 'disabled-api-user',
      username: 'disabled-api-user',
      email: 'disabled-api@example.com',
      password: 'hashed',
      avatar: null,
      isActive: false,
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    })
    const app = createTestApp()
    const client = treaty(app)

    const { data } = await client.check.get({
      headers: { Authorization: `Bearer ${key}` },
    })

    expect(data).toEqual({ userId: null })
    expect(mockTouchApiKeyLastUsed).not.toHaveBeenCalled()
  })

  // ─── 不同 sub 值 ────────────────────────────────────

  it('正确提取不同的 userId 值', async () => {
    const app = createTestApp()
    const client = treaty(app)

    for (const sub of ['user-1', 'a-real-uuid-like-value', 'x']) {
      const signRes = await client.sign.post({ sub })
      const token = (signRes.data as { token?: string } | null)?.token

      const { data } = await client.check.get({
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(data).toEqual({ userId: sub })
    }
  })

  // ─── 无效 JWT ───────────────────────────────────────

  it('畸形 JWT 时设置 userId=null', async () => {
    const app = createTestApp()
    const client = treaty(app)

    const { data, error } = await client.check.get({
      headers: { Authorization: 'Bearer this.is.not.a.real.jwt' },
    })

    expect(error).toBeNull()
    expect(data).toEqual({ userId: null })
  })

  // ─── 空 Bearer ──────────────────────────────────────

  it('空 Bearer 值时设置 userId=null', async () => {
    const app = createTestApp()
    const client = treaty(app)

    const { data, error } = await client.check.get({
      headers: { Authorization: 'Bearer ' },
    })

    expect(error).toBeNull()
    expect(data).toEqual({ userId: null })
  })

  // ─── 错误 secret ───────────────────────────────────

  it('错误 secret 签发的 JWT 时设置 userId=null', async () => {
    const signConfig = { ...testConfig, jwtSecret: 'signing-secret-A' }
    const verifyConfig = { ...testConfig, jwtSecret: 'verify-secret-B' }

    // 用 secret A 签发
    const signApp = createTestApp(signConfig)
    const signClient = treaty(signApp)
    const signRes = await signClient.sign.post({ sub: 'user-x' })
    const token = (signRes.data as { token?: string } | null)?.token

    // 用 secret B 验证
    const verifyApp = createTestApp(verifyConfig)
    const verifyClient = treaty(verifyApp)
    const { data } = await verifyClient.check.get({
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(data).toEqual({ userId: null })
  })

  // ─── 非法 Authorization 头格式 ──────────────────────

  it('非 Bearer Authorization header 时设置 userId=null', async () => {
    const app = createTestApp()
    const client = treaty(app)

    const { data } = await client.check.get({
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    })

    expect(data).toEqual({ userId: null })
  })
})
