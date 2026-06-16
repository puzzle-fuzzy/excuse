import type { CanvasAssetOutput, CostDetail } from '../domain-types'
import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { accounts } from './accounts'
import { canvasPipelineRuns } from './canvas-pipeline-runs'
import { canvasProjects } from './canvas-projects'
import { tasks } from './tasks'

/**
 * Canvas 资产类别枚举 — 对应每个流水线阶段的产物类型
 *
 * 每个阶段生成不同类型的资产：
 *   analyze         → analysis（故事分析 JSON）
 *   characters      → characterProfile（角色档案 JSON）
 *   locations       → locationProfile（场景档案 JSON）
 *   characterRefs   → characterPortrait + characterTurnaround（参考图）
 *   locationRefs    → locationRef（场景参考图）
 *   storyboard      → storyboard（分镜脚本 JSON）
 *   continuity      → continuityReport（连续性报告 JSON）
 *   rebuild         → videoPrompt（重建后的视频提示词）
 *   videos          → shotVideo（视频文件）
 */
export const canvasAssetCategoryEnum = pgEnum('canvas_asset_category', [
  'analysis', // 阶段 1: 故事分析结果
  'characterProfile', // 阶段 2: 角色档案
  'locationProfile', // 阶段 3: 场景档案
  'characterPortrait', // 阶段 4: 角色正面肖像参考图
  'characterTurnaround', // 阶段 4: 角色三视图
  'locationRef', // 阶段 5: 场景参考图
  'storyboard', // 阶段 6: 分镜脚本
  'continuityReport', // 阶段 7: 连续性检查报告
  'videoPrompt', // 阶段 8: 重建后的视频提示词
  'shotVideo', // 阶段 9: 镜头视频文件
])

/**
 * Canvas 资产状态枚举 — 简化的生成生命周期
 *
 * 状态机：queued → running → succeeded / failed / cancelled
 * 与 generation_records 的 7-state machine 不同，
 * canvas_assets 的生命周期更简单：因为 text/image 生成是同步的，
 * 不需要 submitting/processing/saving_output 等中间状态。
 */
export const canvasAssetStatusEnum = pgEnum('canvas_asset_status', [
  'queued', // 已创建，等待执行
  'running', // 正在生成中
  'succeeded', // 生成成功
  'failed', // 生成失败
  'cancelled', // 用户取消
])

/**
 * Canvas 资产表 — 记录每次 Canvas 流水线生成的产物
 *
 * 核心职责：
 *   1. 追踪所有 Canvas 生成状态（text/image/video），为资产轮询提供数据
 *   2. 保留同一实体多次生成的历史资产，支持资产选择和替换
 *   3. 区分 provider 临时 URL 和稳定公开 URL
 *   4. 记录每次生成的成本，为 Canvas 成本回显提供数据
 *
 * 关联：
 *   canvas_projects（资产所属项目）
 *   canvas_pipeline_runs（资产由哪个 run 创建）
 *   tasks（资产由哪个统一任务执行）
 *
 * isActive + locked 机制：
 *   isActive=true 表示当前使用的资产版本（同一 target 下只有一条 active）
 *   locked=true 表示用户锁定该资产，防止被后续生成覆盖
 *   setCanvasAssetActive() 会将新资产标记为 active 并自动 deactivate 同 target 的旧资产
 */
export const canvasAssets = pgTable('canvas_assets', {
  /** 主键，UUID 自动生成 */
  id: uuid('id').defaultRandom().primaryKey(),
  /** 资产所有者，外键 → accounts.id */
  accountId: uuid('account_id').references(() => accounts.id).notNull(),
  /** 所属项目，外键 → canvas_projects.id */
  projectId: uuid('project_id').references(() => canvasProjects.id).notNull(),

  // ── 资产类别和目标 ──────────────────────────────
  /** 资产类别（对应流水线阶段产物类型） */
  category: canvasAssetCategoryEnum('category').notNull(),
  /** 目标实体类型：project / character / location / shot */
  targetEntityType: varchar('target_entity_type', { length: 50 }).notNull(),
  /** 目标实体 ID（character.id / location.id / shot.id / project.id） */
  targetEntityId: uuid('target_entity_id').notNull(),

  // ── 生命周期状态 ────────────────────────────────
  /** 资产状态 */
  status: canvasAssetStatusEnum('status').notNull().default('queued'),

  // ── 生成元数据 ──────────────────────────────────
  /** 使用的 AI 模型（如 'qwen3.7-plus', 'wanx2.1-imgen3') */
  model: varchar('model', { length: 100 }),
  /** 创建此资产的流水线运行，外键 → canvas_pipeline_runs.id */
  pipelineRunId: uuid('pipeline_run_id').references(() => canvasPipelineRuns.id),
  /** 执行此资产生成的统一任务，外键 → tasks.id */
  taskId: uuid('task_id').references(() => tasks.id),

  // ── 输入输出数据 ────────────────────────────────
  /** 生成输入参数（prompt、模型参数、参考 URL 等） */
  inputJson: jsonb('input_json').$type<Record<string, unknown>>(),
  /** 生成输出 — URL 列表用于 image/video，JSON 用于 text 类资产 */
  outputJson: jsonb('output_json').$type<CanvasAssetOutput>(),
  /** 公开可访问的 URL（经过 CDN 或 OSS 映射后） */
  publicUrl: text('public_url'),
  /** 内部存储路径（上传到 OSS 或本地后的路径） */
  storagePath: text('storage_path'),
  /** Provider 原始 URL（DashScope 返回的临时 URL，过期后不可访问） */
  providerUrl: text('provider_url'),

  // ── 成本追踪 ────────────────────────────────────
  /** 费用明细（token/image/video 成本） */
  cost: jsonb('cost').$type<CostDetail>(),
  /** 权威费用值（整数分），冗余存储用于 SQL 聚合 */
  totalPriceCents: integer('total_price_cents'),

  // ── 错误处理 ────────────────────────────────────
  /** 失败时的错误信息 */
  errorMessage: text('error_message'),

  // ── 资产选择机制 ────────────────────────────────
  /** 是否为当前活跃资产 — 同一 target 下仅一条 isActive=true */
  isActive: boolean('is_active').default(true).notNull(),
  /** 是否锁定 — locked=true 时后续生成不会自动覆盖此资产 */
  locked: boolean('locked').default(false).notNull(),

  /** 从资产中心隐藏的时间（null = 未隐藏，仍出现在资产列表） */
  hiddenAt: timestamp('hidden_at', { withTimezone: true }),

  /**
   * 用户软删除时间（null = 未删除）。
   *
   * 软删除后从资产中心移除，但 DB 记录与存储文件保留至 retention GC 清理，
   * 期间可通过 restore 恢复。若仍被项目/镜头引用（referenceAssetsJson 或当前
   * isActive 版本），GC 不会物理清除（retained），保证 Canvas 预览不破裂。
   */
  deletedAt: timestamp('deleted_at', { withTimezone: true }),

  // ── 时间追踪 ────────────────────────────────────
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  // 资产轮询：按项目+类别查询活跃资产
  index('idx_canvas_assets_project_category').on(table.projectId, table.category),
  // 按目标实体查询资产历史
  index('idx_canvas_assets_target').on(table.targetEntityType, table.targetEntityId),
  // 按项目+状态查询活跃任务
  index('idx_canvas_assets_project_status').on(table.projectId, table.status),
  // retention GC：按软删时间扫描过期未引用资产
  index('idx_canvas_assets_deleted_at').on(table.deletedAt),
])
