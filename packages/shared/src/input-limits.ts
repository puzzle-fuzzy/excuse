/**
 * 输入限制常量 — 单一来源
 *
 * 前端表单、server route、worker phase 都引用此文件，
 * 前后端边界一致，避免漂移。
 *
 * 所有限制集中声明；扩展时只改此处。
 */

// ─── Prompt 长度限制 ──────────────────────────────

/**
 * 各生成类别的 prompt 字符长度上限。
 *
 * 取值依据：text 100k 仍在主流模型上下文内且成本可控；
 * image/video prompt 本就是短描述，8k 足够。subtitle 无 prompt（用音频 URL）。
 */
export const PROMPT_LENGTH_LIMITS: Record<string, number> = {
  text: 100_000,
  image: 8_000,
  video: 8_000,
}

/** OpenAI 兼容网关 messages 总字符上限（外部 API key 需防滥用） */
export const GATEWAY_MESSAGES_MAX_TOTAL_CHARS = 100_000

// ─── Canvas 项目输入限制 ──────────────────────────

/** Canvas 故事文本最大字符数 */
export const MAX_STORY_TEXT_LENGTH = 500_000

/** Canvas 分镜最大数量 */
export const MAX_CANVAS_SHOTS = 200

/** Canvas 每镜头最大时长（秒） */
export const MAX_SHOT_DURATION_SECONDS = 60

/** Canvas 每镜头最小时长（秒） */
export const MIN_SHOT_DURATION_SECONDS = 2

// ─── 上传限制 ─────────────────────────────────────

/** 参考文件最大数量（图片/视频上传） */
export const MAX_REFERENCE_FILES = 10

/** 允许的上传 MIME 类型 */
export const ALLOWED_UPLOAD_MIMES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'video/mp4',
  'video/webm',
  'audio/mp3',
  'audio/wav',
  'audio/mpeg',
  'audio/ogg',
]

/** 单文件最大大小（字节）— 默认 100 MB */
export const MAX_UPLOAD_FILE_SIZE = 100 * 1024 * 1024

// ─── 模型参数范围 ─────────────────────────────────

/** Prompt 最小字符数（非空校验） */
export const MIN_PROMPT_LENGTH = 1

/** 温度参数范围 */
export const TEMPERATURE_MIN = 0
export const TEMPERATURE_MAX = 2

/** Top-p 参数范围 */
export const TOP_P_MIN = 0
export const TOP_P_MAX = 1

/** 最大 token 数上限（单次生成） */
export const MAX_TOKENS_LIMIT = 16_384

// ─── 辅助函数 ─────────────────────────────────────

/** 检查 MIME 是否在允许列表中 */
export function isAllowedMime(mime: string): boolean {
  return ALLOWED_UPLOAD_MIMES.includes(mime)
}

/** 检查文件大小是否在限制内 */
export function isFileSizeWithinLimit(sizeBytes: number): boolean {
  return sizeBytes <= MAX_UPLOAD_FILE_SIZE
}

/**
 * 校验 prompt 长度不超类别上限，返回错误消息或 null。
 * 纯函数，不含 HTTP 依赖，可在前后端通用。
 */
export function checkPromptLengthLimit(category: string, promptLength: number): string | null {
  const limit = PROMPT_LENGTH_LIMITS[category]
  if (!limit)
    return null
  if (promptLength > limit) {
    return `prompt 长度 ${promptLength} 超过 ${category} 类别上限 ${limit} 字符`
  }
  return null
}
