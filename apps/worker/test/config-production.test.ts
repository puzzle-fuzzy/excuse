import type { WorkerConfig } from '../src/config'
import { describe, expect, it } from 'bun:test'
import { validateProductionConfig } from '../src/config'

function makeConfig(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    dashscopeApiKey: 'dashscope-key',
    dashscopeBaseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    storageRoot: './uploads',
    pollIntervalMs: 5000,
    staleTimeoutMs: 4 * 60 * 60 * 1000,
    claimTtlMs: 30_000,
    sweepIntervalMs: 60_000,
    oss: undefined,
    metricsAccessToken: undefined,
    metricsAllowedCidrs: ['127.0.0.1/32', '::1/128'],
    asrStaleTimeoutMs: 60 * 60 * 1000,
    providerHttpTimeoutMs: 60_000,
    providerStreamIdleTimeoutMs: 30_000,
    ...overrides,
  }
}

const productionEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://excuse:secret@localhost:5432/excuse',
  DASHSCOPE_API_KEY: 'dashscope-key',
}

describe('worker validateProductionConfig', () => {
  it('开发环境不强制生产门禁', () => {
    expect(() => validateProductionConfig(makeConfig({ dashscopeApiKey: '' }), { NODE_ENV: 'development' })).not.toThrow()
  })

  it('生产环境接受完整安全配置', () => {
    expect(() => validateProductionConfig(makeConfig(), productionEnv)).not.toThrow()
  })

  it('生产环境要求 DATABASE_URL', () => {
    const { DATABASE_URL: _databaseUrl, ...env } = productionEnv
    expect(() => validateProductionConfig(makeConfig(), env)).toThrow(/DATABASE_URL/)
  })

  it('生产环境要求 DASHSCOPE_API_KEY', () => {
    expect(() => validateProductionConfig(makeConfig({ dashscopeApiKey: '' }), productionEnv)).toThrow(/DASHSCOPE_API_KEY/)
  })

  it('公开 metrics CIDR 时要求 METRICS_ACCESS_TOKEN', () => {
    expect(() => validateProductionConfig(
      makeConfig({ metricsAllowedCidrs: ['::/0'] }),
      productionEnv,
    )).toThrow(/METRICS_ACCESS_TOKEN/)
  })
})
