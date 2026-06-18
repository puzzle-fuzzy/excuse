import type { SubtitleSentence, SubtitleStyleConfig } from '../domain-types'
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { accounts } from './accounts'
import { generationRecords } from './generation-records'
import { uploadedFiles } from './uploaded-files'

/**
 * 字幕项目状态枚举
 *
 * 状态流转：
 *   draft → extracting_audio:  开始提取音频
 *   extracting_audio → asr_processing: 音频提取完成，提交 ASR 任务
 *   asr_processing → subtitle_editing: ASR 完成，用户可编辑字幕
 *   subtitle_editing → exporting: 用户提交导出
 *   exporting → completed: 导出完成
 *   any → failed: 任一步骤失败
 */
export const subtitleProjectStatusEnum = pgEnum('subtitle_project_status', [
  'draft',
  'extracting_audio',
  'asr_processing',
  'subtitle_editing',
  'exporting',
  'completed',
  'failed',
])

/**
 * 字幕项目表 — 记录字幕生成的完整生命周期
 *
 * 流程：上传视频 → 提取音频 → ASR 识别 → 字幕编辑 → 导出
 * 与 generation_records 关联：ASR 任务和导出任务各自对应一条 generation_record
 */
export const subtitleProjects = pgTable('subtitle_projects', {
  /** 主键，UUID 自动生成 */
  id: uuid('id').defaultRandom().primaryKey(),

  /** 所属用户，外键 → accounts.id */
  accountId: uuid('account_id').references(() => accounts.id).notNull(),

  /** 原始视频文件，外键 → uploaded_files.id */
  videoFileId: uuid('video_file_id').references(() => uploadedFiles.id).notNull(),

  /** 视频文件 URL（冗余，方便前端直接播放） */
  videoUrl: text('video_url').notNull(),

  /** 提取的音频文件 URL */
  audioFileUrl: text('audio_file_url'),

  /** 视频时长（毫秒） */
  videoDurationMs: integer('video_duration_ms'),

  /** ASR 任务记录，外键 → generation_records.id */
  asrRecordId: uuid('asr_record_id').references(() => generationRecords.id),

  /** 项目状态 */
  status: subtitleProjectStatusEnum('status').notNull().default('draft'),

  /** Paraformer 原始转录输出（完整的 JSON） */
  rawTranscription: jsonb('raw_transcription'),

  /** 编辑后的字幕句子列表 — 域类型 SubtitleSentence[] */
  sentences: jsonb('sentences').$type<SubtitleSentence[]>(),

  /** 字幕样式配置 — 域类型 SubtitleStyleConfig */
  styleConfig: jsonb('style_config').$type<SubtitleStyleConfig>().default({
    templateId: 'cinema',
    fontSize: 38,
    fontColor: '#FFFFFF',
    outlineColor: '#000000',
    outlineWidth: 2,
    position: 'bottom',
    marginV: 30,
    bold: false,
  }),

  /** 导出任务记录，外键 → generation_records.id */
  exportRecordId: uuid('export_record_id').references(() => generationRecords.id),

  /** 导出后的视频 URL */
  exportedVideoUrl: text('exported_video_url'),

  /** 失败时的错误信息 */
  errorMessage: text('error_message'),

  /** 创建时间 */
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),

  /** 最后更新时间 */
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('idx_subtitle_projects_account_created').on(table.accountId, table.createdAt),
  index('idx_subtitle_projects_status').on(table.status),
])
