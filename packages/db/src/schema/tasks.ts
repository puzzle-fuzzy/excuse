import type { TaskErrorInfo, TaskInput, TaskOutput } from '../domain-types'
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { accounts } from './accounts'

/**
 * 任务状态枚举 — 统一任务生命周期状态
 *
 * 状态机：queued → running → succeeded / failed / cancelled
 * 重试路径：running → retrying → queued（由 Worker claimNextTask 重新 claim）
 * claim 机制：Worker 用 FOR UPDATE SKIP LOCKED 原子 claim queued/retrying 任务
 */
export const taskStatusEnum = pgEnum('task_status', [
  'queued', // 等待 Worker claim
  'running', // 被 Worker claim 正在执行
  'retrying', // 失败后等待重新 claim（nextRunAt 推迟）
  'succeeded', // 成功完成
  'failed', // 永久失败（超过 maxAttempts 或不可重试错误）
  'cancelled', // 用户取消
])

/**
 * 任务域枚举 — 标识任务所属业务域
 *
 * canvas: Canvas pipeline 各阶段任务
 * generate: 通用生成任务（workspace text/image/video）
 * subtitle: 字幕管线任务
 * gateway: OpenAI compatible gateway 任务
 */
export const taskDomainEnum = pgEnum('task_domain', [
  'canvas',
  'generate',
  'subtitle',
  'gateway',
])

/**
 * 统一任务表 — 所有异步执行任务的统一调度层
 *
 * 职责：执行生命周期管理（claim, lock, retry, schedule）
 * 不包含：billing/output 数据（留在 generation_records）
 * 关系：tasks.generationRecordId → generation_records.id（可选，仅涉及 AI 模型调用的任务）
 * 关系：canvas_pipeline_runs.taskId → tasks.id（pipeline run 关联执行任务）
 *
 * Worker 通过 claimNextTask() 原子 claim 任务，避免多 Worker race。
 * claim 时设置 lockedBy + lockedUntil，heartbeat 定期延长 lockedUntil。
 * orphan sweep 恢复 lock 过期 5+ 分钟的 running 任务。
 */
export const tasks = pgTable('tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').references(() => accounts.id).notNull(),

  // ── 任务定义 ──────────────────────────────────────
  /** 任务类型标识（如 'canvas.analyze', 'media.extract-audio'） */
  type: varchar('type', { length: 100 }).notNull(),
  /** 业务域 */
  domain: taskDomainEnum('domain').notNull(),
  /** 优先级（0=最高，默认 5） */
  priority: integer('priority').notNull().default(5),
  /** 分布式追踪 ID — 从 server 透传，贯穿 submit→task→worker→SSE 全链路 */
  traceId: varchar('trace_id', { length: 64 }),

  // ── 目标关联 ──────────────────────────────────────
  /** Canvas 项目 ID（仅 canvas 域任务） */
  projectId: uuid('project_id'),
  /** 目标实体类型（如 'pipeline_run', 'shot', 'character'） */
  targetType: varchar('target_type', { length: 50 }),
  /** 目标实体 ID */
  targetId: uuid('target_id'),

  // ── 执行数据 ──────────────────────────────────────
  /** 任务输入参数 — 结构随 task type 定义 */
  input: jsonb('input').$type<TaskInput>(),
  /** 任务输出结果 — 结构随 task type 定义 */
  output: jsonb('output').$type<TaskOutput>(),
  /** 结构化错误信息（区分 retriable vs permanent） */
  errorJson: jsonb('error_json').$type<TaskErrorInfo>(),
  errorMessage: text('error_message'),

  // ── Provider / Billing 关联 ────────────────────────
  /** 关联的 generation_record（仅涉及 AI 模型调用的任务） */
  generationRecordId: uuid('generation_record_id'),

  // ── Claim / Lock ──────────────────────────────────
  /** 当前持有锁的 worker 标识 */
  lockedBy: varchar('locked_by', { length: 100 }).default('').notNull(),
  /** 锁过期时间 — heartbeat 定期延长 */
  lockedUntil: timestamp('locked_until', { withTimezone: true }),

  // ── Retry / Scheduling ────────────────────────────
  status: taskStatusEnum('status').notNull().default('queued'),
  /** 已尝试次数（claim 时 +1） */
  attempts: integer('attempts').notNull().default(0),
  /** 最大尝试次数 */
  maxAttempts: integer('max_attempts').notNull().default(3),
  /** 下次可执行时间（重试延迟后） */
  nextRunAt: timestamp('next_run_at', { withTimezone: true }).defaultNow().notNull(),

  // ── 时间追踪 ──────────────────────────────────────
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  // Worker claim 查询的核心索引：按状态 + 可执行时间排序
  index('idx_tasks_status_next_run').on(table.status, table.nextRunAt),
  // Orphan sweep 查询：找过期 lock 的 running 任务
  index('idx_tasks_locked_until').on(table.lockedUntil),
  // 按 domain + type 过滤
  index('idx_tasks_domain_type').on(table.domain, table.type),
  // 按 project 查 canvas 任务
  index('idx_tasks_project').on(table.projectId),
])
