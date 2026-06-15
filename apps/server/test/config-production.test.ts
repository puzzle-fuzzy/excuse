import type { ServerConfig } from '../src/config'
import { describe, expect, it } from 'bun:test'
import { validateProductionConfig } from '../src/config'

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: 5007,
    databaseUrl: 'postgres://excuse:secret@localhost:5432/excuse',
    dashscopeApiKey: 'dashscope-key',
    dashscopeBaseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    storageRoot: './uploads',
    frontendUrl: 'https://excuse.example.com',
    workerPollIntervalMs: 5000,
    jwtSecret: 'production-secret-at-least-32-characters',
    jwtExpiresIn: '7d',
    oss: undefined,
    metricsAccessToken: undefined,
    metricsAllowedCidrs: ['127.0.0.1/32', '::1/128'],
    workerMetricsUrl: undefined,
    adminUserIds: [],
    ...overrides,
  }
}

const productionEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://excuse:secret@localhost:5432/excuse',
  DASHSCOPE_API_KEY: 'dashscope-key',
  FRONTEND_URL: 'https://excuse.example.com',
  JWT_SECRET: 'production-secret-at-least-32-characters',
}

describe('validateProductionConfig', () => {
  it('开发环境不强制生产门禁', () => {
    expect(() => validateProductionConfig(makeConfig({ jwtSecret: 'short' }), { NODE_ENV: 'development' })).not.toThrow()
  })

  it('生产环境接受完整安全配置', () => {
    expect(() => validateProductionConfig(makeConfig(), productionEnv)).not.toThrow()
  })

  it('生产环境拒绝默认 JWT_SECRET', () => {
    expect(() => validateProductionConfig(
      makeConfig({ jwtSecret: 'dev-secret-change-in-production' }),
      { ...productionEnv, JWT_SECRET: 'dev-secret-change-in-production' },
    )).toThrow(/development default/)
  })

  it('生产环境拒绝过短 JWT_SECRET', () => {
    expect(() => validateProductionConfig(
      makeConfig({ jwtSecret: 'too-short' }),
      { ...productionEnv, JWT_SECRET: 'too-short' },
    )).toThrow(/at least 32/)
  })

  it('生产环境要求 FRONTEND_URL 显式配置', () => {
    const { FRONTEND_URL: _frontendUrl, ...env } = productionEnv
    expect(() => validateProductionConfig(makeConfig(), env)).toThrow(/FRONTEND_URL/)
  })

  it('公开 metrics CIDR 时要求 METRICS_ACCESS_TOKEN', () => {
    expect(() => validateProductionConfig(
      makeConfig({ metricsAllowedCidrs: ['0.0.0.0/0'] }),
      productionEnv,
    )).toThrow(/METRICS_ACCESS_TOKEN/)
  })
})
