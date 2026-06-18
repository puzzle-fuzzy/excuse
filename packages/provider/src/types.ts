import type { DashScopeUsage } from './dashscope-types'

export interface DashScopeConfig {
  apiKey: string
  baseUrl?: string
}

export interface ProviderUsage {
  inputTokens?: number
  outputTokens?: number
  imageCount?: number
  videoDuration?: number
  audioDuration?: number
}

/** 流式文本生成的单帧结果（async generator yield 类型） */
export interface TextStreamChunk {
  type: 'text-stream'
  model: string
  /** 当前帧的增量文本（首个帧可能为空字符串，仅带 role） */
  delta: string
  /** 流结束时的 usage（中间帧一般为 undefined） */
  usage?: ProviderUsage
  /** 是否流结束（finish_reason !== null） */
  done: boolean
}

export interface TextProviderOutput {
  type: 'text'
  text: string
  /** DashScope 原始响应（非结构化，供调试/审计） */
  raw: unknown
}

export interface ImageProviderOutput {
  type: 'image'
  urls: string[]
  /** DashScope 原始响应（非结构化，供调试/审计） */
  raw: unknown
}

export interface VideoTaskProviderOutput {
  type: 'processing'
  taskId: string
  status: 'submitted'
  /** DashScope 原始响应（非结构化，供调试/审计） */
  raw: unknown
}

/**
 * 音频生成输出（如 fun-music-v1 BGM）— 同步返回
 *
 * url: 生成的音频文件 OSS URL（DashScope 返回，24h 有效，需尽快转存）
 * durationSeconds: 音频时长（秒），用于按秒计费
 * format: 音频编码格式（mp3 / wav）
 */
export interface AudioProviderOutput {
  type: 'audio'
  url: string
  durationSeconds: number
  format: string
  /** DashScope 原始响应（非结构化，供调试/审计） */
  raw: unknown
}

/**
 * DashScope 异步任务查询输出 — 外部 API 边界类型
 *
 * video_url: 已完成的视频任务（万相/HappyHorse）
 * results: 已完成的图片异步任务
 * video_duration/duration: 部分视频模型返回实际时长
 *
 * DashScope API 可能返回额外字段，index signature 兼容未知结构。
 */
export interface DashScopeTaskOutput {
  video_url?: string
  results?: Array<{ url?: string, b64_image?: string }>
  video_duration?: number
  duration?: number
  /** DashScope 额外字段 — 外部 API 边界 */
  [key: string]: unknown
}

export interface TextProviderResult {
  type: 'text'
  success: true
  model: string
  output: TextProviderOutput
  usage?: ProviderUsage
}

export interface ImageProviderResult {
  type: 'image'
  success: true
  model: string
  output: ImageProviderOutput
  usage?: ProviderUsage
}

export interface VideoTaskProviderResult {
  type: 'video_task'
  success: true
  model: string
  taskId: string
  output: VideoTaskProviderOutput
  usage?: ProviderUsage
}

export interface AudioProviderResult {
  type: 'audio'
  success: true
  model: string
  output: AudioProviderOutput
  usage?: ProviderUsage
}

export interface FailedProviderResult {
  type: 'failed'
  success: false
  model?: string
  error: string
}

export type ProviderResult
  = | TextProviderResult
    | ImageProviderResult
    | VideoTaskProviderResult
    | AudioProviderResult
    | FailedProviderResult

export interface TaskStatus {
  taskId: string
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN'
  output?: DashScopeTaskOutput
  usage?: DashScopeUsage
  errorCode?: string
  errorMessage?: string
}
