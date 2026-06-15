import pino from 'pino'

export type Logger = pino.Logger

/**
 * pino 错误序列化器 — 精简 DrizzleQueryError 输出
 *
 * DrizzleQueryError 默认序列化会输出完整 SQL、params、嵌套 cause 全栈等 ~30 行，
 * 此序列化器将其压缩为 2-3 行（仅保留 PG 核心错误信息）。
 * 对普通 Error 保留 pino 默认行为 + 补充 `.code` 属性。
 */
function serializeDbError(err: unknown): unknown {
  if (typeof err !== 'object' || err === null)
    return err

  const error = err as Error & {
    query?: string
    params?: unknown[]
    cause?: Error & { code?: string, severity?: string, table?: string }
  }

  // DrizzleQueryError: 通过 .query + .params 特征检测（该类不设置 .name）
  // 输出 PG cause 的精简信息，而非 Drizzle 包装的完整 SQL
  if ('query' in error && 'params' in error && error.cause) {
    return {
      message: error.cause.message,
      code: error.cause.code,
      severity: error.cause.severity,
      table: error.cause.table,
    }
  }

  // 普通 Error: 保留 pino 默认输出 + 补充系统级 .code
  const result: Record<string, unknown> = {
    message: error.message,
    stack: error.stack,
  }
  if ('code' in error)
    result.code = error.code
  return result
}

/** 浏览器环境：pino 降级为 console 输出（无 transport、无 redact） */
function createBrowserLogger(name: string): Logger {
  return pino({ name, level: 'debug' })
}

/** Node.js 环境：完整 pino + pino-pretty / redact */
function createNodeLogger(name: string, options?: pino.LoggerOptions): Logger {
  const isDev = process.env.NODE_ENV !== 'production'

  const transport = isDev && typeof pino.transport === 'function'
    ? pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      })
    : undefined

  return pino(
    {
      name,
      level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
      serializers: { err: serializeDbError },
      redact: {
        paths: [
          'password',
          'token',
          'secret',
          'apiKey',
          'accessKeyId',
          'accessKeySecret',
          'authorization',
          '*.password',
          '*.token',
          '*.secret',
          '*.apiKey',
        ],
        censor: '[Redacted]',
      },
      ...options,
    },
    transport,
  )
}

/**
 * 创建应用 Logger
 *
 * - Node.js: JSON 结构化日志 + pino-pretty(开发) + redact 脱敏
 * - 浏览器: pino 降级为 console 输出
 */
export function createLogger(name: string, options?: pino.LoggerOptions): Logger {
  const isBrowser = typeof globalThis !== 'undefined'
    && 'window' in globalThis
    && typeof (globalThis as Record<string, unknown>).window !== 'undefined'
  return isBrowser
    ? createBrowserLogger(name)
    : createNodeLogger(name, options)
}

/** 全局单例 Logger，用于整个应用 */
export const logger = createLogger('excuse')
