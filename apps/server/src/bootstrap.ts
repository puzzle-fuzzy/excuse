/**
 * Server 启动器 — 隔离 module-level 副作用
 *
 * 把 provider observer/guard 注册、HTTP listen、SSE 监听、环境检查、信号处理器
 * 全部收敛到 bootstrap 函数内，返回 start() / stop() 生命周期控制。
 *
 * index.ts 只做 loadConfig() + createServerContext() + createElysiaApp() + bootstrap.start()，
 * 测试可直接 createElysiaApp(config, ctx) 而不触发副作用。
 */

import type { ServerConfig } from './config'
import { checkFFmpegAsync } from '@excuse/ffmpeg'
import { registerProviderCallGuard, registerProviderCallObserver } from '@excuse/provider'
import { isPgTableNotFoundError, logger } from '@excuse/shared'
import { recordProviderCall } from './services/metrics'
import { providerCallGuard, recordProviderCallOutcome, warmProviderHealthCache } from './services/provider-health'
import { startSSEListener } from './services/sse-manager'

export interface BootstrapServerResult {
  start: () => Promise<void>
  stop: () => Promise<void>
}

/**
 * 创建 Server 启动器。
 *
 * 接收已装配的 Elysia app（不含 listen 副作用），在 start() 中注册 observer/guard、
 * listen、SSE、信号处理器。stop() 清理 observer/guard、关闭 HTTP server。
 *
 * @param app — Elysia 实例（接受具体泛型，避免与 createElysiaApp 返回类型不兼容）
 */

export function bootstrapServer(
  config: ServerConfig,
  app: { listen: (port: number, cb?: () => void) => unknown, stop: () => Promise<unknown>, server?: { hostname?: string, port?: number } | null },
): BootstrapServerResult {
  // 清理函数引用（stop 时调用）
  let unregisterObserver: (() => void) | null = null
  let unregisterGuard: (() => void) | null = null
  let serverStop: (() => Promise<void>) | null = null
  let gracefulTimeout: ReturnType<typeof setTimeout> | null = null
  let isStopping = false

  async function start(): Promise<void> {
    // 1. Provider observer + guard（在真正 listen 前注册，所有 DashScopeClient 实例自动覆盖）
    unregisterObserver = registerProviderCallObserver((model, durationMs, success) => {
      recordProviderCall(model, durationMs, success)
      void recordProviderCallOutcome(model, success)
    })
    unregisterGuard = registerProviderCallGuard(providerCallGuard)
    warmProviderHealthCache()

    // 2. 启动 HTTP 监听
    await new Promise<void>((resolve) => {
      app.listen(config.port, async () => {
        try {
          const { waitForDb } = await import('@excuse/db')
          await waitForDb(3, 500)
          logger.info(`🚀 Server listening on port ${config.port}`)
          resolve()
        }
        catch {
          logger.warn('⚠️ 数据库连接失败，服务已启动但 DB 功能不可用。请先运行：bun run --cwd packages/db db:push')
          resolve() // 不阻塞启动
        }
      })
    })

    // 4. 启动 SSE 监听器
    startSSEListener().catch((err: unknown) => {
      if (isPgTableNotFoundError(err)) {
        logger.error('❌ 数据库表不存在，SSE 监听器无法启动。请先运行：bun run --cwd packages/db db:push')
        return
      }
      const error = err instanceof Error ? err : null
      const aggregateCode = (error?.cause as { aggregateErrors?: Array<{ code?: string }> } | undefined)?.aggregateErrors?.[0]?.code
      const code = aggregateCode ?? (error as NodeJS.ErrnoException)?.code
      if (code === 'ECONNREFUSED') {
        logger.error('❌ PostgreSQL 未启动（连接被拒绝），请检查数据库服务')
      }
      else {
        logger.error({ err }, 'Failed to start SSE listener')
      }
    })

    serverStop = async () => {
      await app.stop()
    }

    // 5. 启动后环境检查
    checkFFmpegAsync().then((warnings) => {
      for (const w of warnings) {
        logger.warn(w)
      }
    })

    // 6. 优雅退出信号处理器
    const SERVER_GRACEFUL_TIMEOUT_MS = 30_000
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.on(signal, () => {
        if (isStopping)
          return
        isStopping = true
        logger.info({ signal }, '🛑 Server shutting down gracefully...')
        gracefulTimeout = setTimeout(() => {
          logger.warn('⏰ Graceful timeout exceeded, forcing exit')
          process.exit(1)
        }, SERVER_GRACEFUL_TIMEOUT_MS)

        stop().then(() => {
          if (gracefulTimeout)
            clearTimeout(gracefulTimeout)
          process.exit(0)
        }).catch((err: unknown) => {
          if (gracefulTimeout)
            clearTimeout(gracefulTimeout)
          logger.error({ err }, 'Error during graceful stop')
          process.exit(1)
        })
      })
    }

    logger.info(
      { host: app.server?.hostname, port: app.server?.port },
      '🦊 Excuse API is running',
    )
  }

  async function stop(): Promise<void> {
    // 清理 provider observer/guard
    if (unregisterObserver)
      unregisterObserver()
    if (unregisterGuard)
      unregisterGuard()

    // 关闭 HTTP server
    if (serverStop) {
      await serverStop()
    }
  }

  return { start, stop }
}
