import { describe, expect, it } from 'bun:test'
import {
  parseMetricsConfig,
  parsePositiveIntEnv,
  parseProviderConfig,
  parseProviderTimeoutConfig,
  parseStorageConfig,
  validateProductionBase,
} from '../src/env-helpers'

describe('parsePositiveIntEnv', () => {
  it('未设置时返回默认值', () => {
    const env = {}
    expect(parsePositiveIntEnv('TEST_VAR', 5000, env)).toEqual({ value: 5000, source: 'default' })
  })

  it('空字符串返回默认值', () => {
    const env = { TEST_VAR: '' }
    expect(parsePositiveIntEnv('TEST_VAR', 5000, env)).toEqual({ value: 5000, source: 'default' })
  })

  it('正常值从 env 读取', () => {
    const env = { TEST_VAR: '10000' }
    expect(parsePositiveIntEnv('TEST_VAR', 5000, env)).toEqual({ value: 10000, source: 'env' })
  })

  it('非法值抛出明确错误（含变量名）', () => {
    const env = { TEST_VAR: 'not-a-number' }
    expect(() => parsePositiveIntEnv('TEST_VAR', 5000, env))
      .toThrow('TEST_VAR must be a positive integer, got: "not-a-number"')
  })

  it('零值抛出错误', () => {
    const env = { TEST_VAR: '0' }
    expect(() => parsePositiveIntEnv('TEST_VAR', 5000, env))
      .toThrow('TEST_VAR must be a positive integer')
  })

  it('负数抛出错误', () => {
    const env = { TEST_VAR: '-5' }
    expect(() => parsePositiveIntEnv('TEST_VAR', 5000, env))
      .toThrow('TEST_VAR must be a positive integer')
  })

  it('浮点数抛出错误', () => {
    const env = { TEST_VAR: '3.14' }
    expect(() => parsePositiveIntEnv('TEST_VAR', 5000, env))
      .toThrow('TEST_VAR must be a positive integer')
  })
})

describe('parseProviderConfig', () => {
  it('未设置时返回空 key + 默认 baseUrl', () => {
    const env = {}
    const config = parseProviderConfig(env)
    expect(config.dashscopeApiKey).toBe('')
    expect(config.dashscopeBaseUrl).toBe('https://dashscope.aliyuncs.com/api/v1')
  })

  it('从环境变量读取值', () => {
    const env = {
      DASHSCOPE_API_KEY: 'sk-test-123',
      DASHSCOPE_BASE_URL: 'https://custom.api.com',
    }
    const config = parseProviderConfig(env)
    expect(config.dashscopeApiKey).toBe('sk-test-123')
    expect(config.dashscopeBaseUrl).toBe('https://custom.api.com')
  })
})

describe('parseMetricsConfig', () => {
  it('未设置时返回默认值', () => {
    const env = {}
    const config = parseMetricsConfig(env)
    expect(config.accessToken).toBeUndefined()
    expect(config.allowedCidrs).toEqual(['127.0.0.1/32', '::1/128'])
  })

  it('解析 CIDR 列表（去空格+去空段）', () => {
    const env = {
      METRICS_ACCESS_TOKEN: 'tok',
      METRICS_ALLOWED_CIDRS: '10.0.0.0/8, , 192.168.1.1/32',
    }
    const config = parseMetricsConfig(env)
    expect(config.accessToken).toBe('tok')
    expect(config.allowedCidrs).toEqual(['10.0.0.0/8', '192.168.1.1/32'])
  })
})

describe('parseProviderTimeoutConfig', () => {
  it('默认值 60s/30s', () => {
    const env = {}
    const config = parseProviderTimeoutConfig(env)
    expect(config.providerHttpTimeoutMs).toBe(60_000)
    expect(config.providerStreamIdleTimeoutMs).toBe(30_000)
  })

  it('从环境变量读取', () => {
    const env = { PROVIDER_HTTP_TIMEOUT_MS: '120000', PROVIDER_STREAM_IDLE_TIMEOUT_MS: '45000' }
    const config = parseProviderTimeoutConfig(env)
    expect(config.providerHttpTimeoutMs).toBe(120_000)
    expect(config.providerStreamIdleTimeoutMs).toBe(45_000)
  })
})

describe('parseStorageConfig', () => {
  it('默认 storageRoot', () => {
    const env = {}
    const config = parseStorageConfig(env)
    expect(config.storageRoot).toBe('./uploads')
    expect(config.oss).toBeUndefined()
  })

  it('读取自定义 storageRoot', () => {
    const env = { STORAGE_ROOT: '/data/files' }
    const config = parseStorageConfig(env)
    expect(config.storageRoot).toBe('/data/files')
  })
})

describe('validateProductionBase', () => {
  it('非生产环境不校验', () => {
    expect(() => validateProductionBase(
      { dashscopeApiKey: '', metricsAllowedCidrs: ['0.0.0.0/0'], metricsAccessToken: undefined },
      { NODE_ENV: 'development' },
    )).not.toThrow()
  })

  it('生产环境缺少 KEY 抛错', () => {
    expect(() => validateProductionBase(
      { dashscopeApiKey: '', metricsAllowedCidrs: ['127.0.0.1/32'] },
      { NODE_ENV: 'production', DATABASE_URL: 'pg://...' },
    )).toThrow('DASHSCOPE_API_KEY is required')
  })

  it('公网 CIDR 无 token 抛错', () => {
    expect(() => validateProductionBase(
      { dashscopeApiKey: 'sk-test', metricsAllowedCidrs: ['0.0.0.0/0'], metricsAccessToken: undefined },
      { NODE_ENV: 'production', DATABASE_URL: 'pg://...' },
    )).toThrow('METRICS_ACCESS_TOKEN is required')
  })

  it('公网 CIDR 有 token 不抛错', () => {
    expect(() => validateProductionBase(
      { dashscopeApiKey: 'sk-test', metricsAllowedCidrs: ['0.0.0.0/0'], metricsAccessToken: 'tok' },
      { NODE_ENV: 'production', DATABASE_URL: 'pg://...' },
    )).not.toThrow()
  })
})
