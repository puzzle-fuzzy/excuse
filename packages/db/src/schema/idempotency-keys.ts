import { index, pgTable, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core'
import { accounts } from './accounts'
import { generationRecords } from './generation-records'

/**
 * 幂等请求键 — 用于高成本/高风险接口的重复提交防护。
 *
 * 同一用户 + scope + keyHash 只能存在一条记录。requestHash 用于判断同一个
 * Idempotency-Key 是否被复用于不同请求体，generationRecordId 用于返回原始任务。
 */
export const idempotencyKeys = pgTable('idempotency_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').references(() => accounts.id).notNull(),
  scope: varchar('scope', { length: 80 }).notNull(),
  keyHash: varchar('key_hash', { length: 64 }).notNull(),
  requestHash: varchar('request_hash', { length: 64 }).notNull(),
  generationRecordId: uuid('generation_record_id').references(() => generationRecords.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
}, table => [
  unique('idx_idempotency_keys_unique_scope_key').on(table.accountId, table.scope, table.keyHash),
  index('idx_idempotency_keys_expires_at').on(table.expiresAt),
])
