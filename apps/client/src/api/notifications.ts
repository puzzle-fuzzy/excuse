import type {
  MutationOkResponse,
  NotificationDTO,
  NotificationListResponse,
  NotificationReadAllResponse,
  NotificationUnreadCountResponse,
} from '@excuse/shared'
import { api, unwrapEden } from './client'

export type NotificationItem = Omit<NotificationDTO, 'accountId'>

function toNotificationItem(row: NotificationDTO): NotificationItem {
  const { accountId: _accountId, ...rest } = row
  return rest
}

export async function fetchNotifications(): Promise<NotificationItem[]> {
  const data = unwrapEden<NotificationListResponse>(await api.api.notifications.get())
  return data.items.map(toNotificationItem)
}

export async function fetchNotificationUnreadCount(): Promise<number> {
  return unwrapEden<NotificationUnreadCountResponse>(await api.api.notifications.unread.get()).data.count
}

export async function markNotificationRead(id: string): Promise<void> {
  unwrapEden<MutationOkResponse>(await api.api.notifications({ id }).read.patch())
}

export async function markAllNotificationsRead(): Promise<void> {
  unwrapEden<NotificationReadAllResponse>(await api.api.notifications['read-all'].post())
}
