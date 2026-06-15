import type { ServerConfig } from '../src/config'
import { describe, expect, it } from 'bun:test'
import { Elysia, t } from 'elysia'
import { AUTH_COOKIE_NAME, createAuthPlugin, createRequireAuthPlugin } from '../src/plugins/auth'

/**
 * Auth Plugin SSE 认证测试
 *
 * 浏览器 SSE 连接通过 httpOnly cookie 认证。
 * 编程式客户端仍可通过 Authorization: Bearer <jwt> 认证。
 * Query token (?token=<jwt>) 已移除 — JWT 不再暴露在 URL 中。
 */

const testConfig: ServerConfig = {
  port: 0,
  databaseUrl: '',
  dashscopeApiKey: '',
  dashscopeBaseUrl: '',
  storageRoot: '',
  frontendUrl: '',
  workerPollIntervalMs: 0,
  jwtSecret: 'test-sse-token-secret',
  jwtExpiresIn: '1h',
  oss: undefined,
  metricsAccessToken: undefined,
  metricsAllowedCidrs: ['127.0.0.1/32', '::1/128'],
}

function createTestApp() {
  return new Elysia()
    .use(createAuthPlugin(testConfig))
    .post('/sign', async ({ jwt, body }) => {
      const { sub } = body as { sub: string }
      const token = await jwt.sign({ sub })
      return { token }
    }, {
      body: t.Object({ sub: t.String() }),
    })
    // 模拟使用 require auth 的 SSE 端点，和 /api/sse 一样未认证时返回 401。
    .use(createRequireAuthPlugin(testConfig))
    .get('/sse-check', ({ userId }) => ({ userId }))
}

describe('auth plugin — SSE authentication', () => {
  it('从 httpOnly auth cookie 中提取 userId', async () => {
    const { treaty } = await import('@elysia/eden')
    const app = createTestApp()
    const client = treaty(app)

    const signRes = await client.sign.post({ sub: 'sse-cookie-user' })
    const token = (signRes.data as { token?: string } | null)?.token
    expect(token).toBeDefined()

    const { data, error } = await client['sse-check'].get({
      headers: { Cookie: `${AUTH_COOKIE_NAME}=${token}` },
    })

    expect(error).toBeNull()
    expect(data).toEqual({ userId: 'sse-cookie-user' })
  })

  it('从 Bearer header 中提取 userId', async () => {
    const { treaty } = await import('@elysia/eden')
    const app = createTestApp()
    const client = treaty(app)

    // 签发 token
    const signRes = await client.sign.post({ sub: 'sse-user-123' })
    const token = (signRes.data as { token?: string } | null)?.token
    expect(token).toBeDefined()

    // 通过 Bearer header 认证
    const { data, error } = await client['sse-check'].get({
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(error).toBeNull()
    expect(data).toEqual({ userId: 'sse-user-123' })
  })

  it('无效 Bearer token 时返回 401', async () => {
    const { treaty } = await import('@elysia/eden')
    const app = createTestApp()
    const client = treaty(app)

    const { data, error, status } = await client['sse-check'].get({
      headers: { Authorization: 'Bearer invalid.jwt.token' },
    })

    expect(status).toBe(401)
    expect(data).toBeNull()
    expect(error?.value).toEqual({ success: false, error: '请先登录' })
  })

  it('未提供 token 时返回 401', async () => {
    const { treaty } = await import('@elysia/eden')
    const app = createTestApp()
    const client = treaty(app)

    const { data, error, status } = await client['sse-check'].get()

    expect(status).toBe(401)
    expect(data).toBeNull()
    expect(error?.value).toEqual({ success: false, error: '请先登录' })
  })

  it('不接受 query ?token=（已移除）', async () => {
    const { treaty } = await import('@elysia/eden')
    const app = createTestApp()
    const client = treaty(app)

    // 签发 token
    const signRes = await client.sign.post({ sub: 'query-attempt-user' })
    const token = (signRes.data as { token?: string } | null)?.token

    // Query token 不应被接受 — 没有 cookie/Bearer 时应按未认证处理。
    const { data, error, status } = await client['sse-check'].get({
      query: { token },
    })

    expect(status).toBe(401)
    expect(data).toBeNull()
    expect(error?.value).toEqual({ success: false, error: '请先登录' })
  })
})
