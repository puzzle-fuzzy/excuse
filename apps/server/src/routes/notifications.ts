import type { MutationOkResponse, NotificationListResponse, NotificationReadAllResponse, NotificationUnreadCountResponse } from '@excuse/shared'
import type { ServerConfig } from '../config'
import { getUnreadCount, listNotifications, markAllNotificationsRead, markNotificationRead, serialize } from '@excuse/db'
import { Elysia, t } from 'elysia'
import { createRequireAuthPlugin } from '../plugins/auth'
import { NotFoundError } from '../utils/app-errors'

/**
 * 通知路由（仅 HTTP CRUD）
 *
 * 创建/推送通知的领域逻辑（pushNotification 及各 notify* 辅助函数）已抽到
 * `services/notifications.ts`，供 generation / subtitle / gateway / auth 等业务模块
 * 复用，消除「业务模块反向 import 路由」的层级倒置。
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
