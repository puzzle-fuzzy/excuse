import { index, jsonb, numeric, pgEnum, pgTable, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core'
import { accounts } from './accounts'
import { generationRecords } from './generation-records'

/**
 * 交易类型枚举
 *
 * 状态机：每笔生成任务经历 reserve → (debit | refund) 一次
 *   - reserve:  生成开始时冻结预估费用
 *   - debit:    生成成功后扣款（实际费用 ≤ 预留金额时退还差额）
 *   - refund:   生成失败时全额退还冻结资金
 *   - credit:   充值（管理端/支付回调）
 *   - admin_adjust: 管理员手动调整
 */
export const creditTransactionTypeEnum = pgEnum('credit_transaction_type', [
  'reserve',
  'debit',
  'refund',
  'credit',
  'admin_adjust',
])

/**
 * 用户信用账户 — 每用户一行
 *
 * 不变量：
 *   availableCents + frozenCents = 总余额（不含已扣款）
 *   availableCents >= 0, frozenCents >= 0
 *   所有金额变动通过 credit_transactions 审计
 */
export const creditAccounts = pgTable('credit_accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').references(() => accounts.id).notNull(),
  /** 可用余额（分，numeric(20,4) 支持 sub-cent：文本按 token、音频按秒计价产生小数分） */
  availableCents: numeric('available_cents', { precision: 20, scale: 4, mode: 'number' }).notNull().default(0),
  /** 冻结金额（分） — 已 reserve 但尚未 debit/refund */
  frozenCents: numeric('frozen_cents', { precision: 20, scale: 4, mode: 'number' }).notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  unique('idx_credit_accounts_unique_per_user').on(table.accountId),
])

/**
 * 信用交易流水 — 每笔资金变动一条记录
 *
 * 不变量：
 *   - 同一 generationRecordId + type 只能有一条记录（唯一索引防双扣双退）
 *   - amountCents 始终为正数（方向由 type 表达）
 *   - reserve 后必须跟 debit 或 refund，不能遗漏
 */
export const creditTransactions = pgTable('credit_transactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').references(() => accounts.id).notNull(),
  type: creditTransactionTypeEnum('type').notNull(),
  /** 变动金额（分，始终为正；可为小数） */
  amountCents: numeric('amount_cents', { precision: 20, scale: 4, mode: 'number' }).notNull(),
  /** 变动后可用余额快照 */
  balanceAfterCents: numeric('balance_after_cents', { precision: 20, scale: 4, mode: 'number' }).notNull(),
  /** 变动后冻结金额快照 */
  frozenAfterCents: numeric('frozen_after_cents', { precision: 20, scale: 4, mode: 'number' }).notNull(),
  /** 关联的生成记录（reserve/debit/refund 时非空） */
  generationRecordId: uuid('generation_record_id').references(() => generationRecords.id),
  /** 描述/原因 */
  description: varchar('description', { length: 500 }),
  /** 额外元数据 — 存储边界：交易类型各异（管理端调整原因、支付渠道信息等），无法统一 DTO */
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('idx_credit_tx_account_created').on(table.accountId, table.createdAt),
  unique('idx_credit_tx_unique_record_type').on(table.generationRecordId, table.type),
])

/**
 * 使用事件 — 关联生成记录与信用交易
 *
 * 每条生成记录对应一条 usage_event，记录 reserve/debit/refund 的关联交易 ID。
 * 用于账务审计和成本对账。
 */
export const usageEvents = pgTable('usage_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').references(() => accounts.id).notNull(),
  generationRecordId: uuid('generation_record_id').references(() => generationRecords.id).notNull(),
  /** reserve 交易 ID */
  reserveTxId: uuid('reserve_tx_id'),
  /** debit 交易 ID（成功时非空） */
  debitTxId: uuid('debit_tx_id'),
  /** refund 交易 ID（失败时非空） */
  refundTxId: uuid('refund_tx_id'),
  /** 预留金额（分） */
  reservedCents: numeric('reserved_cents', { precision: 20, scale: 4, mode: 'number' }),
  /** 实际扣款金额（分） */
  debitedCents: numeric('debited_cents', { precision: 20, scale: 4, mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  unique('idx_usage_events_unique_record').on(table.generationRecordId),
  index('idx_usage_events_account').on(table.accountId, table.createdAt),
])
