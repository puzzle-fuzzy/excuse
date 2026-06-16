import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { cors } from '@elysia/cors'
import { staticPlugin } from '@elysia/static'
import { openapi } from '@elysiajs/openapi'
import { swagger } from '@elysiajs/swagger'
import { checkFFmpegAsync, registerProviderCallGuard, registerProviderCallObserver } from '@excuse/provider'
import { isPgTableNotFoundError, logger } from '@excuse/shared'
import { Elysia } from 'elysia'
import { loadConfig } from './config'
import { createAuthPlugin } from './plugins/auth'
import { loggerPlugin } from './plugins/logger'
import { rateLimitPlugin } from './plugins/rate-limit'
import { requestIdPlugin } from './plugins/request-id'
import { createAdminRoutes } from './routes/admin'
import { createApiKeyRoutes } from './routes/api-keys'
import { createAssetTagRoutes } from './routes/asset-tags'
import { createAssetsRoutes } from './routes/assets'
import { createAuthRoutes } from './routes/auth'
import { createBillingRoutes } from './routes/billing'
import { createCanvasRoutes } from './routes/canvas'
import { createGenerateRoutes } from './routes/generate'
import { createHealthRoutes } from './routes/health'
import { createMetricsRoutes } from './routes/metrics'
import { modelsRoutes } from './routes/models'
import { createNotificationRoutes } from './routes/notifications'
import { createOpenAIGatewayRoutes } from './routes/openai-gateway'
import { createSSERoutes } from './routes/sse'
import { createSubtitleRoutes } from './routes/subtitle'
import { createUploadRoutes } from './routes/upload'
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
 *   1. 加载配置 → 2. 确保 uploads 目录 → 3. 组装 Elysia 中间件链
 *   → 4. 注册所有路由模块 → 5. 启动 HTTP 监听 → 6. 启动 SSE 监听器
 *
 * 导出的 `App` 类型供客户端 @elysia/eden treaty 做端到端类型推导。
 */

// 确保 uploads 目录存在
const uploadsDir = join(import.meta.dir, '..', config.storageRoot)
mkdirSync(uploadsDir, { recursive: true })

/**
 * Elysia 应用实例
 *
 * 中间件注册顺序（从上到下依次生效）：
 *   OpenAPI / Swagger → 日志 → CORS → 静态文件 → 认证 → 各业务路由
 */
const app = new Elysia()
  .use(openapi({
    documentation: {
      info: {
        title: 'Excuse API',
        version: '0.1.0',
        description: 'AI 内容生成平台 — 创意流水线 API 文档',
      },
      tags: [
        { name: '健康检查', description: '服务可用性探测' },
        { name: '认证', description: '用户注册、登录、身份验证' },
        { name: '模型', description: '可用 AI 模型目录' },
        { name: '生成', description: 'AI 内容生成任务（文本/图片/视频）' },
        { name: '资产', description: '统一资产中心 — 普通生成、Canvas 资产、上传文件' },
        { name: 'Canvas', description: 'AI 视频制作流水线 — 项目管理、阶段执行、资源编辑' },
        { name: '上传', description: '文件上传与管理' },
        { name: '视频加字幕', description: '上传视频、ASR 转录、样式编辑、导出带字幕视频' },
        { name: '计费', description: '费用统计与查询' },
        { name: '实时推送', description: 'SSE 连接与事件推送' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: '通过 Authorization: Bearer <token> 传递 JWT',
          },
        },
      },
    },
    path: '/openapi',
  }))
  .use(swagger({
    path: '/api/swagger',
    documentation: {
      info: {
        title: 'Excuse API',
        version: '0.1.0',
        description: 'AI 内容生成平台 — 创意流水线 API 文档',
      },
    },
  }))
  .use(loggerPlugin)
  .use(requestIdPlugin)
  .use(rateLimitPlugin)
  .use(cors({
    origin: [config.frontendUrl, 'http://localhost:8007'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  }))
  .use(staticPlugin({
    assets: uploadsDir,
    prefix: '/api/uploads',
  }))
  .use(createAuthPlugin(config))
  .use(createAuthRoutes(config))
  .use(createAdminRoutes(config))
  .use(createApiKeyRoutes(config))
  .use(createHealthRoutes())
  .use(modelsRoutes)
  .use(createCanvasRoutes(config))
  .use(createGenerateRoutes(config))
  .use(createAssetsRoutes(config))
  .use(createAssetTagRoutes(config))
  .use(createUploadRoutes(config))
  .use(createSubtitleRoutes(config))
  .use(createNotificationRoutes(config))
  .use(createSSERoutes(config))
  .use(createBillingRoutes(config))
  .use(createOpenAIGatewayRoutes(config))
  .use(createMetricsRoutes(config))

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
