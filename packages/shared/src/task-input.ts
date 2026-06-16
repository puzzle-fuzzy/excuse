/**
 * JSONB task input parser/normalizer — 边界层运行时校验。
 *
 * `tasks.input` / `tasks.output` 是 JSONB 列，Drizzle `$type<T>()` 只做编译期类型断言，
 * 不做运行时校验。worker 直接 `task.input as {...}` 会把脏数据延迟到使用点才以未结构化
 * `TypeError` 爆出。本模块为 worker 消费的每类 task input 提供显式 parser：
 *   - 返回 `{ ok: true, input } | { ok: false, error }`，调用方据此分类失败（validation，
 *     不重试），而非依赖 `as` cast。
 *
 * 设计约束：纯函数、无 IO、无 DB 依赖。坏数据 / 缺字段 / 类型错一律 `ok: false`。
 * 旧数据兼容：parser 只校验 handler 真正需要的字段，多余字段透传不报错。
 */

/** 通用解析结果类型 */
export type ParseResult<T> = { ok: true, input: T } | { ok: false, error: string }

/** 从 unknown 提取字符串，非字符串返回 undefined */
function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

/** media.extract-audio 任务输入（worker handler 消费字段） */
export interface MediaExtractAudioInput {
  /** 视频文件 ID（uploaded_files.id） */
  videoFileId: string
  /** Canvas 项目 ID（冗余于 task.projectId，handler 用作回查） */
  projectId: string
}

/** media.burn-subtitle 任务输入（worker handler 消费字段） */
export interface MediaBurnSubtitleInput {
  /** 字幕导出记录 ID（subtitle_exports.id） */
  exportRecordId: string
}

/**
 * 解析 media.extract-audio 任务输入。
 * 必填：videoFileId、projectId（均为字符串）。
 */
export function parseMediaExtractAudioInput(raw: unknown): ParseResult<MediaExtractAudioInput> {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'media.extract-audio input is not an object' }
  }
  const o = raw as Record<string, unknown>
  const videoFileId = asString(o.videoFileId)
  const projectId = asString(o.projectId)
  if (!videoFileId)
    return { ok: false, error: 'media.extract-audio input missing videoFileId' }
  if (!projectId)
    return { ok: false, error: 'media.extract-audio input missing projectId' }
  return { ok: true, input: { videoFileId, projectId } }
}

/**
 * 解析 media.burn-subtitle 任务输入。
 * 必填：exportRecordId（字符串）。
 */
export function parseMediaBurnSubtitleInput(raw: unknown): ParseResult<MediaBurnSubtitleInput> {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'media.burn-subtitle input is not an object' }
  }
  const o = raw as Record<string, unknown>
  const exportRecordId = asString(o.exportRecordId)
  if (!exportRecordId)
    return { ok: false, error: 'media.burn-subtitle input missing exportRecordId' }
  return { ok: true, input: { exportRecordId } }
}

/**
 * 从 GenerationInputParams JSONB 中安全提取 worker / notify 路径消费的元字段。
 *
 * 这些字段（source / projectId / shotId）被 task-processor（SSE 通知定位）和 task-handler
 * 读取；裸 `inputParams.projectId` 在脏数据下是 `unknown`，String() 会得到 'undefined'。
 * 本函数做最小类型守卫，返回规范化元数据，多余模型参数不解析（由 provider 层校验）。
 */
export interface GenerationInputParamsMeta {
  /** 来源标记（合法值 'canvas' / 'gateway'，否则 undefined） */
  source?: 'canvas' | 'gateway'
  /** Canvas 项目 ID（仅当为字符串时保留） */
  projectId?: string
  /** Canvas 镜头 ID（仅当为字符串时保留） */
  shotId?: string
  /** 用户传入原始模型名（仅 gateway） */
  requestedModel?: string
  /** 参考文件 ID 列表（仅当为字符串数组时保留） */
  referenceFileIds?: string[]
}

export function parseGenerationInputParamsMeta(raw: unknown): GenerationInputParamsMeta {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw))
    return {}

  const o = raw as Record<string, unknown>
  const meta: GenerationInputParamsMeta = {}

  const source = asString(o.source)
  if (source === 'canvas' || source === 'gateway')
    meta.source = source

  const projectId = asString(o.projectId)
  if (projectId)
    meta.projectId = projectId

  const shotId = asString(o.shotId)
  if (shotId)
    meta.shotId = shotId

  const requestedModel = asString(o.requestedModel)
  if (requestedModel)
    meta.requestedModel = requestedModel

  if (Array.isArray(o.referenceFileIds) && o.referenceFileIds.every(v => typeof v === 'string'))
    meta.referenceFileIds = o.referenceFileIds as string[]

  return meta
}
