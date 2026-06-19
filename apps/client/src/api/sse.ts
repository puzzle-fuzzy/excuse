import type { SSEGenerationStatusEvent, SSENotificationEvent, SSEPipelineNodeEvent } from '@excuse/shared'
import { parseSSEGenerationStatusEvent, parseSSENotificationEvent, parseSSEPipelineNodeEvent } from '@excuse/shared'
import { fetchEventSource } from '@microsoft/fetch-event-source'
import { clientLogger } from '../lib/client-logger'
import { getAuthToken, resolveApiBaseUrl, setAuthToken } from './client'

/**
 * SSE 事件类型映射 — 服务器推送的事件名与 payload 结构
 *
 * - generation_status: 生成任务状态变更（pending → processing → succeeded/failed）
 * - pipeline_node_update: Canvas pipeline 各节点进度更新
 * - notification: 系统通知（余额预警、任务完成等）
 */
interface SSEEventMap {
  generation_status: SSEGenerationStatusEvent
  pipeline_node_update: SSEPipelineNodeEvent
  notification: SSENotificationEvent
}

// ===== 错误类型 — 控制重连策略 =====
// fetch-event-source 通过 onopen 抛出的错误类型决定是否重连：
//   - RetriableError: onerror 返回延迟值后自动重试（5xx、网络中断）
//   - FatalError: 不重连，连接终止（4xx 非 401/403）
//   - UnauthorizedError: 401/403，停止重连并清理登录态

class RetriableError extends Error {}
class FatalError extends Error {}
class UnauthorizedError extends FatalError {}

/**
 * SSE 客户端 — 管理与服务器的实时连接
 *
 * 使用 @microsoft/fetch-event-source（基于 Fetch API）:
 *   - 支持自定义 Authorization header（JWT 不再暴露在 URL 中）
 *   - 可根据 HTTP 状态码区分重连策略
 *   - AbortController 可靠中止 fetch 流
 *   - 事件类型分发（generation_status / pipeline_node_update / notification / heartbeat）
 */
class SSEClient {
  private abortController: AbortController | null = null
  private isConnecting = false
  private handlers: { [K in keyof SSEEventMap]?: Set<(data: SSEEventMap[K]) => void> } = {}
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  /** 用户主动调用 disconnect() 时为 true，此时不触发自动重连 */
  private intentionallyClosed = false
  private openCallbacks = new Set<() => void>()
  /** 连接断开（重连耗尽后）回调 — 上层切换到 polling mode */
  private closeCallbacks = new Set<() => void>()

  /** 指数退避重连参数 */
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectBaseDelay = 3000

  /**
   * 建立 SSE 连接
   * 登录后优先使用内存 JWT；刷新页面后内存 JWT 会丢失，此时依赖 httpOnly cookie 认证。
   */
  connect() {
    if (this.abortController || this.isConnecting)
      return

    const token = getAuthToken()

    this.intentionallyClosed = false
    this.isConnecting = true
    this.abortController = new AbortController()

    const baseUrl = resolveApiBaseUrl()
    const notifyOpen = this.notifyOpen.bind(this)

    fetchEventSource(`${baseUrl}/api/sse`, {
      signal: this.abortController.signal,
      credentials: 'include',
      ...(token && { headers: { Authorization: `Bearer ${token}` } }),
      async onopen(response) {
        if (response.ok && response.headers.get('content-type')?.includes('text/event-stream')) {
          notifyOpen()
          return
        }

        if (response.status === 401 || response.status === 403) {
          throw new UnauthorizedError('SSE authentication failed')
        }

        if (response.status >= 500) {
          throw new RetriableError(`SSE server error: ${response.status}`)
        }

        throw new FatalError(`Unexpected SSE response: ${response.status}`)
      },
      onmessage: (msg) => {
        this.handleMessage(msg.event, msg.data)
      },
      onerror: (err) => {
        if (this.intentionallyClosed)
          throw err

        if (err instanceof UnauthorizedError) {
          this.cleanupConnection()
          // 401/403: 清理登录态，防止后续请求继续使用失效 token
          setAuthToken(null)
          clientLogger.warn('Authentication failed, clearing auth state and stopping reconnect', { route: 'SSE', action: 'connect' })
          throw err
        }

        if (err instanceof FatalError)
          throw err

        // RetriableError / 网络错误：返回指数退避延迟（ms）给 fetch-event-source
        // fetch-event-source 内部重连机制与我们的 scheduleReconnect 互补：
        //   - onerror 返回 delay → fetch-event-source 自动重连
        //   - onclose 或 catch → 我们手动 scheduleReconnect（也用指数退避）
        const delay = Math.min(this.reconnectBaseDelay * 2 ** this.reconnectAttempts, 30000)
        this.reconnectAttempts++
        if (this.reconnectAttempts > this.maxReconnectAttempts) {
          // 超限后通知上层切换 polling，并让 fetch-event-source 停止重连
          this.reconnectAttempts = 0
          for (const cb of this.closeCallbacks) {
            try {
              cb()
            }
            catch (e) {
              clientLogger.error(`onClose callback error: ${(e as Error).message}`, { route: 'SSE', action: 'close' })
            }
          }
          throw new FatalError('Max SSE reconnect attempts reached')
        }
        return delay
      },
      onclose: () => {
        this.cleanupConnection()
        if (!this.intentionallyClosed) {
          this.scheduleReconnect()
        }
      },
      openWhenHidden: true, // 保持后台 tab 连接不断开，确保 Canvas 页面切走后仍能收到 pipeline 更新
    }).catch((err) => {
      this.cleanupConnection()
      if (!this.intentionallyClosed && !(err instanceof UnauthorizedError) && !(err instanceof FatalError && err.message === 'Max SSE reconnect attempts reached')) {
        clientLogger.warn(`Connection closed: ${err}`, { route: 'SSE', action: 'close' })
        this.scheduleReconnect()
      }
    }).finally(() => {
      this.isConnecting = false
    })
  }

  disconnect() {
    this.intentionallyClosed = true
    this.cancelReconnect()
    this.cleanupConnection()
  }

  /**
   * 注册连接建立回调 — 首次连接和重连都会触发。
   * RealtimeSync store 用此回调在重连后刷新可能错过的事件。
   */
  onOpen(callback: () => void): () => void {
    this.openCallbacks.add(callback)
    return () => {
      this.openCallbacks.delete(callback)
    }
  }

  /**
   * 注册连接断开回调 — 重连耗尽后触发，上层切换到 polling mode。
   * 正常 disconnect() 不触发此回调。
   */
  onClose(callback: () => void): () => void {
    this.closeCallbacks.add(callback)
    return () => {
      this.closeCallbacks.delete(callback)
    }
  }

  /** 查询当前是否处于连接状态 */
  isConnected(): boolean {
    return this.abortController !== null && !this.intentionallyClosed
  }

  private notifyOpen() {
    // 重连成功时重置计数器
    this.reconnectAttempts = 0
    for (const cb of this.openCallbacks) {
      try {
        cb()
      }
      catch (err) {
        clientLogger.error(`onOpen callback error: ${(err as Error).message}`, { route: 'SSE', action: 'open' })
      }
    }
  }

  /**
   * 订阅事件 — 完全类型安全
   * event 名称决定 handler 的参数类型
   * @returns 取消订阅的函数
   */
  on<K extends keyof SSEEventMap>(event: K, handler: (data: SSEEventMap[K]) => void): () => void {
    let set = this.handlers[event] as Set<(data: SSEEventMap[K]) => void> | undefined
    if (!set) {
      set = new Set<(data: SSEEventMap[K]) => void>()
      ;(this.handlers as Record<string, unknown>)[event] = set
    }
    set.add(handler)
    return () => {
      const existing = this.handlers[event] as Set<(data: SSEEventMap[K]) => void> | undefined
      existing?.delete(handler)
    }
  }

  reconnect() {
    this.disconnect()
    this.connect()
  }

  // ===== 事件解析 =====

  private handleMessage(event: string, data: string) {
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    }
    catch {
      clientLogger.error(`Invalid JSON for ${event} event`, { route: 'SSE', action: 'parse' })
      return
    }

    switch (event) {
      case 'generation_status': {
        const evt = parseSSEGenerationStatusEvent(parsed)
        if (evt)
          this.emit('generation_status', evt)
        else
          clientLogger.warn('Discarded malformed generation_status event', { route: 'SSE', action: 'parse', extra: { event: 'generation_status' } })
        break
      }
      case 'pipeline_node_update': {
        const evt = parseSSEPipelineNodeEvent(parsed)
        if (evt)
          this.emit('pipeline_node_update', evt)
        else
          clientLogger.warn('Discarded malformed pipeline_node_update event', { route: 'SSE', action: 'parse', extra: { event: 'pipeline_node_update' } })
        break
      }
      case 'notification': {
        const evt = parseSSENotificationEvent(parsed)
        if (evt)
          this.emit('notification', evt)
        else
          clientLogger.warn('Discarded malformed notification event', { route: 'SSE', action: 'parse', extra: { event: 'notification' } })
        break
      }
      case 'heartbeat':
        // 服务端 30s 心跳，无需业务处理；连接本身保活由 fetch-event-source 管理
        break
      case 'connected':
        console.info('[SSE] Connected:', data)
        break
      default:
        console.debug('[SSE] Ignored event:', event)
    }
  }

  // ===== 内部工具 =====

  private emit<K extends keyof SSEEventMap>(event: K, data: SSEEventMap[K]) {
    const set = this.handlers[event] as Set<(data: SSEEventMap[K]) => void> | undefined
    if (!set)
      return
    for (const handler of set) {
      try {
        handler(data)
      }
      catch (err) {
        clientLogger.error(`Handler error for event "${event}": ${(err as Error).message}`, { route: 'SSE', action: 'handler' })
      }
    }
  }

  private cleanupConnection() {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
  }

  private scheduleReconnect() {
    this.cancelReconnect()

    // 超过最大重连次数 → 通知上层切换到 polling mode
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      clientLogger.warn(`Max reconnect attempts (${this.maxReconnectAttempts}) reached, switching to polling mode`, { route: 'SSE', action: 'reconnect' })
      this.reconnectAttempts = 0
      for (const cb of this.closeCallbacks) {
        try {
          cb()
        }
        catch (err) {
          clientLogger.error(`onClose callback error: ${(err as Error).message}`, { route: 'SSE', action: 'close' })
        }
      }
      return
    }

    // 指数退避：base * 2^attempts，上限 30s
    const delay = Math.min(this.reconnectBaseDelay * 2 ** this.reconnectAttempts, 30000)
    this.reconnectAttempts++
    console.info(`[SSE] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`)

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private cancelReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
}

/** SSE 客户端单例 */
export const sseClient = new SSEClient()
