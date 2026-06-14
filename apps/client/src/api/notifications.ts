import type { NotificationDTO } from '@excuse/shared'
import { api } from './client'

/** NotificationDTO 去掉 accountId — SSE 事件不下发 accountId，展示也不需要 */
export type NotificationItem = Omit<NotificationDTO, 'accountId'>

function toNotificationItem(row: NotificationDTO): NotificationItem {
  const { accountId: _accountId, ...rest } = row
  return rest
}

export async function fetchNotifications(): Promise<NotificationItem[]> {
  const res = await api.api.notifications.get()
  const data = res.data
  if (!data?.success)
    throw new Error('获取通知列表失败')
  return data.items.map(toNotificationItem)
}

export async function fetchNotificationUnreadCount(): Promise<number> {
  const res = await api.api.notifications.unread.get()
  const data = res.data
  if (!data?.success)
    throw new Error('获取未读数失败')
  return data.data.count
}

export async function markNotificationRead(id: string): Promise<void> {
  const res = await api.api.notifications({ id }).read.patch()
  const data = res.data
  if (!data?.success)
    throw new Error('标记通知已读失败')
}

export async function markAllNotificationsRead(): Promise<void> {
  const res = await api.api.notifications['read-all'].post()
  const data = res.data
  if (!data?.success)
    throw new Error('全部标记已读失败')
}
