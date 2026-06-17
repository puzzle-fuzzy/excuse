import type { CanvasShotReferenceAsset, ShotCamera, ShotContinuity, ShotEnvironment, ShotTimelineEntry } from '../domain-types'
import type { DialogueJson } from '@excuse/shared/domain-types'
import { sql } from 'drizzle-orm'
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { canvasLocations } from './canvas-locations'
import { canvasProjects } from './canvas-projects'

/**
 * Canvas 镜头状态枚举
 *
 * 状态流转：
 *   draft → ready（rebuild 阶段组装完 videoPrompt）
 *   ready → generating（videos 阶段提交到 DashScope）
 *   generating → completed（Worker 轮询到完成并下载视频）
 *   generating → failed（生成失败或超时）
 *   failed → draft（retry 重置后重新走 ready → generating 流程）
 */
export const canvasShotStatusEnum = pgEnum('canvas_shot_status', [
  'draft', // 初始状态，分镜已生成但 videoPrompt 未组装
  'ready', // videoPrompt 已就绪，等待视频生成
  'generating', // 已提交到 DashScope，等待视频完成
  'completed', // 视频已生成并下载
  'failed', // 视频生成失败
])

/**
 * Canvas 镜头表 — AI 视频流水线中的单个镜头
 *
 * 关联：canvas_projects（所属项目）+ canvas_locations（拍摄场景，可选）
 * 生命周期：阶段 6（storyboard）生成分镜 → 阶段 8（rebuild）组装 videoPrompt
 *           → 阶段 9（videos）提交生成 → Worker 轮询完成
 * 排序：shotIndex 决定镜头播放顺序
 * 角色引用：characterIdsJson 存储引用的角色 ID 列表（多对多关系扁平化）
 * 自动清理：角色/场景删除时自动清理镜头中的引用
 */
export const canvasShots = pgTable('canvas_shots', {
  /** 主键，UUID 自动生成 */
  id: uuid('id').defaultRandom().primaryKey(),
  /** 所属项目，外键 → canvas_projects.id */
  projectId: uuid('project_id').references(() => canvasProjects.id).notNull(),
  /** 镜头序号（从 0 开始，决定播放顺序） */
  shotIndex: integer('shot_index').notNull(),
  /** 镜头时长（秒），默认 5 秒 */
  duration: integer('duration').default(5).notNull(),
  /** 拍摄场景，外键 → canvas_locations.id（可选，部分镜头无明确场景） */
  locationId: uuid('location_id').references(() => canvasLocations.id),
  /** 出场角色 ID 列表（JSON 数组，引用 canvas_characters.id） */
  characterIdsJson: jsonb('character_ids_json').$type<string[]>().default([]).notNull(),
  /** 镜头叙事文本（该镜头要表达的故事内容） */
  narrative: text('narrative').notNull(),
  /** 摄影参数（景别、角度、运动、镜头） */
  cameraJson: jsonb('camera_json').$type<ShotCamera>().notNull(),
  /** 连续性参数（屏幕方向、角色朝向、动作/情绪起止） */
  continuityJson: jsonb('continuity_json').$type<ShotContinuity>().notNull(),
  /** 时间线条目列表（镜头内的事件时间轴） */
  timelineJson: jsonb('timeline_json').$type<ShotTimelineEntry[]>(),
  /** 环境参数（背景运动、光影、情绪、风格） */
  environmentJson: jsonb('environment_json').$type<ShotEnvironment>(),
  /** AI 视频生成提示词（阶段 8 rebuild 根据角色+场景+摄影参数组装） */
  videoPrompt: text('video_prompt'),
  /** 负面提示词（视频生成时排除的元素） */
  negativePrompt: text('negative_prompt'),
  /** DashScope 异步视频任务 ID（提交后返回，Worker 用此 ID 轮询） */
  videoTaskId: varchar('video_task_id', { length: 255 }),
  /** 生成的视频文件 URL（Worker 下载并存储后的公开访问地址） */
  videoUrl: text('video_url'),
  /** 镜头当前状态 */
  status: canvasShotStatusEnum('status').default('draft').notNull(),
  /** 失败时的错误信息 */
  errorMessage: text('error_message'),
  /** 镜头额外参考资产列表（用户可选择多个参考图，生成时合并进 referenceUrls） */
  referenceAssetsJson: jsonb('reference_assets_json').$type<CanvasShotReferenceAsset[]>().default([]).notNull(),
  /** 对话层 LLM 输出文本（Phase 8.5 dialogue 生成） */
  dialoguePrompt: text('dialogue_prompt'),
  /** 结构化对话数据（Phase 8.5 dialogue 生成） */
  dialogueJson: jsonb('dialogue_json').$type<DialogueJson>(),
  /** R2V 参考媒体列表（角色 turnaround + 场景 reference_image） */
  referenceMedia: jsonb('reference_media'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('idx_canvas_shots_project_index').on(table.projectId, table.shotIndex),
  /** 资产删除引用守卫：reference_assets_json @> 包含查询（每次软删/GC retain 扫全表） */
  index('idx_canvas_shots_ref_assets_gin').using('gin', sql`${table.referenceAssetsJson} jsonb_path_ops`),
])
