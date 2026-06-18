import type { ServerConfig } from '../config'
import { logger } from '@excuse/shared'
import { Elysia } from 'elysia'

interface ClientErrorReport {
  message: string
  stack?: string
  url?: string
  userAgent?: string
}

/**
 * POST /api/client-errors — 前端运行时错误上报端点
 *
 * ErrorBoundary 捕获的 JS 运行时错误或 React 渲染错误会经此端点写入 server 日志，
 * 让开发团队不依赖用户反馈即可感知生产环境前端异常。
 *
 * 本端点不要求认证（错误上报不应因 cookie 过期而丢失），不持久化到 DB。
 */
export function createClientErrorRoutes(_config: ServerConfig) {
  return new Elysia({ prefix: '/api/client-errors' })
    .post('/', async ({ body }) => {
      const data = body as ClientErrorReport
      logger.error({ message: data.message, stack: data.stack, url: data.url, userAgent: data.userAgent }, 'frontend error report')
      return { ok: true }
    })
}
