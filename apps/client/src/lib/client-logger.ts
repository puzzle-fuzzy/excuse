/**
 * Client logger — 前端日志薄封装
 *
 * 统一 console 调用，附带 route/action/context 字段，
 * 便于从 UI 错误追踪到 server request / worker task。
 *
 * 生产环境可配置静默非关键日志（仅保留 error），
 * 开发环境输出带结构化上下文的完整信息。
 */

export interface ClientLogContext {
  /** 页面/路由标识（如 'Workspace', 'CanvasEditor'） */
  route?: string
  /** 用户操作（如 'generate', 'upload', 'loadProject'） */
  action?: string
  /** 关联的 record ID */
  recordId?: string
  /** 关联的 task ID */
  taskId?: string
  /** 关联的 project ID */
  projectId?: string
  /** 附加调试信息 */
  extra?: Record<string, unknown>
}

function formatPrefix(ctx?: ClientLogContext): string {
  const parts: string[] = []
  if (ctx?.route)
    parts.push(ctx.route)
  if (ctx?.action)
    parts.push(ctx.action)
  const prefix = parts.length > 0 ? `[${parts.join(':')}]` : '[client]'
  const ids: string[] = []
  if (ctx?.recordId)
    ids.push(`record=${ctx.recordId}`)
  if (ctx?.taskId)
    ids.push(`task=${ctx.taskId}`)
  if (ctx?.projectId)
    ids.push(`project=${ctx.projectId}`)
  return ids.length > 0 ? `${prefix} ${ids.join(' ')}` : prefix
}

function shouldLog(_level: 'warn' | 'error'): boolean {
  // 生产环境可在此处静默非关键日志（目前全部输出）
  return true
}

export const clientLogger = {
  warn(message: string, ctx?: ClientLogContext): void {
    if (!shouldLog('warn'))
      return
    const prefix = formatPrefix(ctx)
    const extra = ctx?.extra ? ` ${JSON.stringify(ctx.extra)}` : ''
    console.warn(`${prefix} ${message}${extra}`)
  },

  error(message: string, ctx?: ClientLogContext): void {
    if (!shouldLog('error'))
      return
    const prefix = formatPrefix(ctx)
    const extra = ctx?.extra ? ` ${JSON.stringify(ctx.extra)}` : ''
    console.error(`${prefix} ${message}${extra}`)
  },

  /** 仅开发环境输出 info（不影响生产 console 清洁度） */
  info(message: string, ctx?: ClientLogContext): void {
    if (import.meta.env.PROD)
      return
    const prefix = formatPrefix(ctx)
    console.log(`${prefix} ℹ️ ${message}`)
  },
}
