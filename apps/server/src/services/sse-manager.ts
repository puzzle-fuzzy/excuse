import { pgClient } from '@excuse/db'
/**
 * SSE 连接管理器 + PostgreSQL LISTEN 桥接
 *
 * 核心职责：
 *   1. 维护内存中的 SSE 连接表（userId → Set<Sender>），支持多标签页
 *   2. 监听 PostgreSQL LISTEN 'generation_status' 频道
 *   3. 将 Worker 的 NOTIFY 消息解析后推送到对应用户的所有 SSE 连接
 *
 * 数据流：
 *   Worker 完成任务 → NOTIFY 'generation_status' → startSSEListener 接收
 *   → dispatchToUser → SSE route 中的 AsyncChannel → 客户端
 *
 * 两种推送事件：
 *   - generation_status: 通用生成任务状态变更
 *   - pipeline_node_update: Canvas pipeline 进度（含 canvasMeta 时自动发送）
 */
import {
  createGenerationNotifyDispatcher,
  createNotificationDispatcher,
  GENERATION_STATUS_CHANNEL,
  NOTIFICATION_CHANNEL,
  startNotifyListeners,
  UserEventHub,
} from '@excuse/events'
import { createLogger } from '@excuse/shared'

const logger = createLogger('sse-manager')

// ===== SSE 连接管理 =====

type Sender = (event: string, data: unknown) => void
const eventHub = new UserEventHub()

/**
 * 按用户 ID 维护的 SSE 连接表
 * 每个用户可以有多个连接（多标签页）
 */

/**
 * 添加一个 SSE 连接
 * 返回 AddConnectionResult，调用方（sse route）应检查 accepted 字段，
 * 被拒绝时返回 503（连接数超限）。
 */
export function addConnection(userId: string, send: Sender) {
  return eventHub.addConnection(userId, send)
}

/**
 * 移除一个 SSE 连接
 */
export function removeConnection(userId: string, send: Sender) {
  const remaining = eventHub.removeConnection(userId, send)
  logger.debug({ userId, remaining }, 'SSE client disconnected')
}

/**
 * 向指定用户的所有连接推送事件
 */
export function dispatchToUser(userId: string, event: string, data: unknown) {
  eventHub.dispatchToUser(userId, event, data, (err) => {
    logger.error({ err, userId, event }, 'Failed to dispatch SSE event')
  })
}

/**
 * 获取当前在线用户数（调试用）
 */
export function getOnlineUserCount() {
  return eventHub.getOnlineUserCount()
}

// ===== PostgreSQL LISTEN =====

/**
 * 启动 PostgreSQL LISTEN 监听
 * 接收 Worker 通过 NOTIFY 发送的生成状态变更，推送到对应用户的 SSE 连接
 */
export async function startSSEListener() {
  const handleNotify = createGenerationNotifyDispatcher({
    dispatchToUser,
    onError: (err, rawPayload) => {
      logger.error({ err, rawPayload }, 'Failed to parse generation_status notification')
    },
  })

  // P2-2：通知频道 — Worker/Server 通过 notifyNotification() 写入并 notify，
  // LISTEN 接收后经 dispatcher 推送到对应用户的 SSE 连接（前端铃铛实时更新）。
  const handleNotification = createNotificationDispatcher({
    dispatchToUser,
    onError: (err, rawPayload) => {
      logger.error({ err, rawPayload }, 'Failed to parse notification channel payload')
    },
  })

  // channel 注册 wiring 委托给 @excuse/events；真实 pgClient、logger、错误处理留在 server 侧。
  await startNotifyListeners({
    transport: pgClient,
    onGenerationStatus: (rawPayload) => {
      const result = handleNotify(rawPayload)
      if (result) {
        const { payload } = result
        logger.info(
          { userId: payload.accountId, recordId: payload.recordId, traceId: payload.traceId, status: payload.status },
          'SSE event dispatched',
        )
      }
    },
    onNotification: (rawPayload) => {
      const result = handleNotification(rawPayload)
      if (result) {
        logger.info(
          { userId: result.payload.accountId, notificationId: result.payload.id, type: result.payload.type },
          'Notification SSE event dispatched',
        )
      }
    },
  })

  logger.info(`SSE listener started on PostgreSQL channels "${GENERATION_STATUS_CHANNEL}", "${NOTIFICATION_CHANNEL}"`)
}
