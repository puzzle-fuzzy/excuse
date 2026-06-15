import { afterEach, describe, expect, it, mock } from 'bun:test'
import { loadConfig } from '../src/config'

// Mock heavy dependencies to avoid drizzle-orm isFalse import error
mock.module('@excuse/db', () => ({
  markGenerationFailed: async () => {},
  markGenerationProcessing: async () => {},
  markGenerationSucceeded: async () => {},
  notifyGenerationStatus: async () => {},
  updateCanvasProject: async () => {},
  updateCanvasShot: async () => {},
  listCanvasShotsByProject: async () => [],
}))

mock.module('@excuse/provider', () => ({
  DashScopeClient: class {},
  AssetStorage: class {},
  getModelById: () => undefined,
}))

describe('loadConfig', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    // 恢复环境变量
    process.env = { ...originalEnv }
  })

  it('无环境变量时使用默认值', () => {
    delete process.env.DASHSCOPE_API_KEY
    delete process.env.DASHSCOPE_BASE_URL
    delete process.env.STORAGE_ROOT
    delete process.env.WORKER_POLL_INTERVAL_MS
    delete process.env.WORKER_STALE_TIMEOUT_MS
    delete process.env.METRICS_ACCESS_TOKEN
    delete process.env.METRICS_ALLOWED_CIDRS

    const config = loadConfig()

    expect(config.dashscopeApiKey).toBe('')
    expect(config.dashscopeBaseUrl).toBe('https://dashscope.aliyuncs.com/api/v1')
    expect(config.storageRoot).toBe('./uploads')
    expect(config.pollIntervalMs).toBe(5000)
    expect(config.staleTimeoutMs).toBe(4 * 60 * 60 * 1000)
    expect(config.metricsAccessToken).toBeUndefined()
    expect(config.metricsAllowedCidrs).toEqual(['127.0.0.1/32', '::1/128'])
  })

  it('从环境变量读取值', () => {
    process.env.DASHSCOPE_API_KEY = 'sk-test-123'
    process.env.DASHSCOPE_BASE_URL = 'https://custom.api.com'
    process.env.STORAGE_ROOT = '/data/files'
    process.env.WORKER_POLL_INTERVAL_MS = '10000'
    process.env.WORKER_STALE_TIMEOUT_MS = '7200000'
    process.env.METRICS_ACCESS_TOKEN = 'metrics-token'
    process.env.METRICS_ALLOWED_CIDRS = '10.0.0.5/32, 8.8.8.8'

    const config = loadConfig()

    expect(config.dashscopeApiKey).toBe('sk-test-123')
    expect(config.dashscopeBaseUrl).toBe('https://custom.api.com')
    expect(config.storageRoot).toBe('/data/files')
    expect(config.pollIntervalMs).toBe(10000)
    expect(config.staleTimeoutMs).toBe(7200000)
    expect(config.metricsAccessToken).toBe('metrics-token')
    // split + trim + filter 空段
    expect(config.metricsAllowedCidrs).toEqual(['10.0.0.5/32', '8.8.8.8'])
  })

  it('无效数字环境变量时优雅回退', () => {
    process.env.WORKER_POLL_INTERVAL_MS = 'not-a-number'
    process.env.WORKER_STALE_TIMEOUT_MS = ''

    const config = loadConfig()

    // Number('not-a-number') = NaN, NaN || 5000 = 5000
    expect(config.pollIntervalMs).toBe(5000)
    expect(config.staleTimeoutMs).toBe(4 * 60 * 60 * 1000)
  })
})
