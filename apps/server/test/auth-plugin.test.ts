import type { ServerConfig } from '../src/config'
import { treaty } from '@elysia/eden'
import { describe, expect, it } from 'bun:test'
import { Elysia, t } from 'elysia'
import { createAuthPlugin } from '../src/plugins/auth'

/**
 * 认证插件单元测试
 *
 * 测试 createAuthPlugin 的核心功能：
 *   - 无 Bearer token → userId = null
 *   - 有效 JWT → userId 提取正确
 *   - 无效 JWT → userId = null
 *   - 错误 secret 签发的 JWT → userId = null
 *   - 空 Bearer → userId = null
 */

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
