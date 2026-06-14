import type { ServerConfig } from '../src/config'
import { treaty } from '@elysia/eden'
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { extractEdenError } from './helpers/test-factory'

/**
 * 认证路由单元测试
 *
 * 使用 mock.module 模拟 @excuse/db 的账户仓库函数，
 * 在完全隔离的环境中测试路由的 HTTP 行为：
 *   - 注册：成功 / 邮箱重复 / 用户名重复
 *   - 登录：成功 / 用户不存在 / 密码错误 / 账户禁用
 *   - 当前用户：有效 token / 无 token / 无效 token / 用户不存在
 *
 * Bun.password.hash/verify 是真实操作，不 mock — 保证 bcrypt 流程正确。
 */

// ─── Mock 类型 ──────────────────────────────────────────

/** 测试用账户行结构（匹配 createAuthRoutes 所需的 DB row 字段） */
interface AccountRow {
  id: string
  username: string
  email: string
  password: string
  avatar: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

/** 认证响应结构（Eden 推导后通过运行时访问 token/user） */
interface AuthData {
  success: boolean
  data?: {
    token?: string
    user?: AccountRow
  }
  error?: string
}

// ─── Mock @excuse/db ───────────────────────────────

const mockGetAccountByEmail = mock<() => Promise<AccountRow | null>>(() => Promise.resolve(null))
const mockGetAccountByUsername = mock<() => Promise<AccountRow | null>>(() => Promise.resolve(null))
const mockGetAccountById = mock<() => Promise<AccountRow | null>>(() => Promise.resolve(null))
const mockCreateAccount = mock<(values: Record<string, unknown>) => Promise<AccountRow | null>>(() => Promise.resolve(null))

mock.module('@excuse/db', () => ({
  getAccountByEmail: mockGetAccountByEmail,
  getAccountByUsername: mockGetAccountByUsername,
  getAccountById: mockGetAccountById,
  createAccount: mockCreateAccount,
}))

// mock.module 会被 Bun 自动提升到 import 之前
// eslint-disable-next-line import/first
import { createAuthRoutes } from '../src/routes/auth'

// ─── 测试配置 ──────────────────────────────────────

const testConfig: ServerConfig = {
  port: 0,
  databaseUrl: '',
  dashscopeApiKey: '',
  dashscopeBaseUrl: '',
  storageRoot: '',
  frontendUrl: '',
  workerPollIntervalMs: 0,
  jwtSecret: 'test-auth-routes-secret',
  jwtExpiresIn: '1h',
  oss: undefined,
  metricsAccessToken: undefined,
  metricsAllowedCidrs: ['127.0.0.1/32', '::1/128'],
}

// ─── 辅助函数 ──────────────────────────────────────

function makeAccount(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: 'acc-001',
    username: 'testuser',
    email: 'test@example.com',
    password: 'hashed-password',
    avatar: null,
    isActive: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }
}

// ─── 测试 ──────────────────────────────────────────

describe('auth routes', () => {
  let client: ReturnType<typeof treaty>
  let testPasswordHash: string

  beforeAll(async () => {
    // 预计算 bcrypt hash，用于 login 测试
    testPasswordHash = await Bun.password.hash('testpassword123', 'bcrypt')
  })

  beforeEach(() => {
    // 重置所有 mock 的调用记录和默认返回值
    mockGetAccountByEmail.mockClear()
    mockGetAccountByUsername.mockClear()
    mockGetAccountById.mockClear()
    mockCreateAccount.mockClear()

    // 每个 test case 创建独立的 app 实例
    const app = createAuthRoutes(testConfig)
    client = treaty(app)
  })

  // ═══════════════════════════════════════════════════
  //  POST /api/auth/register
  // ═══════════════════════════════════════════════════

  describe('POST /register', () => {
    it('should register a new account and return token + user', async () => {
      mockGetAccountByEmail.mockResolvedValue(null)
      mockGetAccountByUsername.mockResolvedValue(null)
      mockCreateAccount.mockResolvedValue(makeAccount())

      const { data, error } = await client.api.auth.register.post({
        username: 'testuser',
        email: 'test@example.com',
        password: 'testpassword123',
      })

      expect(error).toBeNull()
      expect(data?.success).toBe(true)
      expect(typeof (data as AuthData | null)?.data?.token).toBe('string')
      expect((data as AuthData | null)?.data?.user).toBeDefined()
      // 响应中不能包含 password
      expect((data as AuthData | null)?.data?.user?.password).toBeUndefined()
      // createAccount 应被调用一次
      expect(mockCreateAccount).toHaveBeenCalledTimes(1)
      // 传入 createAccount 的 password 应该是 bcrypt hash
      const createCallArg = mockCreateAccount.mock.calls[0][0]
      expect(createCallArg.password).not.toBe('testpassword123')
      expect(String(createCallArg.password).startsWith('$2b$')).toBe(true)
    })

    it('should reject duplicate email', async () => {
      mockGetAccountByEmail.mockResolvedValue(makeAccount())

      const res = await client.api.auth.register.post({
        username: 'newuser',
        email: 'test@example.com',
        password: 'testpassword123',
      })

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(409)
      expect(err!.error).toContain('邮箱')
      // 不应尝试创建账户
      expect(mockCreateAccount).not.toHaveBeenCalled()
    })

    it('should reject duplicate username', async () => {
      mockGetAccountByEmail.mockResolvedValue(null)
      mockGetAccountByUsername.mockResolvedValue(makeAccount())

      const res = await client.api.auth.register.post({
        username: 'testuser',
        email: 'new@example.com',
        password: 'testpassword123',
      })

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(409)
      expect(err!.error).toContain('用户名')
      expect(mockCreateAccount).not.toHaveBeenCalled()
    })

    it('should reject when password is too short (validation)', async () => {
      const { data, error } = await client.api.auth.register.post({
        username: 'testuser',
        email: 'test@example.com',
        password: '12345', // < 6 chars
      })

      // Elysia body validation 应返回 422 错误
      expect(error).toBeDefined()
      expect(error!.status).toBe(422)
      expect(data).toBeNull()
    })

    it('should reject when email format is invalid (validation)', async () => {
      const { data, error } = await client.api.auth.register.post({
        username: 'testuser',
        email: 'not-an-email',
        password: 'testpassword123',
      })

      expect(error).toBeDefined()
      expect(error!.status).toBe(422)
      expect(data).toBeNull()
    })
  })

  // ═══════════════════════════════════════════════════
  //  POST /api/auth/login
  // ═══════════════════════════════════════════════════

  describe('POST /login', () => {
    it('should login with correct credentials', async () => {
      mockGetAccountByEmail.mockResolvedValue(
        makeAccount({ password: testPasswordHash }),
      )

      const { data, error } = await client.api.auth.login.post({
        email: 'test@example.com',
        password: 'testpassword123',
      })

      expect(error).toBeNull()
      expect(data?.success).toBe(true)
      expect(typeof (data as AuthData | null)?.data?.token).toBe('string')
      expect((data as AuthData | null)?.data?.user).toBeDefined()
      expect((data as AuthData | null)?.data?.user?.password).toBeUndefined()
    })

    it('should reject non-existent email', async () => {
      mockGetAccountByEmail.mockResolvedValue(null)

      const res = await client.api.auth.login.post({
        email: 'nobody@example.com',
        password: 'testpassword123',
      })

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(401)
      expect(err!.error).toContain('邮箱或密码错误')
    })

    it('should reject wrong password', async () => {
      mockGetAccountByEmail.mockResolvedValue(
        makeAccount({ password: testPasswordHash }),
      )

      const res = await client.api.auth.login.post({
        email: 'test@example.com',
        password: 'wrongpassword',
      })

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(401)
      expect(err!.error).toContain('邮箱或密码错误')
    })

    it('should reject inactive account even with correct password', async () => {
      mockGetAccountByEmail.mockResolvedValue(
        makeAccount({ password: testPasswordHash, isActive: false }),
      )

      const res = await client.api.auth.login.post({
        email: 'test@example.com',
        password: 'testpassword123',
      })

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(403)
      expect(err!.error).toContain('禁用')
    })
  })

  // ═══════════════════════════════════════════════════
  //  GET /api/auth/me
  // ═══════════════════════════════════════════════════

  describe('GET /me', () => {
    it('should return current user with valid token', async () => {
      // 先注册获取 token
      mockGetAccountByEmail.mockResolvedValue(null)
      mockGetAccountByUsername.mockResolvedValue(null)
      mockCreateAccount.mockResolvedValue(makeAccount())

      const regRes = await client.api.auth.register.post({
        username: 'testuser',
        email: 'test@example.com',
        password: 'testpassword123',
      })
      const token = (regRes.data as AuthData | null)?.data?.token
      expect(token).toBeDefined()

      // /me 查询账户
      mockGetAccountById.mockResolvedValue(makeAccount())

      const { data, error } = await client.api.auth.me.get({
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(error).toBeNull()
      expect(data?.success).toBe(true)
      expect((data as { data?: AccountRow } | null)?.data).toBeDefined()
      expect((data as { data?: AccountRow } | null)?.data?.password).toBeUndefined()
      // 应该使用 token 中 sub 对应的 id 查询
      expect(mockGetAccountById).toHaveBeenCalledWith('acc-001')
    })

    it('should reject without token', async () => {
      const res = await client.api.auth.me.get()

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(401)
      expect(err!.error).toContain('未登录')
    })

    it('should reject with invalid token', async () => {
      const res = await client.api.auth.me.get({
        headers: { Authorization: 'Bearer this.is.invalid' },
      })

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(401)
      expect(err!.error).toContain('未登录')
    })

    it('should reject when user no longer exists in DB', async () => {
      // 先注册获取 token
      mockGetAccountByEmail.mockResolvedValue(null)
      mockGetAccountByUsername.mockResolvedValue(null)
      mockCreateAccount.mockResolvedValue(makeAccount())

      const regRes = await client.api.auth.register.post({
        username: 'testuser',
        email: 'test@example.com',
        password: 'testpassword123',
      })
      const token = (regRes.data as AuthData | null)?.data?.token

      // 模拟用户已被删除
      mockGetAccountById.mockResolvedValue(null)

      const res = await client.api.auth.me.get({
        headers: { Authorization: `Bearer ${token}` },
      })

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(404)
      expect(err!.error).toContain('用户不存在')
    })
  })
})
