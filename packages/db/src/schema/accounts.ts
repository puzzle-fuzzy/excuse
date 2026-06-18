import { boolean, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

/**
 * 账户表 — 用户注册、登录、基本信息
 *
 * 核心字段：username / email / password / avatar
 * 状态控制：is_active（软禁用）
 */
export const accounts = pgTable('accounts', {
  /** 主键，UUID 自动生成 */
  id: uuid('id').defaultRandom().primaryKey(),

  /** 用户名，全局唯一 */
  username: varchar('username', { length: 50 }).unique().notNull(),

  /** 邮箱，全局唯一，用于登录 */
  email: varchar('email', { length: 255 }).unique().notNull(),

  /** 密码（哈希存储） */
  password: varchar('password', { length: 255 }).notNull(),

  /** 头像 URL */
  avatar: varchar('avatar', { length: 500 }),

  /** 账号是否启用，可用于软封禁 */
  isActive: boolean('is_active').default(true).notNull(),

  /** 注册时间 */
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),

  /** 最后更新时间 */
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),

  /** 最后一次登录时间 */
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
})
