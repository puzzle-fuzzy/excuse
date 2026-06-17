import { index, integer, numeric, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { accounts } from './accounts'

/**
 * API 密钥表
 *
 * 密钥只存 SHA-256 hash + 短前缀（用于展示识别）。
 * 创建时只返回一次完整 key，后续无法查看。
 *
 * scope: 密钥访问范围
 *   - 'all' — 拥有用户完整权限（默认）
 *   - 'gateway' — 仅允许调用 Gateway OpenAI 兼容端点
 * rate_limit_per_minute: 每分钟最大请求数（null 表示不限制）
 * quota_max_cents: 额度上限（分，numeric 支持 sub-cent），null 表示不限制
 * total_spend_cents: 已消耗额度（分，支持 sub-cent），每次成功调用后累加
 * quota_reset_at: 额度重置时间，届时 total_spend_cents 归零
 */
export const apiKeys = pgTable('api_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').references(() => accounts.id).notNull(),
  /** 密钥前 8 位，用于 UI 展示识别 */
  prefix: varchar('prefix', { length: 8 }).notNull(),
  /** SHA-256 hex digest of the full key */
  keyHash: text('key_hash').notNull().unique(),
  /** 用户给密钥起的名称 */
  name: varchar('name', { length: 100 }),
  /** 密钥访问范围 */
  scope: varchar('scope', { length: 20 }).notNull().default('all'),
  /** 每分钟最大请求数（null = 不限制） */
  rateLimitPerMinute: integer('rate_limit_per_minute'),
  /** 额度上限（分，支持 sub-cent；null = 不限制） */
  quotaMaxCents: numeric('quota_max_cents', { precision: 20, scale: 4, mode: 'number' }),
  /** 已消耗额度（分，支持 sub-cent） */
  totalSpendCents: numeric('total_spend_cents', { precision: 20, scale: 4, mode: 'number' }).notNull().default(0),
  /** 额度重置时间，届时 total_spend_cents 归零 */
  quotaResetAt: timestamp('quota_reset_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, table => [
  index('idx_api_keys_account').on(table.accountId),
  index('idx_api_keys_hash').on(table.keyHash),
])
