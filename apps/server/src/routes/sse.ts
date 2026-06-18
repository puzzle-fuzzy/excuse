import type { ServerConfig } from '../config'
import { createLogger } from '@excuse/shared'
import { Elysia, sse } from 'elysia'
import { createRequireAuthPlugin } from '../plugins/auth'
import { addConnection, removeConnection, sweepStaleSseConnections } from '../services/sse-manager'

const logger = createLogger('sse')

// ===== Push → Pull 适配器 =====
// Elysia 的 sse() 使用 generator（pull 模式），
// 但我们的消息来自 PostgreSQL LISTEN（push 模式）。
// AsyncChannel 通过 Promise 队列桥接两者。

interface SSEMessage {
  event: string
  data: unknown
}

function createAsyncChannel() {
  let resolver: ((value: SSEMessage) => void) | null = null
  const queue: SSEMessage[] = []

  return {
    push(item: SSEMessage) {
      if (resolver) {
        resolver(item)
        resolver = null
      }
      else {
        queue.push(item)
      }
    },
    async next(): Promise<SSEMessage> {
      if (queue.length > 0)
        return queue.shift()!
      return new Promise<SSEMessage>((resolve) => {
        resolver = resolve
      })
    },
  }
}

// ===== SSE 路由 =====

/**
 * SSE 端点 — 实时推送生成状态和通知
 *
 * 客户端通过 fetchEventSource 连接: GET /api/sse
 * 浏览器端优先使用 httpOnly cookie（credentials: include）
 * 编程式客户端可使用 Authorization: Bearer <jwt>
 * Query token 已移除 — JWT 不再暴露在 URL 中（避免日志泄露风险）
 * 支持的事件类型:
 *   - connected: 连接建立
 *   - heartbeat: 心跳保活（30 秒间隔）
 *   - generation_status: 生成任务状态变更
 *   - pipeline_node_update: Canvas pipeline 进度
 *   - notification: 通知（预留）
 */
export function createSSERoutes(config: ServerConfig) {
  return new Elysia({ prefix: '/api' })
    .use(createRequireAuthPlugin(config))
    .get('/sse', async function* ({ userId, set }) {
      const channel = createAsyncChannel()
      const sender = (event: string, data: unknown) => {
        channel.push({ event, data })
      }

      const result = addConnection(userId, sender)
      if (!result.accepted) {
        set.status = 503
        yield sse({
          event: 'error',
          data: { message: result.reason ?? 'SSE 连接被拒绝' },
        })
        return
      }

      try {
        // 连接建立事件
        yield sse({
          event: 'connected',
          data: { timestamp: new Date().toISOString() },
        })

        // 心跳保活 + 空闲连接回收 — 防止慢客户端/半开连接占用内存
        const heartbeat = setInterval(() => {
          channel.push({
            event: 'heartbeat',
            data: { timestamp: new Date().toISOString() },
          })
          // 每轮心跳同步清理空闲 >60s 的死连接
          const swept = sweepStaleSseConnections()
          if (swept > 0) {
            logger.debug({ swept }, 'SSE stale connections swept')
          }
        }, 30_000)

        try {
          // 持续等待并推送消息
          while (true) {
            const msg = await channel.next()
            yield sse({ event: msg.event, data: msg.data })
          }
        }
        finally {
          clearInterval(heartbeat)
        }
      }
      finally {
        removeConnection(userId, sender)
      }
    }, {
      detail: {
        summary: 'SSE 实时推送连接',
        description: '通过 Server-Sent Events 建立长连接，实时推送生成状态变更和 Canvas pipeline 进度。浏览器端使用 httpOnly cookie + credentials: include 认证；编程式客户端可使用 Authorization: Bearer <jwt>。不支持 query token。支持事件：connected、heartbeat（30s）、generation_status、pipeline_node_update',
        tags: ['实时推送'],
        security: [{ bearerAuth: [] }],
        hide: true,
      },
    })
}
