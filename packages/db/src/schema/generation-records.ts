import type { CostDetail, GenerationInputParams, OutputResult } from '../domain-types'
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { accounts } from './accounts'

/**
 * 生成内容类别枚举
 * - text:   文本生成
 * - image:  图片生成
 * - video:  视频生成
 */
export const generationCategoryEnum = pgEnum('generation_category', ['text', 'image', 'video', 'subtitle'])

/**
 * 生成任务状态枚举 — 完整状态机
 *
 * 状态流转规则（只允许相邻状态转换）：
 *   pending → submitting:  调用 DashScope API 前一刻，防止半完成状态
 *   submitting → processing: API 返回 provider taskId（异步视频）
 *   submitting → succeeded:  API 直接返回结果（同步文本/图片）
 *   submitting → failed:    API 调用失败或超时
 *   processing → saving_output: Worker 收到视频完成通知，开始下载
 *   saving_output → succeeded: 输出文件下载并存储成功
 *   saving_output → failed:   输出文件下载/存储失败（不允许静默标记 succeeded）
 *   pending → cancelled:      用户主动取消
 *   processing → cancelled:   用户主动取消（best-effort 取消 provider 任务）
 *   failed → pending:         用户 retry，重置为 pending 开始新一轮
 *
 * 恢复策略：
 *   - submitting: Worker 扫描超过 5min 的 submitting 记录 → 标记 failed
 *   - processing: Worker 正常轮询，如果长时间无进度 → 标记 failed
 *   - saving_output: Worker 扫描超过 10min 的 saving_output → 重试下载或标记 failed
 */
export const generationStatusEnum = pgEnum('generation_status', [
  'pending',
  'submitting',
  'processing',
  'saving_output',
  'succeeded',
  'failed',
  'cancelled',
])

/**
 * 生成记录表 — 记录每次 AI 模型调用的完整生命周期
 *
 * 关联：accounts（每条记录属于一个用户）
 * 流程：pending → processing → succeeded / failed
 * 计费：cost 字段记录 token 用量和费用
 */
export const generationRecords = pgTable('generation_records', {
  /** 主键，UUID 自动生成 */
  id: uuid('id').defaultRandom().primaryKey(),

  /** 所属用户，外键 → accounts.id */
  accountId: uuid('account_id').references(() => accounts.id).notNull(),

  /** 异步任务 ID，用于轮询/回调追踪（如百炼taskId） */
  taskId: varchar('task_id', { length: 255 }).unique(),

  /** 使用的 AI 模型标识，如 wanx-v1、qwen-vl 等 */
  model: varchar('model', { length: 100 }).notNull(),

  /** 生成内容类别：text / image / video / subtitle */
  category: generationCategoryEnum('category').notNull(),

  /** 任务状态，默认 pending */
  status: generationStatusEnum('status').notNull().default('pending'),

  /** 输入参数（prompt、参考图、配置等） — 域类型 GenerationInputParams */
  inputParams: jsonb('input_params').notNull().$type<GenerationInputParams>(),

  /** 输出结果（生成的 URL、文本内容等） */
  outputResult: jsonb('output_result').$type<OutputResult>(),

  /** 费用明细（token 数量、单价、总费用等） */
  cost: jsonb('cost').$type<CostDetail>(),

  /** 权威费用值（整数分），从 cost.totalPriceCents 冗余，用于 SQL 聚合避免 JSONB 解析 */
  totalPriceCents: integer('total_price_cents'),

  /** 失败时的错误信息 */
  errorMessage: text('error_message'),

  /** 重试次数，每次 retry 时递增 */
  retryCount: integer('retry_count').default(0).notNull(),

  /** 追踪 ID，跨 server/worker/SSE 关联同一次生成请求的全链路日志 */
  traceId: varchar('trace_id', { length: 36 }),

  /** 去重键 = userId + model + hash(params)，防止同参数重复提交 */
  dedupeKey: text('dedupe_key').unique(),

  /** 从资产中心隐藏的时间（null = 未隐藏，仍出现在资产列表） */
  hiddenAt: timestamp('hidden_at', { withTimezone: true }),

  /** 创建时间 */
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),

  /** 最后更新时间（状态变更时更新） */
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('idx_gen_records_account_created').on(table.accountId, table.createdAt),
  index('idx_gen_records_status_category').on(table.status, table.category),
  index('idx_gen_records_trace_id').on(table.traceId),
])
