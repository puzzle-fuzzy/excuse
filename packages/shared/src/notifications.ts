import type { EntityResponse, ListResponse } from './api-response'
import type { NotificationMeta } from './domain-types'

export interface NotificationDTO {
  id: string
  accountId: string
  type: string
  title: string
  body: string | null
  meta: NotificationMeta | null
  read: boolean
  createdAt: string
}

export interface NotificationCount {
  count: number
}

export type NotificationListResponse = ListResponse<NotificationDTO>

export type NotificationUnreadCountResponse = EntityResponse<NotificationCount>

export type NotificationReadAllResponse = EntityResponse<NotificationCount>
