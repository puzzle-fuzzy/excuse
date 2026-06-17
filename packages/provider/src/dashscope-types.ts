// ===== DashScope API 响应类型定义 =====
// 根据 DashScope 官方文档和实际 API 返回结构定义
// 用于替换 dashscope-client.ts 中的 `as any` 类型断言

// ── Usage（计费用量）──
// DashScope 原生格式和 OpenAI 兼容格式使用不同的字段名，
// 统一为一个 interface 以避免 union narrowing 问题

export interface DashScopeUsage {
  input_tokens?: number
  output_tokens?: number
  image_count?: number
  prompt_tokens?: number // OpenAI 兼容格式
  completion_tokens?: number // OpenAI 兼容格式
}

// ── Chat / Text 响应 ──

/** DashScope 原生文本响应 */
export interface DashScopeChatResponse {
  output: {
    choices?: Array<{
      message: {
        content?: Array<{ text: string }> | string
      }
    }>
    text?: string
  }
  usage?: DashScopeUsage
  request_id?: string
  code?: string
  message?: string
}

/** OpenAI 兼容格式响应 */
export interface DashScopeOpenaiChatResponse {
  choices?: Array<{
    message: {
      content?: string
    }
  }>
  usage?: DashScopeUsage
  request_id?: string
  code?: string
  message?: string
}

/**
 * DashScope chat 协议（增量输出）SSE 单帧响应
 *
 * 与 OpenAI 兼容协议不同：
 *   - 增量文本在 `output.text`，而不是 `choices[0].delta.content`。
 *   - `finish_reason` 是字符串（`"null"` / `"stop"` / `"length"`），DashScope 用字符串 null 而非 JSON null。
 *   - usage 字段名是 `total_tokens` / `input_tokens` / `output_tokens`，无 `prompt_tokens` 别名。
 */
export interface DashScopeChatStreamEvent {
  output: {
    /** 增量文本（每帧的 delta；非流式响应中的 output.choices[].message.content 数组形态不适用于流式） */
    text?: string
    /** 'null' 字符串 / 'stop' / 'length'（DashScope 用字符串 null 而非 JSON null） */
    finish_reason?: string
  }
  usage?: {
    total_tokens?: number
    input_tokens?: number
    output_tokens?: number
  }
  request_id?: string
}

// ── Image 响应 ──

export interface DashScopeImageResponse {
  output: {
    choices?: Array<{
      message: {
        content?: Array<{ image?: string }>
      }
    }>
  }
  usage?: DashScopeUsage
  request_id?: string
  code?: string
  message?: string
}

// ── Audio（FunMusic 音乐生成）同步响应 ──

/**
 * fun-music-v1 非流式响应
 *
 * output.audio.url: 生成的音频 OSS URL（24h 有效）
 * output.audio.expires_at / id: 音频元信息
 * output.extra_info: channels / sample_rate / lyrics
 * usage.duration: 生成音频时长（秒），用于按秒计费
 */
export interface FunMusicResponse {
  output?: {
    audio?: {
      url?: string
      id?: string
      expires_at?: number
    }
    extra_info?: {
      channels?: number
      sample_rate?: string
      lyrics?: string
    }
    finish_reason?: string | null
  }
  usage?: {
    duration?: number
  }
  request_id?: string
  code?: string
  message?: string
}

// ── Video 异步任务 ──

/** 视频任务提交响应 */
export interface DashScopeVideoSubmitResponse {
  output?: {
    task_id?: string
  }
  request_id?: string
  code?: string
  message?: string
}

/** DashScope 异步任务查询结果中的单个结果条目 */
export interface DashScopeTaskResultItem {
  url?: string
  b64_image?: string
}

/** 异步任务查询响应 */
export interface DashScopeTaskQueryResponse {
  output: {
    task_status?: string
    video_url?: string
    results?: Array<DashScopeTaskResultItem>
    /** 实际视频时长（部分 DashScope 模型返回） */
    video_duration?: number
    /** 视频时长别名（部分模型使用 duration 而非 video_duration） */
    duration?: number
    code?: string
    message?: string
  }
  usage?: DashScopeUsage
  code?: string
  message?: string
  request_id?: string
}

// ── 通用错误响应 ──

export interface DashScopeErrorResponse {
  code?: string
  message?: string
  request_id?: string
}
