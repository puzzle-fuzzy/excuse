/**
 * Server bootstrap 生命周期测试
 *
 * 验证 start()/stop() 基本流程：observer/guard 注册+清理、优雅退出不抛错。
 */

import { describe, expect, it, mock } from 'bun:test'
import { bootstrapServer } from '../src/bootstrap'

// mock 外部依赖
mock.module('@excuse/provider', () => ({
  registerProviderCallObserver: mock(() => () => {}),
  registerProviderCallGuard: mock(() => () => {}),
}))
mock.module('@excuse/ffmpeg', () => ({
  checkFFmpegAsync: mock(async () => []),
}))
mock.module('@excuse/shared', () => ({
  logger: { info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) },
  isPgTableNotFoundError: mock(() => false),
}))
mock.module('../src/services/metrics', () => ({
  recordProviderCall: mock(() => {}),
}))
mock.module('../src/services/provider-health', () => ({
  providerCallGuard: mock(async () => ({ blocked: false })),
  recordProviderCallOutcome: mock(async () => {}),
  warmProviderHealthCache: mock(() => {}),
}))
mock.module('../src/services/sse-manager', () => ({
  startSSEListener: mock(async () => {}),
}))

function makeFakeApp() {
  let listening = false
  let stopped = false
  return {
    listen: mock((_port: number, cb?: () => void) => {
      listening = true
      cb?.()
      return { listening }
    }),
    stop: mock(async () => {
      stopped = true
    }),
    server: { hostname: 'localhost', port: 5007 },
    _listening: () => listening,
    _stopped: () => stopped,
  }
}

describe('bootstrapServer', () => {
  it('start() 注册 observer/guard 并启动监听', async () => {
    const app = makeFakeApp()
    const config = {
      port: 5007,
      databaseUrl: 'postgres://localhost/test',
      dashscopeApiKey: '',
      dashscopeBaseUrl: '',
      storageRoot: '/tmp',
      frontendUrl: '',
      workerPollIntervalMs: 5000,
      jwtSecret: 'test',
      jwtExpiresIn: '1h',
      oss: undefined,
      metricsAccessToken: undefined,
      metricsAllowedCidrs: ['127.0.0.1/32'],
      providerHttpTimeoutMs: 60000,
      providerStreamIdleTimeoutMs: 30000,
      processStartTime: Date.now(),
    }

    const { start } = bootstrapServer(config, app as any)
    await start()

    expect(app._listening()).toBe(true)
  })

  it('stop() 正常退出（不抛错）', async () => {
    const app = makeFakeApp()
    const config = {
      port: 5007,
      databaseUrl: 'postgres://localhost/test',
      dashscopeApiKey: '',
      dashscopeBaseUrl: '',
      storageRoot: '/tmp',
      frontendUrl: '',
      workerPollIntervalMs: 5000,
      jwtSecret: 'test',
      jwtExpiresIn: '1h',
      oss: undefined,
      metricsAccessToken: undefined,
      metricsAllowedCidrs: ['127.0.0.1/32'],
      providerHttpTimeoutMs: 60000,
      providerStreamIdleTimeoutMs: 30000,
      processStartTime: Date.now(),
    }

    const { start, stop } = bootstrapServer(config, app as any)
    await start()

    // 停止时不抛错
    await expect(stop()).resolves.toBeUndefined()
  })

  it('重复 start() 不抛错（observer 注册幂等）', async () => {
    const app = makeFakeApp()
    const config = {
      port: 5007,
      databaseUrl: 'postgres://localhost/test',
      dashscopeApiKey: '',
      dashscopeBaseUrl: '',
      storageRoot: '/tmp',
      frontendUrl: '',
      workerPollIntervalMs: 5000,
      jwtSecret: 'test',
      jwtExpiresIn: '1h',
      oss: undefined,
      metricsAccessToken: undefined,
      metricsAllowedCidrs: ['127.0.0.1/32'],
      providerHttpTimeoutMs: 60000,
      providerStreamIdleTimeoutMs: 30000,
      processStartTime: Date.now(),
    }

    const { start, stop } = bootstrapServer(config, app as any)
    await start()
    await start() // 第二次 start 不应抛错

    await stop()
  })
})
