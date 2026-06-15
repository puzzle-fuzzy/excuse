import type { NotificationMeta } from '../domain-types'
import { boolean, index, jsonb, pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { accounts } from './accounts'

/**
 * 通知类型枚举
 */
export const notificationTypeEnum = pgEnum('notification_type', [
  'balance_warning',
  'task_completed',
  'task_failed',
  'canvas_completed',
  'api_key_expired',
  'api_key_quota',
  'provider_anomaly',
  'system',
])

/**
 * 通知表 — 用户通知记录
 */
export const notifications = pgTable('notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').references(() => accounts.id).notNull(),
  type: notificationTypeEnum('type').notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  body: text('body'),
  /** 结构化定位元数据 — 供前端「点击定位」跳转（P2-2） */
  meta: jsonb('meta').$type<NotificationMeta>(),
  /** 是否已读 */
  read: boolean('read').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('idx_notifications_account_read').on(table.accountId, table.read, table.createdAt),
  index('idx_notifications_account_created').on(table.accountId, table.createdAt),
])
