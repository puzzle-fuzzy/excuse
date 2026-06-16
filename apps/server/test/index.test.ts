import type { App } from '../src/index'
import { treaty } from '@elysia/eden'
import { describe, expect, it } from 'bun:test'
import app from '../src/index'

const client = treaty<App>(app)

describe('API', () => {
  it('GET /api/health 应返回 status + timestamp + uptime + db', async () => {
    const { data, error } = await client.api.health.get()

    expect(error).toBeNull()
    expect(data?.status).toBeDefined()
    expect(data?.timestamp).toBeDefined()
    expect(typeof data?.uptime).toBe('number')
    expect(typeof data?.db).toBe('string')
  })

  it('GET /api/health/live → 200 ok（liveness 不依赖 DB）', async () => {
    const res = await app.handle(new Request('http://localhost/api/health/live'))
    expect(res.status).toBe(200)
    const body = await res.json() as { status: string }
    expect(body.status).toBe('ok')
  })

  it('GET /api/health/db → 200 + db 状态', async () => {
    const res = await app.handle(new Request('http://localhost/api/health/db'))
    // 测试 DB 可用时 200，否则 503 —— 此处只断言返回结构合法
    expect([200, 503]).toContain(res.status)
    const body = await res.json() as { db?: string }
    if (res.status === 200)
      expect(body.db).toBe('ok')
  })

  it('GET /api/health/ready → 200 或 503，且 200 时 db=ok', async () => {
    const res = await app.handle(new Request('http://localhost/api/health/ready'))
    expect([200, 503]).toContain(res.status)
    if (res.status === 200) {
      const body = await res.json() as { db?: string, status?: string }
      expect(body.status).toBe('ready')
      expect(body.db).toBe('ok')
    }
  })

  it('非生产环境 GET /openapi 可访问（OpenAPI 文档仅在非生产挂载）', async () => {
    // 测试运行时 NODE_ENV !== 'production'，故 /openapi 应被挂载。
    const res = await app.handle(new Request('http://localhost/openapi'))
    expect(res.status).toBe(200)
  })
})
