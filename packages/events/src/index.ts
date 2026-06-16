import type { GenerationNotifyPayload, NotificationNotifyPayload, SSEGenerationStatusEvent, SSENotificationEvent, SSEPipelineNodeEvent } from '@excuse/shared'

export const GENERATION_STATUS_CHANNEL = 'generation_status'
export const NOTIFICATION_CHANNEL = 'notification'
export const SSE_GENERATION_STATUS_EVENT = 'generation_status'
export const SSE_PIPELINE_NODE_EVENT = 'pipeline_node_update'
export const SSE_NOTIFICATION_EVENT = 'notification'

export interface UserSSEEvent {
  userId: string
  event: typeof SSE_GENERATION_STATUS_EVENT | typeof SSE_PIPELINE_NODE_EVENT | typeof SSE_NOTIFICATION_EVENT
  data: SSEGenerationStatusEvent | SSEPipelineNodeEvent | SSENotificationEvent
}

export type EventSender = (event: string, data: unknown) => void
export type EventDispatchErrorHandler = (error: unknown, send: EventSender) => void

export interface GenerationNotifyDispatchResult {
  payload: GenerationNotifyPayload
  events: UserSSEEvent[]
}

export interface GenerationNotifyDispatcherOptions {
  dispatchToUser: (userId: string, event: string, data: unknown) => void
  onError?: (error: unknown, rawPayload: string) => void
}

export interface AddConnectionResult {
  accepted: boolean
  userCount: number
  totalCount: number
  reason?: string
}

export class UserEventHub {
  private readonly connections = new Map<string, Set<EventSender>>()
  private readonly maxTotalConnections: number
  private readonly maxConnectionsPerUser: number

  constructor(maxTotalConnections: number = 10_000, maxConnectionsPerUser: number = 3) {
    this.maxTotalConnections = maxTotalConnections
    this.maxConnectionsPerUser = maxConnectionsPerUser
  }

  addConnection(userId: string, send: EventSender): AddConnectionResult {
    const totalCount = this.connections.size

    // 全局总量上限检查
    if (totalCount >= this.maxTotalConnections) {
      return { accepted: false, userCount: 0, totalCount, reason: `SSE 连接数已达全局上限 (${this.maxTotalConnections})` }
    }

    // 单用户连接数上限检查
    const currentUserCount = this.connections.get(userId)?.size ?? 0
    if (currentUserCount >= this.maxConnectionsPerUser) {
      return { accepted: false, userCount: currentUserCount, totalCount, reason: `SSE 连接数已达单用户上限 (${this.maxConnectionsPerUser})` }
    }

    if (!this.connections.has(userId))
      this.connections.set(userId, new Set())

    const userConnections = this.connections.get(userId)!
    userConnections.add(send)
    return { accepted: true, userCount: userConnections.size, totalCount: totalCount + 1 }
  }

  removeConnection(userId: string, send: EventSender): number {
    const userConnections = this.connections.get(userId)
    if (!userConnections)
      return 0

    userConnections.delete(send)
    const remaining = userConnections.size
    if (remaining === 0)
      this.connections.delete(userId)

    return remaining
  }

  dispatchToUser(userId: string, event: string, data: unknown, onError?: EventDispatchErrorHandler): number {
    const userConnections = this.connections.get(userId)
    if (!userConnections || userConnections.size === 0)
      return 0

    let dispatched = 0
    for (const send of userConnections) {
      try {
        send(event, data)
        dispatched += 1
      }
      catch (error) {
        onError?.(error, send)
      }
    }
    return dispatched
  }

  getOnlineUserCount(): number {
    return this.connections.size
  }

  getConnectionCount(userId: string): number {
    return this.connections.get(userId)?.size ?? 0
  }
}

export function parseGenerationNotifyPayload(rawPayload: string): GenerationNotifyPayload {
  return JSON.parse(rawPayload) as GenerationNotifyPayload
}

export function mapGenerationNotifyToSSEEvents(payload: GenerationNotifyPayload): UserSSEEvent[] {
  const events: UserSSEEvent[] = [
    {
      userId: payload.accountId,
      event: SSE_GENERATION_STATUS_EVENT,
      data: {
        id: payload.recordId,
        taskId: payload.taskId,
        traceId: payload.traceId,
        status: payload.status,
        category: payload.category,
        model: payload.model,
        ...(payload.outputResult && { outputResult: payload.outputResult }),
        ...(payload.errorMessage && { errorMessage: payload.errorMessage }),
        ...(payload.cost && { cost: payload.cost }),
      },
    },
  ]

  if (payload.canvasMeta) {
    events.push({
      userId: payload.accountId,
      event: SSE_PIPELINE_NODE_EVENT,
      data: {
        projectId: payload.canvasMeta.projectId,
        nodeType: 'shot',
        nodeId: payload.canvasMeta.shotId,
        status: payload.status === 'succeeded' ? 'completed' : payload.status === 'failed' ? 'failed' : 'running',
      },
    })

    if (payload.canvasMeta.projectStatus) {
      events.push({
        userId: payload.accountId,
        event: SSE_PIPELINE_NODE_EVENT,
        data: {
          projectId: payload.canvasMeta.projectId,
          nodeType: 'phase',
          nodeId: 'videos',
          status: payload.canvasMeta.projectStatus === 'completed' ? 'completed' : 'failed',
          data: { projectStatus: payload.canvasMeta.projectStatus },
        },
      })
    }
  }

  return events
}

export function createGenerationNotifyDispatcher(options: GenerationNotifyDispatcherOptions) {
  return (rawPayload: string): GenerationNotifyDispatchResult | null => {
    try {
      const payload = parseGenerationNotifyPayload(rawPayload)
      const events = mapGenerationNotifyToSSEEvents(payload)
      for (const event of events) {
        options.dispatchToUser(event.userId, event.event, event.data)
      }
      return { payload, events }
    }
    catch (error) {
      options.onError?.(error, rawPayload)
      return null
    }
  }
}

// ===== Notification channel（P2-2） =====

export interface NotificationDispatchResult {
  payload: NotificationNotifyPayload
}

export interface NotificationDispatcherOptions {
  dispatchToUser: (userId: string, event: string, data: unknown) => void
  onError?: (error: unknown, rawPayload: string) => void
}

/** 解析 NOTIFY 'notification' 频道的 JSON 载荷 */
export function parseNotificationNotifyPayload(rawPayload: string): NotificationNotifyPayload {
  return JSON.parse(rawPayload) as NotificationNotifyPayload
}

/** 将通知载荷映射为下发到前端的 SSENotificationEvent（去掉路由用 accountId） */
export function mapNotificationNotifyToSSEEvent(payload: NotificationNotifyPayload): SSENotificationEvent {
  return {
    id: payload.id,
    type: payload.type,
    title: payload.title,
    ...(payload.body ? { body: payload.body } : {}),
    ...(payload.meta ? { meta: payload.meta } : {}),
    read: payload.read,
    createdAt: payload.createdAt,
  }
}

/**
 * 创建 notification 频道分发器
 *
 * Server 的 startSSEListener 通过 `pgClient.listen(NOTIFICATION_CHANNEL, ...)`
 * 接收 Worker / Server 自身通过 `notifyNotification()` 发来的通知，解析后推送到
 * 对应用户的 SSE 连接。
 */
export function createNotificationDispatcher(options: NotificationDispatcherOptions) {
  return (rawPayload: string): NotificationDispatchResult | null => {
    try {
      const payload = parseNotificationNotifyPayload(rawPayload)
      options.dispatchToUser(payload.accountId, SSE_NOTIFICATION_EVENT, mapNotificationNotifyToSSEEvent(payload))
      return { payload }
    }
    catch (error) {
      options.onError?.(error, rawPayload)
      return null
    }
  }
}

// ===== PostgreSQL LISTEN 频道注册 wiring =====
// 把「订阅哪些 channel、把 raw payload 交给哪个 handler」沉淀到纯 package。
// 不创建 DB 连接、不打 server logger、不吞错误 —— transport 与 handler/错误策略都由 server 注入。

/** PG LISTEN transport 的最小形状。server 用真实 pgClient 满足它，测试用 fake。 */
export interface NotifyListenerTransport {
  listen: (channel: string, handler: (rawPayload: string) => void) => (Promise<unknown> | unknown)
}

/** startNotifyListeners 入参 —— 两个 channel 的 handler 由调用方提供 */
export interface StartNotifyListenersInput {
  transport: NotifyListenerTransport
  onGenerationStatus: (rawPayload: string) => void
  onNotification: (rawPayload: string) => void
}

/**
 * 在给定 transport 上注册 `generation_status` 与 `notification` 两个 LISTEN 频道。
 *
 * 只负责 channel 注册 wiring；dispatcher 创建、logger、错误处理留在 server 侧。
 * transport.listen 返回 Promise 时会 await 完成后再注册下一个 channel。
 */
export async function startNotifyListeners(input: StartNotifyListenersInput): Promise<void> {
  await input.transport.listen(GENERATION_STATUS_CHANNEL, input.onGenerationStatus)
  await input.transport.listen(NOTIFICATION_CHANNEL, input.onNotification)
}
