import type { AuditDetail } from '../domain-types'
import { index, jsonb, pgEnum, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { accounts } from './accounts'

export const auditActionEnum = pgEnum('audit_action', [
  'login',
  'register',
  'generate',
  'file_delete',
  'billing_transaction',
  'api_key_create',
  'api_key_revoke',
  'admin_action',
  'canvas_project_create',
  'canvas_project_delete',
  'canvas_phase_run',
  'canvas_cancel',
  'canvas_asset_regenerate',
  'canvas_apply_reference_assets',
  'asset_hide',
  'gateway_call',
  'generation_retry',
  'generation_cancel',
  'credit_reserve',
  'credit_debit',
  'credit_refund',
])

/**
 * 审计日志表
 *
 * 记录关键操作：登录/注册、生成任务、文件删除、计费交易、API Key 操作、管理员操作。
 * 后续管理端支持按 accountId、action、时间范围查询。
 */
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').references(() => accounts.id),
  action: auditActionEnum('action').notNull(),
  /** 操作对象标识（如 recordId、fileId、keyId） */
  targetId: varchar('target_id', { length: 255 }),
  /** 操作详情 — 结构化审计上下文，每种 action 有对应 AuditDetail DTO */
  detail: jsonb('detail').$type<AuditDetail>(),
  /** 客户端 IP */
  ip: varchar('ip', { length: 45 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('idx_audit_logs_account').on(table.accountId, table.createdAt),
  index('idx_audit_logs_action').on(table.action, table.createdAt),
])
