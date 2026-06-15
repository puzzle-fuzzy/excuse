import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { extractEdenError, makeTestConfig, signTestToken } from './helpers/test-factory'

const mockCreateApiKey = mock(() => Promise.resolve({
  id: 'key-001',
  accountId: 'acc-001',
  prefix: 'exc_abcd',
  keyHash: 'hash-value',
  name: '测试密钥',
  lastUsedAt: null,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  revokedAt: null,
}))
const mockListApiKeysByAccount = mock(() => Promise.resolve([
  {
    id: 'key-001',
    prefix: 'exc_abcd',
    name: '测试密钥',
    lastUsedAt: new Date('2024-01-02T00:00:00Z'),
    createdAt: new Date('2024-01-01T00:00:00Z'),
    revokedAt: null,
  },
]))
const mockRevokeApiKey = mock(() => Promise.resolve({
  id: 'key-001',
  accountId: 'acc-001',
  prefix: 'exc_abcd',
  keyHash: 'hash-value',
  name: '测试密钥',
  lastUsedAt: null,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  revokedAt: new Date('2024-01-03T00:00:00Z'),
}))

mock.module('@excuse/db', () => ({
  createApiKey: mockCreateApiKey,
  listApiKeysByAccount: mockListApiKeysByAccount,
  revokeApiKey: mockRevokeApiKey,
}))

const mockAudit = mock(() => {})

mock.module('../src/services/audit', () => ({
  audit: mockAudit,
}))

// eslint-disable-next-line import/first
import { createApiKeyRoutes } from '../src/routes/api-keys'

const testConfig = makeTestConfig({
  dashscopeApiKey: 'test-key',
  dashscopeBaseUrl: 'https://test.local',
  storageRoot: '/tmp/test-uploads',
  jwtSecret: 'test-api-keys-secret',
})

describe('API key 路由', () => {
  let app: ReturnType<typeof createApiKeyRoutes>
  let token: string

  beforeAll(async () => {
    token = await signTestToken(testConfig.jwtSecret, 'acc-001')
  })

  beforeEach(() => {
    for (const fn of [mockCreateApiKey, mockListApiKeysByAccount, mockRevokeApiKey, mockAudit]) {
      fn.mockClear()
    }

    app = createApiKeyRoutes(testConfig)
  })

  it('未登录时返回错误', async () => {
    const response = await app.handle(new Request('http://localhost/api/keys'))
    const err = extractEdenError({
      data: undefined,
      error: {
        status: response.status,
        value: await response.json(),
      },
    })

    expect(err).toBeTruthy()
    expect(err!.error).toContain('登录')
  })

  it('创建密钥返回 data.key 和 data.prefix', async () => {
    const response = await app.handle(new Request('http://localhost/api/keys', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: '测试密钥' }),
    }))
    const data = await response.json() as {
      success: true
      data: { key: string, prefix: string }
    }

    expect(data.success).toBe(true)
    expect(data.data.key).toStartWith('exc_')
    expect(data.data.prefix).toStartWith('exc_')
    expect(mockCreateApiKey).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'acc-001',
      name: '测试密钥',
    }))
  })

  it('列表返回 items DTO，不包含 keyHash，并序列化日期', async () => {
    const response = await app.handle(new Request('http://localhost/api/keys', {
      headers: { Authorization: `Bearer ${token}` },
    }))
    const data = await response.json() as {
      success: true
      items: Array<{ createdAt: string, lastUsedAt: string | null, keyHash?: string }>
      total: number
    }

    expect(data.success).toBe(true)
    expect(data.items).toHaveLength(1)
    expect(data.items[0]?.keyHash).toBeUndefined()
    expect(data.items[0]?.createdAt).toBe('2024-01-01T00:00:00.000Z')
    expect(data.items[0]?.lastUsedAt).toBe('2024-01-02T00:00:00.000Z')
    expect(data.total).toBe(1)
  })

  it('撤销密钥返回 mutation ok', async () => {
    const response = await app.handle(new Request('http://localhost/api/keys/key-001', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }))
    const data = await response.json()

    expect(data).toEqual({ success: true })
    expect(mockRevokeApiKey).toHaveBeenCalledWith('key-001', 'acc-001')
  })
})
