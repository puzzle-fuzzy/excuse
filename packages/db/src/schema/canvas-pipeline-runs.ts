import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { accounts } from './accounts'
import { canvasProjects } from './canvas-projects'
/**
 * 流水线阶段枚举 — 12 个阶段按固定顺序执行
 *
 * 执行顺序：analyze → characters → locations → characterRefs → locationRefs
 *           → storyboard → continuity → rebuild → dialogue → videos → bgm → assemble
 * 每个阶段独立可重试，通过 pipeline_runs 表记录执行历史
 */
export const canvasPipelinePhaseEnum = pgEnum('canvas_pipeline_phase', [
  'analyze', // 阶段 1: LLM 分析故事文本
  'characters', // 阶段 2: 生成角色档案
  'locations', // 阶段 3: 生成场景档案
  'characterRefs', // 阶段 4: AI 生成角色参考图（正面肖像 + 三视图）
  'locationRefs', // 阶段 5: AI 生成场景参考图（空场景）
  'storyboard', // 阶段 6: LLM 生成分镜脚本
  'continuity', // 阶段 7: 规则校验连续性（不调用 LLM）
  'rebuild', // 阶段 8: 重建视频提示词（组装 videoPrompt）
  'dialogue', // 阶段 8.5: LLM 为每个 shot 生成对话层 prompt（对白/语气/环境音效）
  'videos', // 阶段 9: 提交视频生成任务（含对话式 prompt + R2V 多参考图）
  'bgm', // 阶段 10: FunMusic 按项目 genre/mood 生成 BGM
  'assemble', // 阶段 11: FFmpeg 合成视频（含对话音频）+ BGM
])

/**
 * 流水线运行状态枚举
 *
 * 状态机：pending → running → succeeded / failed / cancelled
 * 并发守卫：同一项目同一阶段只能有一个 pending/running 的 run
 * append-only guard：状态转换只允许 pending → running，不允许回退
 */
export const canvasPipelineRunStatusEnum = pgEnum('canvas_pipeline_run_status', [
  'pending', // 已创建，等待执行
  'running', // 正在执行中
  'succeeded', // 执行成功
  'failed', // 执行失败
  'cancelled', // 用户取消
])

/**
 * Canvas 流水线运行记录表 — 追踪每个阶段的执行历史
 *
 * 关联：canvas_projects（阶段所属项目）+ accounts（触发者）
 * 并发控制：findActiveRunForPhase 检查是否有 pending/running 的 run
 * append-only guard：markXxx 函数只在当前状态匹配时才更新，防止状态回退
 * 输入快照：inputSnapshotJson 记录执行时的输入状态，用于审计和重试对比
 */
export const canvasPipelineRuns = pgTable('canvas_pipeline_runs', {
  /** 主键，UUID 自动生成 */
  id: uuid('id').defaultRandom().primaryKey(),
  /** 所属项目，外键 → canvas_projects.id */
  projectId: uuid('project_id').references(() => canvasProjects.id).notNull(),
  /** 流水线阶段（12 阶段之一） */
  phase: canvasPipelinePhaseEnum('phase').notNull(),
  /** 运行状态 */
  status: canvasPipelineRunStatusEnum('status').notNull().default('pending'),
  /** 实际开始执行时间（pending → running 时设置） */
  startedAt: timestamp('started_at', { withTimezone: true }),
  /** 执行结束时间（succeeded/failed/cancelled 时设置） */
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  /** 失败时的错误信息 */
  errorMessage: text('error_message'),
  /** 触发者，外键 → accounts.id */
  createdBy: uuid('created_by').references(() => accounts.id),
  /** 输入快照 — 管道审计数据：执行时的角色/场景/故事文本状态，不参与业务逻辑 */
  inputSnapshotJson: jsonb('input_snapshot_json').$type<Record<string, unknown>>(),
  /** 输出摘要 — 管道审计数据：执行结果统计信息，不参与业务逻辑 */
  outputSummaryJson: jsonb('output_summary_json').$type<Record<string, unknown>>(),
  /** 关联的统一执行任务 — 外键 → tasks.id，pipeline run 与 task 双向关联 */
  taskId: uuid('task_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('idx_pipeline_runs_project_phase_status').on(table.projectId, table.phase, table.status),
  index('idx_pipeline_runs_project_created').on(table.projectId, table.createdAt),
  index('idx_pipeline_runs_task').on(table.taskId),
])
