import type { SSENotificationEvent } from '@excuse/shared'
import type { NotificationItem } from '@/api/notifications'
import { notificationQueryKeys, queryClient } from '@/api/query-client'

/** SSE 'notification' 事件 → invalidate React Query 缓存 + 乐观更新角标 */
export function handleNotificationSSEEvent(event: SSENotificationEvent): void {
  queryClient.invalidateQueries({ queryKey: notificationQueryKeys.unread })
  queryClient.invalidateQueries({ queryKey: notificationQueryKeys.list })

  // 乐观更新：如果 list 缓存已存在，前置新通知
  queryClient.setQueryData<NotificationItem[]>(notificationQueryKeys.list, (old) => {
    if (!old)
      return old
    const newItem: NotificationItem = {
      id: event.id,
      type: event.type as NotificationItem['type'],
      title: event.title,
      body: event.body ?? null,
      meta: event.meta ?? null,
      read: event.read,
      createdAt: event.createdAt,
    }
    return [newItem, ...old]
  })

  // 乐观更新：unread +1
  queryClient.setQueryData<number>(notificationQueryKeys.unread, (old) => {
    if (typeof old !== 'number')
      return old
    return old + 1
  })
}
