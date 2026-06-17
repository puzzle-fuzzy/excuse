import type { CharacterProfile, LocationProfile } from '@excuse/shared/domain-types'
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid, varchar, uniqueIndex } from 'drizzle-orm/pg-core'
import { accounts } from './accounts'
import { canvasProjects } from './canvas-projects'

/**
 * 用户级主体资产库 — 角色/场景跨项目复用
 *
 * 设计目标（见 docs/TODO.md §二、1）：
 *   - 角色/场景从「项目绑定」升级为「用户级资产」
 *   - 跨项目复用，避免每次新项目重新 AI 生成角色/场景
 *   - 来源可追溯（source_project_id + source_entity_id）
 */
export const subjectLibrary = pgTable('subject_library', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** 所属用户 */
  accountId: uuid('account_id').references(() => accounts.id).notNull(),
  /** 主体类型：character | location */
  subjectType: varchar('subject_type', { length: 20 }).$type<'character' | 'location'>().notNull(),
  /** 主体名称（角色名或场景名） */
  name: varchar('name', { length: 200 }).notNull(),
  /** 正面提示词（AI 生图角色一致性） */
  identityPrompt: text('identity_prompt'),
  /** 负面提示词 */
  negativePrompt: text('negative_prompt'),
  /** 场景提示词（仅 location 类型） */
  scenePrompt: text('scene_prompt'),
  /** LLM 生成的完整配置档案 */
  profileJson: jsonb('profile_json').$type<CharacterProfile | LocationProfile>(),
  /** 参考图 URL */
  referenceImageUrl: text('reference_image_url'),
  /** 三视图 URL（仅 character 类型） */
  turnaroundSheetUrl: text('turnaround_sheet_url'),
  /** 来源项目 ID（首次从哪个项目保存的） */
  sourceProjectId: uuid('source_project_id'),
  /** 来源实体 ID（首次从哪个角色/场景保存的） */
  sourceEntityId: uuid('source_entity_id'),
  /** 标签（GIN 索引） */
  tags: text('tags').array(),
  /** 是否收藏 */
  isFavorite: boolean('is_favorite').default(false).notNull(),
  /** 使用次数（跨项目引用计数） */
  usageCount: integer('usage_count').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('idx_subject_library_user_type').on(table.accountId, table.subjectType),
  index('idx_subject_library_tags').using('gin', table.tags),
])

/**
 * 项目 ↔ 主体资产多对多关联
 *
 * 一个项目可引用多个资产库中的角色/场景；
 * 一个资产库条目可被多个项目引用。
 */
export const projectSubjectRefs = pgTable('project_subject_refs', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** 所属项目 */
  projectId: uuid('project_id').references(() => canvasProjects.id).notNull(),
  /** 引用的资产库条目 */
  subjectId: uuid('subject_id').references(() => subjectLibrary.id).notNull(),
  /** 本项目内差异化配置（如服装变化） */
  overrideJson: jsonb('override_json'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  uniqueIndex('idx_project_subject_unique').on(table.projectId, table.subjectId),
])
