import type { CanvasLayoutDto, CanvasModelPreferences, NovelAnalysis } from '../domain-types'
import { boolean, index, jsonb, pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { accounts } from './accounts'

/**
 * Canvas 项目状态枚举 — 随流水线阶段推进逐步升级
 *
 * 状态推进规则（只前进不回退，除非重置）：
 *   draft → analyzed（阶段 1 完成）
 *   analyzed → characters_ready（阶段 2 完成）
 *   characters_ready → locations_ready（阶段 3 完成）
 *   locations_ready → refs_ready（阶段 4 完成）
 *   refs_ready → refs_all_ready（阶段 5 完成）
 *   refs_all_ready → storyboard_ready（阶段 6 完成）
 *   storyboard_ready → continuity_checked（阶段 7 完成）
 *   continuity_checked → prompts_ready（阶段 8 完成）
 *   prompts_ready → generating（阶段 9 开始）
 *   generating → completed / partial_failed（阶段 9 结束）
 *
 * 异常状态：
 *   failed — 任一阶段执行失败
 *   partial_failed — 视频生成部分成功部分失败
 */
export const canvasProjectStatusEnum = pgEnum('canvas_project_status', [
  'draft', // 初始状态，刚创建
  'analyzed', // 阶段 1 完成：故事已分析
  'characters_ready', // 阶段 2 完成：角色档案已生成
  'locations_ready', // 阶段 3 完成：场景档案已生成
  'refs_ready', // 阶段 4 完成：角色参考图已生成
  'refs_all_ready', // 阶段 5 完成：场景参考图已生成
  'storyboard_ready', // 阶段 6 完成：分镜脚本已生成
  'continuity_checked', // 阶段 7 完成：连续性已校验
  'prompts_ready', // 阶段 8 完成：视频提示词已重建
  'generating', // 阶段 9 执行中：视频正在生成
  'partial_failed', // 部分镜头生成失败
  'completed', // 全部完成
  'failed', // 执行失败
])

/**
 * Canvas 项目表 — AI 视频制作流水线的顶层容器
 *
 * 关联：accounts（项目所有者）
 * 软删除：isDeleted=true 时不会出现在查询结果中
 * 子资源：characters / locations / shots / continuityReports / pipelineRuns
 * 9 阶段流水线：analyze → characters → locations → characterRefs → locationRefs
 *               → storyboard → continuity → rebuild → videos
 */
export const canvasProjects = pgTable('canvas_projects', {
  /** 主键，UUID 自动生成 */
  id: uuid('id').defaultRandom().primaryKey(),
  /** 项目所有者，外键 → accounts.id */
  accountId: uuid('account_id').references(() => accounts.id).notNull(),
  /** 项目标题（可选，默认使用故事文本的前 50 字） */
  title: varchar('title', { length: 500 }),
  /** 故事文本（用户输入的原始故事，是所有 AI 生成的输入源） */
  storyText: text('story_text').notNull(),
  /** 项目当前状态（随流水线推进自动更新） */
  status: canvasProjectStatusEnum('status').notNull().default('draft'),
  /** 阶段 1 分析结果（摘要、冲突、时间线、角色名、场景名） */
  analysisJson: jsonb('analysis_json').$type<NovelAnalysis>(),
  /** 用户偏好的文本/图片/视频模型 ID */
  modelPreferencesJson: jsonb('model_preferences_json').$type<CanvasModelPreferences>(),
  /** 前端 React Flow 画布布局（节点位置、视口状态，后端只透传） */
  canvasLayout: jsonb('canvas_layout').$type<CanvasLayoutDto>(),
  /** Phase 10 bgm 生成的 BGM 音频 URL（转存后的 OSS / 本地路径） */
  bgmUrl: text('bgm_url'),
  /** 软删除标记（true 时不出现在查询结果中） */
  isDeleted: boolean('is_deleted').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('idx_canvas_projects_account_created').on(table.accountId, table.isDeleted, table.createdAt),
])
