import type { NotificationMeta } from '@excuse/db'
import type { MutationOkResponse, NotificationListResponse, NotificationReadAllResponse, NotificationUnreadCountResponse } from '@excuse/shared'
import type { ServerConfig } from '../config'
import { getUnreadCount, listNotifications, markAllNotificationsRead, markNotificationRead, notifyNotification, serialize } from '@excuse/db'
import { Elysia, t } from 'elysia'
import { createRequireAuthPlugin } from '../plugins/auth'
import { COOLDOWN_MS, shouldSend } from '../services/notification-cooldown'
import { NotFoundError } from '../utils/app-errors'

/**
 * 通知路由
 *
 * GET    /api/notifications         — 列出通知（分页）
 * GET    /api/notifications/unread   — 未读数量
 * PATCH  /api/notifications/:id/read — 标记已读
 * POST   /api/notifications/read-all — 全部已读
 */
export function createNotificationRoutes(config: ServerConfig) {
  return new Elysia({ prefix: '/api/notifications' })
    .use(createRequireAuthPlugin(config))
    .get('/', async ({ userId, query }) => {
      const notifications = await listNotifications({
        accountId: userId,
        limit: query.limit ?? 50,
        offset: query.offset ?? 0,
      })
      const serialized = notifications.map(serialize)
      return {
        success: true,
        items: serialized,
        total: serialized.length,
      } satisfies NotificationListResponse
    }, {
      query: t.Object({
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
      }),
      detail: {
        summary: '获取通知列表',
        description: '分页查询当前用户的通知，按时间倒序',
        tags: ['通知'],
        security: [{ bearerAuth: [] }],
      },
    })
    .get('/unread', async ({ userId }) => {
      const count = await getUnreadCount(userId)
      return {
        success: true,
        data: { count },
      } satisfies NotificationUnreadCountResponse
    }, {
      detail: {
        summary: '获取未读数量',
        tags: ['通知'],
        security: [{ bearerAuth: [] }],
      },
    })
    .patch('/:id/read', async ({ userId, params }) => {
      const updated = await markNotificationRead(params.id, userId)
      if (!updated) {
        throw new NotFoundError('通知不存在')
      }
      return { success: true } satisfies MutationOkResponse
    }, {
      params: t.Object({ id: t.String() }),
      detail: {
        summary: '标记通知已读',
        tags: ['通知'],
        security: [{ bearerAuth: [] }],
      },
    })
    .post('/read-all', async ({ userId }) => {
      const count = await markAllNotificationsRead(userId)
      return {
        success: true,
        data: { count },
      } satisfies NotificationReadAllResponse
    }, {
      detail: {
        summary: '全部标记已读',
        tags: ['通知'],
        security: [{ bearerAuth: [] }],
      },
    })
}

/**
 * 创建通知并通过 SSE 实时推送（P2-2）
 *
 * 委托给 db 的 `notifyNotification()`：写入 notifications 表 + pgClient.notify，
 * 由 server 自身的 startSSEListener 监听 notification 频道后 dispatchToUser。
 * 这样 server 触发的通知与 worker 触发的通知共用完全相同的下发路径。
 */
export async function pushNotification(opts: {
  accountId: string
  type: 'balance_warning' | 'task_completed' | 'task_failed' | 'canvas_completed' | 'api_key_expired' | 'api_key_quota' | 'provider_anomaly' | 'system'
  title: string
  body?: string
  meta?: NotificationMeta
}) {
  return notifyNotification(opts)
}

/**
 * 余额不足通知 — reserveCredit 失败（INSUFFICIENT_BALANCE）时调用，
 * 前端按 type=balance_warning 点击跳转到计费页。
 * 冷却 5 分钟。
 */
export async function notifyInsufficientBalance(accountId: string) {
  if (!shouldSend(accountId, 'balance_warning', 'balance', COOLDOWN_MS.balanceWarning))
    return
  return pushNotification({
    accountId,
    type: 'balance_warning',
    title: '余额不足',
    body: '信用额度不足，部分操作无法完成，请前往计费页查看',
  })
}

/**
 * 同步任务（文本/图片）完成通知 — 带 3s 冷却防刷
 */
export async function notifySyncTaskCompleted(accountId: string, recordId: string, category: 'text' | 'image', model: string) {
  if (!shouldSend(accountId, 'task_completed', recordId, COOLDOWN_MS.syncTask))
    return
  return pushNotification({
    accountId,
    type: 'task_completed',
    title: category === 'image' ? '图片生成完成' : '文本生成完成',
    body: `${model} · 点击查看结果`,
    meta: { recordId, category },
  })
}

/**
 * 同步任务（文本/图片）失败通知 — 带 3s 冷却防刷
 */
export async function notifySyncTaskFailed(accountId: string, recordId: string, category: 'text' | 'image', model: string, error: string) {
  if (!shouldSend(accountId, 'task_failed', recordId, COOLDOWN_MS.syncTask))
    return
  return pushNotification({
    accountId,
    type: 'task_failed',
    title: category === 'image' ? '图片生成失败' : '文本生成失败',
    body: `${model}: ${error}`,
    meta: { recordId, category },
  })
}

/**
 * 字幕任务通知 — ASR 完成/失败、导出完成/失败
 */
export async function notifySubtitleTask(accountId: string, recordId: string, type: 'task_completed' | 'task_failed', title: string, body?: string) {
  return pushNotification({
    accountId,
    type,
    title,
    body,
    meta: { recordId, category: 'subtitle' },
  })
}

/**
 * Canvas Pipeline 阶段失败通知
 */
export async function notifyCanvasPhaseFailed(accountId: string, projectId: string, phaseKey: string, error: string) {
  const PHASE_LABELS: Record<string, string> = {
    analyze: '故事分析',
    characters: '角色生成',
    locations: '场景生成',
    characterRefs: '角色参考图',
    locationRefs: '场景参考图',
    storyboard: '分镜脚本',
    continuity: '连续性校验',
    rebuild: '提示词重建',
    videos: '视频生成',
  }
  const label = PHASE_LABELS[phaseKey] ?? phaseKey
  return pushNotification({
    accountId,
    type: 'task_failed',
    title: '画布阶段失败',
    body: `${label}: ${error}`,
    meta: { projectId },
  })
}

/**
 * API Key 被撤销后仍有调用尝试 — 通知 key 所属用户
 * 冷却 24 小时。
 */
export async function notifyApiKeyRevoked(accountId: string, keyId: string) {
  if (!shouldSend(accountId, 'api_key_expired', keyId, COOLDOWN_MS.apiKeyExpired))
    return
  return pushNotification({
    accountId,
    type: 'api_key_expired',
    title: 'API Key 已失效',
    body: '有请求尝试使用已撤销的 API Key，请检查您的集成配置',
  })
}

/**
 * API Key 额度风险通知 — 覆盖「即将用尽（80%）」和「已用尽（100%）」两档。
 *
 * 由调用方传入 key 的当前/预估消耗与额度上限：
 *   - percent ≥ 1   → 「额度已用尽」（type=api_key_quota），冷却 6 小时
 *   - 0.8 ≤ percent < 1 → 「额度即将用尽」（type=api_key_quota），冷却 24 小时（状态粘性）
 *   - percent < 0.8 → 不发送
 *
 * 已用尽优先于即将用尽：单次调用从 70% 跳到 100% 时只发「已用尽」。
 * 前端按 type=api_key_quota 点击跳转到 /api-keys。
 */
export async function notifyApiKeyQuota(
  accountId: string,
  opts: { keyId: string, totalSpendCents: number, quotaMaxCents: number | null },
) {
  const { keyId, totalSpendCents, quotaMaxCents } = opts
  if (quotaMaxCents === null || quotaMaxCents <= 0)
    return

  const percent = totalSpendCents / quotaMaxCents

  // 已用尽（100%）— 优先
  if (percent >= 1) {
    if (!shouldSend(accountId, 'api_key_quota', `${keyId}:exceeded`, COOLDOWN_MS.apiKeyQuota))
      return
    return pushNotification({
      accountId,
      type: 'api_key_quota',
      title: 'API Key 额度已用尽',
      body: '该 Key 的额度已耗尽，后续 Gateway 调用将被拒绝（429）。请前往 API Keys 页提升额度、重置配额或更换 Key。',
      meta: { keyId, percent },
    })
  }

  // 即将用尽（≥80%）
  if (percent >= 0.8) {
    if (!shouldSend(accountId, 'api_key_quota', `${keyId}:approaching`, COOLDOWN_MS.apiKeyQuotaApproaching))
      return
    return pushNotification({
      accountId,
      type: 'api_key_quota',
      title: 'API Key 额度即将用尽',
      body: '该 Key 的额度已使用 80% 以上，请注意控制用量或提前提升额度，避免调用被拒。',
      meta: { keyId, percent },
    })
  }
}

/**
 * Provider / Gateway 调用异常通知 — 单次 provider 调用失败时触发，
 * 供开发者侧感知「异常调用」。冷却 1 小时（per account+model）。
 * 前端按 type=provider_anomaly 点击跳转到 /developers。
 */
export async function notifyProviderFailure(accountId: string, model: string) {
  if (!shouldSend(accountId, 'provider_anomaly', `provider_${model}`, COOLDOWN_MS.system))
    return
  return pushNotification({
    accountId,
    type: 'provider_anomaly',
    title: 'Gateway 调用异常',
    body: `${model} 调用失败，请稍后重试；如持续失败请检查模型状态或集成配置。`,
    meta: { model },
  })
}
