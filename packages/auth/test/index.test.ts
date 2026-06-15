import { describe, expect, it } from 'bun:test'
import {
  API_KEY_PREFIX,
  createApiKeySecret,
  extractApiKeyPrefix,
  hashApiKey,
  isApiKeySecret,
} from '../src'

describe('@excuse/auth api keys', () => {
  it('创建 API key secret 和显示前缀', () => {
    const created = createApiKeySecret('123e4567-e89b-12d3-a456-426614174000')

    expect(created.key).toBe('exc_123e4567e89b12d3a456426614174000')
    expect(created.prefix).toBe('exc_123e')
  })

  it('提取已持久化的显示前缀', () => {
    expect(extractApiKeyPrefix('exc_abcdef123456')).toBe('exc_abcd')
  })

  it('通过前缀检测 API key secret', () => {
    expect(isApiKeySecret(`${API_KEY_PREFIX}abc`)).toBe(true)
    expect(isApiKeySecret('jwt-token')).toBe(false)
  })

  it('SHA-256 hex 确定性哈希 API key', async () => {
    const hashA = await hashApiKey('exc_test')
    const hashB = await hashApiKey('exc_test')
    const hashC = await hashApiKey('exc_other')

    expect(hashA).toHaveLength(64)
    expect(hashA).toBe(hashB)
    expect(hashA).not.toBe(hashC)
  })
})
