import type { DashScopeUsage } from './dashscope-types'

/** DashScope API 连接配置 */
export interface DashScopeConfig {
  apiKey: string
  /** API 端点基地址，不指定时用 DashScope 默认端点 */
  baseUrl?: string
  /**
   * 同步 provider 调用（chat / image / audio / video submit / queryTask）的整体超时（ms）。
   * 未设置时用 `DEFAULT_HTTP_TIMEOUT_MS`（60s）。见 docs/TODO.md §1.1。
   */
  httpTimeoutMs?: number
  /**
   * 流式调用（chatCompletionStream）每个 chunk 之间的空闲超时（ms）。
   * 未设置时用 `DEFAULT_STREAM_IDLE_TIMEOUT_MS`（30s）。见 docs/TODO.md §1.1。
   */
  streamIdleTimeoutMs?: number
}

/** Provider 调用用量汇总 — 由 buildCostDetail 转为 CostDetail */
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

/** Provider 调用成功结果 — 文本生成 */
export interface TextProviderResult {
  type: 'text'
  success: true
  model: string
  output: TextProviderOutput
  usage?: ProviderUsage
}

/** Provider 调用成功结果 — 图片生成 */
export interface ImageProviderResult {
  type: 'image'
  success: true
  model: string
  output: ImageProviderOutput
  usage?: ProviderUsage
}

/** Provider 调用成功结果 — 异步视频任务已提交 */
export interface VideoTaskProviderResult {
  type: 'video_task'
  success: true
  model: string
  taskId: string
  output: VideoTaskProviderOutput
  usage?: ProviderUsage
}

/** Provider 调用成功结果 — 音频生成 */
export interface AudioProviderResult {
  type: 'audio'
  success: true
  model: string
  output: AudioProviderOutput
  usage?: ProviderUsage
}

/** Provider 调用失败结果 */
export interface FailedProviderResult {
  type: 'failed'
  success: false
  model?: string
  error: string
  /**
   * 机器可读错误码（见 docs/TODO.md §1.1）。
   * - 传输层失败：`'TIMEOUT'`（同步/流式超时）/ `'ECONNRESET'`（网络中断）等
   *   —— 由消费方以 `cause.code` 透传给 `@excuse/task-engine`，进入可重试分类。
   * - provider 返回的业务错误（如 400 参数非法）：不设 code —— 不应重试。
   */
  code?: string
}

/** Provider 调用结果联合 — 所有可能返回形状 */
export type ProviderResult
  = | TextProviderResult
    | ImageProviderResult
    | VideoTaskProviderResult
    | AudioProviderResult
    | FailedProviderResult

/** DashScope 异步任务当前状态（轮询结果） */
export interface TaskStatus {
  taskId: string
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN'
  output?: DashScopeTaskOutput
  usage?: DashScopeUsage
  errorCode?: string
  errorMessage?: string
}
