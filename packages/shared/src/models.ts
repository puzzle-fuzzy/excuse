// ===== 模型相关类型定义 =====

export interface ModelParameter {
  name: string
  type: 'text' | 'number' | 'select' | 'boolean'
  description?: string
  required?: boolean
  defaultValue?: unknown
  options?: { label: string, value: unknown }[]
  min?: number
  max?: number
  /** 存在则渲染为上传控件而非文本框。accept 为 MIME 类型（如 'image/*'） */
  mediaUpload?: { accept: string, multiple?: boolean }
}

export interface ModelPricing {
  inputPriceCents: number // 文本：每百万 Token 价格（分）；图片：每张价格（分）；视频：720P 每秒价格（分）
  outputPriceCents?: number // 文本输出：每百万 Token 价格（分）
  inputPrice1080Cents?: number // 视频：1080P 每秒价格（分）
  unit?: 'token' | 'image' | 'video' | 'audio'
  note?: string
}

/**
 * 参数到请求体的映射规则
 *
 * 设计约束：
 *   - Key 是 ModelParameter.name，Value 决定该参数在 DashScope API 请求体中的位置
 *   - applyMappings 遍历此表做 switch 分发，DashScopeClient 不含任何 model-name 分支
 *   - 新增模型只需在 model-configs.ts 声明 inputMapping + requestType，无需改 client 代码
 *   - 每个 required 参数必须在 inputMapping 中有映射（model-configs 测试强制）
 *   - 'ignored' 用于 UI-only 参数（如 watermark 开关），不进入 API 请求
 *
 * 映射目标与 DashScope API 请求体结构的对应关系：
 *   prompt     → input.prompt（chat 模型包装为 messages[].content）
 *   media      → input.media[{type, url}]（参考图/视频素材）
 *   mediaField → input[<field>]（模型特有字段如 audio_url、negative_prompt）
 *   parameter  → parameters[<paramName>]（通用参数如 size、seed、duration）
 *   ignored    → 跳过，不写入请求体
 */
export type InputMapping
  = | { target: 'prompt' }
    | { target: 'media', mediaType: string }
    | { target: 'mediaField', field: string }
    | { target: 'parameter' }
    | { target: 'ignored' }

/**
 * 请求体形状
 * - chat: 文本模型 — input.messages[]
 * - image: 图像生成 — input.messages[].content[].text
 * - video-t2v: 文生视频 — input.prompt（纯文本）
 * - video-media: 图生/参考生/编辑视频 — input.media[]
 * - audio: 音频生成（如 fun-music-v1 BGM）— input.prompt + input.gender/lyrics/format，无 parameters 包裹层
 */
export type RequestType = 'chat' | 'openai-chat' | 'image' | 'video-t2v' | 'video-media' | 'audio'

export interface ModelConfig {
  id: string
  name: string
  category: ModelCategory
  type: 'generation' | 'understanding' | 'editing'
  description: string
  endpoint: string
  async: boolean
  pricing: ModelPricing
  parameters: ModelParameter[]
  /** 请求体形状，决定客户端如何组装 request body */
  requestType?: RequestType
  /** 每个参数到请求体的映射。Key = 参数名，Value = 映射规则 */
  inputMapping?: Record<string, InputMapping>
  /** referenceUrls 数组映射到 input.media[] 时使用的 type（仅 r2v 等模型需要） */
  referenceMediaType?: string
  /** 失败时的降级模型 ID（如 r2v → t2v） */
  fallbackModel?: string
}

export const MODEL_CATEGORIES = [
  { id: 'text' as const, name: '文本生成', color: 'blue' },
  { id: 'image' as const, name: '图像生成', color: 'purple' },
  { id: 'video' as const, name: '视频生成', color: 'pink' },
  { id: 'audio' as const, name: '音频生成', color: 'amber' },
  { id: 'subtitle' as const, name: '字幕生成', color: 'teal' },
] as const

export type ModelCategory = typeof MODEL_CATEGORIES[number]['id']

/**
 * Category 元数据注册表 — 消除散弹式 category switch/if-else（§3.2）。
 *
 * 新增 category 时只需在此表新增一行，所有消费方通过 `CATEGORY_META[category]` 取值。
 * 未知 category 的消费者应在调用侧显式报错，不应静默兜底。
 */
export interface CategoryMeta {
  /** display name（中文，用于通知/UI 标签） */
  label: string
  /** 资产库 kind */
  assetKind: 'text' | 'image' | 'video' | 'audio' | 'subtitle'
  /** 通知文案：完成标题模板 */
  notifyCompletedTitle: string
  /** 通知文案：失败标题模板 */
  notifyFailedTitle: string
  /** 是否为同步任务（provider 直接返回结果，非异步 taskId） */
  sync: boolean
}

export const CATEGORY_META: Record<ModelCategory, CategoryMeta> = {
  text: {
    label: '文本生成',
    assetKind: 'text',
    notifyCompletedTitle: '文本生成完成',
    notifyFailedTitle: '文本生成失败',
    sync: true,
  },
  image: {
    label: '图片生成',
    assetKind: 'image',
    notifyCompletedTitle: '图片生成完成',
    notifyFailedTitle: '图片生成失败',
    sync: true,
  },
  video: {
    label: '视频生成',
    assetKind: 'video',
    notifyCompletedTitle: '视频生成完成',
    notifyFailedTitle: '视频生成失败',
    sync: false,
  },
  audio: {
    label: '音频生成',
    assetKind: 'audio',
    notifyCompletedTitle: '音频生成完成',
    notifyFailedTitle: '音频生成失败',
    sync: true,
  },
  subtitle: {
    label: '字幕生成',
    assetKind: 'subtitle',
    notifyCompletedTitle: '字幕生成完成',
    notifyFailedTitle: '字幕生成失败',
    sync: false,
  },
} as const
