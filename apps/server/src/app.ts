import type { ServerConfig } from './config'
import type { ServerContext } from './context'
import { mkdirSync } from 'node:fs'
/**
 * Elysia 应用工厂 — 把中间件链与路由装配从入口副作用中剥离
 *
 * 设计动机（docs/TODO.md §三、1 端到端冒烟测试）：
 *   - 此前 `index.ts` 在模块顶层就 `new Elysia().use(...)` 并立即 `app.listen`，
 *     任何 import 都会触发监听 + 副作用，无法在测试中以可控方式起停真实应用。
 *   - 抽出 `createElysiaApp(config, ctx)` 后：生产入口仍照常 `listen` + 起 SSE + 注册
 *     provider observer/guard；E2E / 集成测试可拿到「装配好但未监听」的 app，
 *     自行决定端口、注入 fake provider（经 ctx），跑完再 `app.stop()`。
 *
 * 行为保持：中间件注册顺序、路由集合、OpenAPI 挂载条件与原 `index.ts` 完全一致。
 */
import { isAbsolute, join } from 'node:path'
import { cors } from '@elysia/cors'
import { staticPlugin } from '@elysia/static'
import { openapi } from '@elysiajs/openapi'
import { Elysia } from 'elysia'
import { createAuthPlugin } from './plugins/auth'
import { errorHandlerPlugin } from './plugins/error-handler'
import { loggerPlugin } from './plugins/logger'
import { rateLimitPlugin } from './plugins/rate-limit'
import { requestIdPlugin } from './plugins/request-id'
import { securityHeadersPlugin } from './plugins/security-headers'
import { createAdminRoutes } from './routes/admin'
import { createApiKeyRoutes } from './routes/api-keys'
import { createAssetTagRoutes } from './routes/asset-tags'
import { createAssetsRoutes } from './routes/assets'
import { createAuthRoutes } from './routes/auth'
import { createBillingRoutes } from './routes/billing'
import { createCanvasRoutes } from './routes/canvas'
import { createClientErrorRoutes } from './routes/client-errors'
import { createCspReportRoutes } from './routes/csp-report'
import { createGenerateRoutes } from './routes/generate'
import { createHealthRoutes } from './routes/health'
import { createMetricsRoutes } from './routes/metrics'
import { modelsRoutes } from './routes/models'
import { createNotificationRoutes } from './routes/notifications'
import { createOpenAIGatewayRoutes } from './routes/openai-gateway'
import { createSSERoutes } from './routes/sse'
import { createSubjectRoutes } from './routes/subjects'
import { createSubtitleRoutes } from './routes/subtitle'
import { createTaskRoutes } from './routes/tasks'
import { createUploadRoutes } from './routes/upload'

/**
 * 解析 uploads 静态资源根目录
 *
 * - 相对路径（生产默认 `./uploads`）：相对 server 入口所在目录解析，保持历史行为。
 * - 绝对路径（E2E 注入临时目录）：直接使用，避免 `path.join` 把绝对段拼到入口目录下。
 */
function resolveUploadsDir(storageRoot: string): string {
  return isAbsolute(storageRoot) ? storageRoot : join(import.meta.dir, '..', storageRoot)
}

/**
 * 装配 Elysia 中间件链 + 全部路由，返回「未监听」的应用实例
 *
 * 中间件注册顺序（从上到下依次生效）：
 *   OpenAPI → 日志 → 请求ID → 限流 → CORS → 静态文件 → 错误处理 → 认证 → 各业务路由
 *
 * @param config 服务端配置（端口、CORS、存储根目录等）
 * @param ctx    共享 ServerContext（provider / storage / asrClient）—— 测试可注入 fake
 */
export function createElysiaApp(config: ServerConfig, ctx: ServerContext) {
  const uploadsDir = resolveUploadsDir(config.storageRoot)
  mkdirSync(uploadsDir, { recursive: true })

  /**
   * OpenAPI 文档（Scalar UI + 规范）仅在非生产环境挂载。
   * 生产环境暴露 `/openapi` 会向匿名调用者泄露全部路由形状、schema 与鉴权方案，
   * 故生产环境不注册该插件（route 不存在 → 404）。
   */
  const enableOpenapi = process.env.NODE_ENV !== 'production'

  return new Elysia({ serve: { maxRequestBodySize: 200 * 1024 * 1024 } }) // 200MB（与 nginx client_max_body_size 对齐）
    .use(enableOpenapi
      ? openapi({
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
        })
      : new Elysia())
    .use(loggerPlugin)
    .use(requestIdPlugin)
    .use(securityHeadersPlugin)
    .use(rateLimitPlugin)
    .use(cors({
      // 生产环境收敛到仅允许配置的前端域名，避免开发地址（localhost:8007）
      // 在线上仍被加入白名单带来的跨域安全隐患。
      origin: process.env.NODE_ENV === 'production'
        ? [config.frontendUrl]
        : [config.frontendUrl, 'http://localhost:8007'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
    }))
    .use(staticPlugin({
      assets: uploadsDir,
      prefix: '/api/uploads',
    }))
    // 统一错误处理 — 在路由之前注册，捕获所有下游抛出的 AppError
    .use(errorHandlerPlugin)
    .use(createAuthPlugin(config))
    .use(createAuthRoutes(config))
    .use(createAdminRoutes(config))
    .use(createApiKeyRoutes(config))
    .use(createHealthRoutes(config))
    .use(modelsRoutes)
    .use(createCanvasRoutes(config, ctx))
    .use(createGenerateRoutes(config, ctx))
    .use(createAssetsRoutes(config))
    .use(createAssetTagRoutes(config))
    .use(createUploadRoutes(config))
    .use(createSubjectRoutes(config, ctx))
    .use(createSubtitleRoutes(config, ctx))
    .use(createTaskRoutes(config))
    .use(createNotificationRoutes(config))
    .use(createSSERoutes(config))
    .use(createBillingRoutes(config))
    .use(createOpenAIGatewayRoutes(config, ctx))
    .use(createMetricsRoutes(config))
    .use(createClientErrorRoutes(config))
    .use(createCspReportRoutes(config))
}
