import { checkFFmpegAsync } from '@excuse/ffmpeg'
import { registerProviderCallGuard, registerProviderCallObserver } from '@excuse/provider'
import { isPgTableNotFoundError, logger } from '@excuse/shared'
import { createElysiaApp } from './app'
import { loadConfig } from './config'
import { createServerContext } from './context'
import { recordProviderCall } from './services/metrics'
import { providerCallGuard, recordProviderCallOutcome, warmProviderHealthCache } from './services/provider-health'
import { startSSEListener } from './services/sse-manager'

const config = loadConfig()

/**
 * 把 DashScopeClient 的所有调用接入进程内 metrics 收集器。
 *
 * DashScopeClient 在 server / worker 多个调用点分散实例化（无集中初始化点），
 * 这里通过 module-level observer registry 一次性挂接，所有实例自动覆盖。
 * worker 进程不调用本文件，因此 worker 内的 provider 调用不会聚合到 server metrics ——
 * 这是预期行为，跨进程聚合留给后续 Prometheus federation。
 */
registerProviderCallObserver((model, durationMs, success) => {
  recordProviderCall(model, durationMs, success)
  void recordProviderCallOutcome(model, success)
})

/**
 * 注册 provider 调用前置 guard（断路器降级）：模型连续失败进入冷却窗口时，
 * 在真正发起 DashScope 调用前快速失败（抛 ModelDegradedError），避免用户空等。
 * 健康判定以进程内缓存为准（见 services/provider-health.ts）。
 */
registerProviderCallGuard(providerCallGuard)

// 启动时 warm 模型健康缓存，让 guard 从第一次调用起即可阻断已知降级模型。
warmProviderHealthCache()

/**
 * =====================================================
 * Excuse API — 应用入口
 * =====================================================
 *
 * 启动流程：
 *   1. 加载配置 → 2. 构造 ServerContext（注入共享 provider 实例）
 *   → 3. 装配 Elysia 应用（createElysiaApp）→ 4. 启动 HTTP 监听 → 5. 启动 SSE 监听器
 *
 * 应用装配（中间件 + 路由）抽到 `./app.ts` 的 `createElysiaApp`，便于 E2E / 集成测试
 * 以「装配好但未监听」的方式复用同一套真实应用、注入 fake provider。
 * 导出的 `App` 类型供客户端 @elysia/eden treaty 做端到端类型推导。
 */

// ServerContext — 构造期注入共享 provider 实例，测试可经 overrides 挂载 fake adapter
const ctx = createServerContext(config)

// 装配应用（路由 + 中间件）；副作用（listen / SSE / 信号处理）留在本入口
const app = createElysiaApp(config, ctx)

/** 导出 App 类型，供客户端 eden treaty 进行端到端类型推导 */
export type App = typeof app
export default app

app.listen(config.port, async () => {
  // 启动时检查数据库连接（非阻塞，失败仅记录日志）
  try {
    const { waitForDb } = await import('@excuse/db')
    await waitForDb(3, 500)
    logger.info(`🚀 Server listening on port ${config.port}`)
  }
  catch {
    logger.warn('⚠️ 数据库连接失败，服务已启动但 DB 功能不可用。请先运行：bun run --cwd packages/db db:push')
  }
})

// 启动 PostgreSQL LISTEN — 接收 Worker 的生成状态通知并推送到 SSE 客户端
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

logger.info(
  { host: app.server?.hostname, port: app.server?.port },
  '🦊 Excuse API is running',
)

// ── 启动后环境检查：FFmpeg + libass ──────────────────
checkFFmpegAsync().then((warnings) => {
  for (const w of warnings) {
    logger.warn(w)
  }
})

// ── 优雅退出 ──────────────────────────────────────────
// K8s / 负载均衡滚动更新发 SIGTERM 时，等待 in-flight 请求完成后再退出，
// 避免正在处理的 HTTP 请求和 SSE 长连接被硬中断。与 worker 的退出模式保持一致。
const SERVER_GRACEFUL_TIMEOUT_MS = 30_000
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info({ signal }, '🛑 Server shutting down gracefully...')
    const force = setTimeout(() => {
      logger.warn('⏰ Graceful timeout exceeded, forcing exit')
      process.exit(1)
    }, SERVER_GRACEFUL_TIMEOUT_MS)

    // app.stop() 关闭 HTTP server 并等待 in-flight 请求收尾，成功后正常退出。
    app.stop().then(() => {
      clearTimeout(force)
      process.exit(0)
    }).catch((err: unknown) => {
      clearTimeout(force)
      logger.error({ err }, 'Error during graceful stop')
      process.exit(1)
    })
  })
}
