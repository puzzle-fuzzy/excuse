import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { accounts } from './accounts'

/**
 * 密码重置令牌表
 *
 * 用户请求密码重置时生成一次性 token，哈希后存储。
 * token 短时效（默认 30 分钟）、一次性使用、不可枚举。
 */
export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** 关联账户 */
  accountId: uuid('account_id').references(() => accounts.id).notNull(),
  /** SHA-256 hex digest of the reset token */
  tokenHash: text('token_hash').notNull().unique(),
  /** 令牌过期时间 */
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  /** 是否已使用（一次性） */
  used: boolean('used').notNull().default(false),
  /** 使用时间 */
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('idx_password_reset_account').on(table.accountId),
  index('idx_password_reset_hash').on(table.tokenHash),
])
