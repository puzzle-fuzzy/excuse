import type { CostDetail, GenerationCategory, GenerationStatus, NotificationMeta, OutputResult } from '@excuse/db'
import type { SSEPipelineNodeEvent } from './canvas'
import { parseCostDetail, parseOutputResult } from './generation'

// ===== SSE 事件类型定义 =====

/**
 * SSE 推送到前端的生成状态事件
 * 当 Worker 完成任务（成功/失败）时推送
 */
export interface SSEGenerationStatusEvent {
  id: string
  /** 异步任务 ID（可为 null：未提交到 provider 的任务） */
  taskId: string | null
  traceId?: string | null
  status: GenerationStatus
  category: GenerationCategory
  model: string
  outputResult?: OutputResult
  errorMessage?: string
  cost?: CostDetail
}

/**
 * SSE 通知事件 — 新通知推送
 */
export interface SSENotificationEvent {
  id: string
  type: string
  title: string
  body?: string
  /** 结构化定位元数据（P2-2） — 供前端「点击定位」跳转 */
  meta?: NotificationMeta
  read: boolean
  createdAt: string
}

/**
 * NOTIFY 'notification' 频道传输载荷（P2-2）
 *
 * db 端 `notifyNotification()` 序列化通知行后通过 `pgClient.notify()` 发送；
 * `@excuse/events` 的 `createNotificationDispatcher` 解析后映射为
 * `SSENotificationEvent` 并经 `dispatchToUser` 推送。
 * `accountId` 仅用于 SSE 路由，不下发到前端。
 */
export interface NotificationNotifyPayload {
  id: string
  accountId: string
  type: string
  title: string
  body?: string | null
  meta?: NotificationMeta | null
  read: boolean
  createdAt: string
}

/** SSE 连接建立事件 */
export interface SSEConnectedEvent {
  timestamp: string
}

/** SSE 心跳事件 */
export interface SSEHeartbeatEvent {
  timestamp: string
}

// ===== SSE 事件解析器 — 边界层运行时校验 =====
// SSE payload 来自网络（JSON 文本），必须在分发前解析为类型安全结构。
// 解析失败返回 null，调用方丢弃事件并记录日志，不抛异常不崩溃连接。
// isObject/str 是边界解析辅助函数，使用 Record<string, unknown> 作为
// 中间 cast 是合法的 —— 作用是从 unknown JSON 提取已知字段到类型安全结构。

/** 边界层类型守卫 — 将 unknown SSE payload 转为可索引的 Record 以提取字段 */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key]
  return typeof v === 'string' ? v : undefined
}

const VALID_STATUSES: readonly string[] = ['pending', 'submitting', 'processing', 'saving_output', 'succeeded', 'failed', 'cancelled']
const VALID_CATEGORIES: readonly string[] = ['text', 'image', 'video', 'subtitle']

/**
 * 解析 generation_status 事件
 *
 * 服务端从 GenerationNotifyPayload 映射而来，字段包括
 * id, taskId, status, category, model + 可选 outputResult / cost / errorMessage
 */
export function parseSSEGenerationStatusEvent(raw: unknown): SSEGenerationStatusEvent | null {
  if (!isObject(raw))
    return null
  const id = str(raw, 'id')
  const taskId = str(raw, 'taskId')
  const model = str(raw, 'model')
  const status = str(raw, 'status')
  const category = str(raw, 'category')
  if (!id || !taskId || !model || !status || !category)
    return null
  if (!VALID_STATUSES.includes(status))
    return null
  if (!VALID_CATEGORIES.includes(category))
    return null

  const outputResult = parseOutputResult(raw.outputResult)
  const cost = parseCostDetail(raw.cost)

  return {
    id,
    taskId,
    status: status as GenerationStatus,
    category: category as GenerationCategory,
    model,
    ...(outputResult && { outputResult }),
    ...(typeof raw.errorMessage === 'string' && { errorMessage: raw.errorMessage }),
    ...(cost && { cost }),
  }
}

/**
 * 解析 pipeline_node_update 事件
 *
 * Canvas pipeline 各阶段进度，字段包括
 * projectId, nodeType, nodeId, status + 可选 data / error
 */
export function parseSSEPipelineNodeEvent(raw: unknown): SSEPipelineNodeEvent | null {
  if (!isObject(raw))
    return null
  const projectId = str(raw, 'projectId')
  const nodeType = str(raw, 'nodeType')
  const nodeId = str(raw, 'nodeId')
  const status = str(raw, 'status')
  if (!projectId || !nodeType || !nodeId || !status)
    return null
  if (!['running', 'completed', 'failed'].includes(status))
    return null

  return {
    projectId,
    nodeType,
    nodeId,
    status: status as SSEPipelineNodeEvent['status'],
    ...(typeof raw.runId === 'string' && { runId: raw.runId }),
    ...(raw.data != null && typeof raw.data === 'object' && { data: raw.data as Record<string, unknown> }),
    ...(typeof raw.error === 'string' && { error: raw.error }),
  }
}

/**
 * 解析 notification 事件
 *
 * 必填：id, type, title, createdAt；可选：body, meta, read。
 * body 在事件中是可选的（部分通知无正文），read 缺省为 false。
 */
export function parseSSENotificationEvent(raw: unknown): SSENotificationEvent | null {
  if (!isObject(raw))
    return null
  const id = str(raw, 'id')
  const type = str(raw, 'type')
  const title = str(raw, 'title')
  const createdAt = str(raw, 'createdAt')
  if (!id || !type || !title || !createdAt)
    return null

  const body = str(raw, 'body')
  const meta = parseNotificationMeta(raw.meta)
  return {
    id,
    type,
    title,
    ...(body && { body }),
    ...(meta && { meta }),
    read: raw.read === true,
    createdAt,
  }
}

/**
 * 解析通知定位元数据（P2-2） — 所有字段可选，仅校验为字符串则保留
 */
function parseNotificationMeta(raw: unknown): NotificationMeta | undefined {
  if (!isObject(raw))
    return undefined
  const meta: NotificationMeta = {}
  const projectId = str(raw, 'projectId')
  if (projectId)
    meta.projectId = projectId
  const recordId = str(raw, 'recordId')
  if (recordId)
    meta.recordId = recordId
  const shotId = str(raw, 'shotId')
  if (shotId)
    meta.shotId = shotId
  const assetId = str(raw, 'assetId')
  if (assetId)
    meta.assetId = assetId
  const category = str(raw, 'category')
  if (category && VALID_CATEGORIES.includes(category))
    meta.category = category as NotificationMeta['category']
  return Object.keys(meta).length > 0 ? meta : undefined
}
