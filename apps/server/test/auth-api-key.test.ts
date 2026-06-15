import type { AccountRow } from '@excuse/db'
import { treaty } from '@elysia/eden'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { Elysia } from 'elysia'

import { createRequireAuthPlugin } from '../src/plugins/auth'
import { makeAccount, makeTestConfig, makeValidatedParams, signTestToken } from './helpers/test-factory'

/**
 * API Key 认证测试 — auth plugin 双通道
 *
 * 验证:
 *   - exc_ 前缀 Bearer token → API Key hash 查找 + accountId
 *   - 无效 key → userId=null → 401
 *   - JWT token 仍然正常工作
 *   - 无认证 → 401
 */

// ─── Mock 依赖 ──────────────────────────────────────────

const mockFindApiKeyByHash = mock<(hash: string) => Promise<{ id: string, accountId: string, prefix: string } | null>>(() => Promise.resolve(null))
const mockFindRevokedApiKeyByHash = mock<(hash: string) => Promise<{ id: string, accountId: string, prefix: string } | null>>(() => Promise.resolve(null))
const mockTouchApiKeyLastUsed = mock<(id: string) => Promise<void>>(() => Promise.resolve(undefined))
const mockGetAccountById = mock<() => Promise<AccountRow | null>>(() => Promise.resolve(makeAccount()))

mock.module('@excuse/db', () => ({
  findApiKeyByHash: mockFindApiKeyByHash,
  findRevokedApiKeyByHash: mockFindRevokedApiKeyByHash,
  touchApiKeyLastUsed: mockTouchApiKeyLastUsed,
  getAccountById: mockGetAccountById,
  pgClient: { listen: async () => {} },
}))

mock.module('@excuse/provider', () => ({
  DashScopeClient: class {},
  AssetStorage: class {},
  getModelById: () => null,
  mergeWithDefaults: (_modelConfig: unknown, params: Record<string, unknown>) => params,
  validateModelParameters: () => ({ valid: true, errors: [] }),
  validateAndMerge: (_modelConfig: unknown, params: Record<string, unknown>) => ({ ok: true, params: makeValidatedParams(params) }),
  getModelsByCategory: () => [],
  MODELS: {},
}))

mock.module('@excuse/billing', () => ({
  calculateCost: () => ({ unit: 'token', totalPriceCents: 0, totalPrice: 0 }),
  aggregateStatistics: () => ({ totalCents: 0, totalYuan: 0, byCategory: [], byModel: [], dailyTrend: [] }),
}))

// ─── 测试配置 ──────────────────────────────────────────

const testConfig = makeTestConfig({ jwtSecret: 'api-key-auth-test-secret' })

// ─── Helper ──────────────────────────────────────────────

function makeAuthGuardApp() {
  return new Elysia()
    .use(createRequireAuthPlugin(testConfig))
    .get('/protected', ({ userId }) => ({ userId }))
}

/** 从 Eden error 提取错误消息 */
function getErrorMessage(error: unknown): string {
  const edenErr = error as { value?: { error?: string }, status?: number } | null
  if (!edenErr)
    return ''
  const val = edenErr.value
  if (val && typeof val === 'object' && 'error' in val)
    return (val as { error: string }).error
  return String(edenErr)
}

describe('API Key 认证', () => {
  beforeEach(() => {
    mockFindApiKeyByHash.mockReset()
    mockFindApiKeyByHash.mockImplementation(() => Promise.resolve(null))
    mockTouchApiKeyLastUsed.mockReset()
    mockTouchApiKeyLastUsed.mockImplementation(() => Promise.resolve(undefined))
  })

  it('exc_ 前缀 Bearer token → 成功认证', async () => {
    mockFindApiKeyByHash.mockImplementation(() => Promise.resolve({
      id: 'key-001',
      accountId: 'acc-api-key',
      prefix: 'exc_abcd',
    }))

    const app = makeAuthGuardApp()
    const client = treaty(app)

    const { data, error } = await client.protected.get({
      headers: { Authorization: 'Bearer exc_testkey123' },
    })

    expect(error).toBeNull()
    expect(data).toEqual({ userId: 'acc-api-key' })
    expect(mockFindApiKeyByHash).toHaveBeenCalled()
    expect(mockTouchApiKeyLastUsed).toHaveBeenCalledWith('key-001')
  })

  it('无效 API Key → 401', async () => {
    mockFindApiKeyByHash.mockImplementation(() => Promise.resolve(null))

    const app = makeAuthGuardApp()
    const client = treaty(app)

    const { error } = await client.protected.get({
      headers: { Authorization: 'Bearer exc_invalidkey' },
    })

    expect(error).toBeTruthy()
    expect(getErrorMessage(error)).toContain('请先登录')
    expect(mockFindApiKeyByHash).toHaveBeenCalled()
    expect(mockTouchApiKeyLastUsed).not.toHaveBeenCalled()
  })

  it('JWT Bearer token 仍然正常工作', async () => {
    const token = await signTestToken(testConfig.jwtSecret, 'acc-jwt-user')
    const app = makeAuthGuardApp()
    const client = treaty(app)

    const { data, error } = await client.protected.get({
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(error).toBeNull()
    expect(data).toEqual({ userId: 'acc-jwt-user' })
    expect(mockFindApiKeyByHash).not.toHaveBeenCalled()
  })

  it('无认证 → 401', async () => {
    const app = makeAuthGuardApp()
    const client = treaty(app)

    const { error } = await client.protected.get()

    expect(error).toBeTruthy()
    expect(getErrorMessage(error)).toContain('请先登录')
  })
})
