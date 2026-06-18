// ===== Shared Domain Types =====
// 纯数据接口，无运行时依赖，供 DB schema $type() 和 app/package 边界共用。

/**
 * 画布布局 — 前端 React Flow 节点位置/视口状态
 */
export interface CanvasLayoutPosition {
  x: number
  y: number
}

export interface CanvasLayoutViewport extends CanvasLayoutPosition {
  zoom: number
}

export interface CanvasLayoutNode {
  id: string
  type?: string
  position: CanvasLayoutPosition
  width?: number
  height?: number
  /** 前端 React Flow 节点数据 — 存储边界：backend 不解读此字段内容 */
  data?: Record<string, unknown>
}

export interface CanvasLayoutEdge {
  id: string
  source: string
  target: string
  type?: string
  /** 前端 React Flow 边数据 — 存储边界：backend 不解读此字段内容 */
  data?: Record<string, unknown>
}

export interface CanvasLayoutDto {
  nodes: CanvasLayoutNode[]
  edges: CanvasLayoutEdge[]
  viewport?: CanvasLayoutViewport
}

/** 用户可选择的模型类别偏好 */
export interface CanvasModelPreferences {
  textModel?: string
  imageModel?: string
  videoModel?: string
  /** 是否启用后端自动推进流水线阶段（Worker 完成一个阶段后自动创建下一个阶段的任务） */
  autoProgress?: boolean
}

// ===== Canvas Asset Domain Types =====

/**
 * Canvas 资产输出 — 存储在 canvas_assets.outputJson JSONB 中
 *
 * 根据 category 不同，输出形态不同：
 *   text 类（analysis/characterProfile/locationProfile/storyboard/continuityReport/videoPrompt）：
 *     type='json', data={...} 存储解析后的 LLM 输出
 *   image 类（characterPortrait/characterTurnaround/locationRef）：
 *     type='image', urls=[...] 存储 provider 返回的图片 URL 列表
 *   video 类（shotVideo）：
 *     type='video', urls=[...] 存储下载后的视频 URL
 */
export interface CanvasAssetOutput {
  type: 'text' | 'image' | 'video' | 'json'
  /** LLM 输出的文本内容（text 类型） */
  text?: string
  /** 图片/视频 URL 列表（image/video 类型） */
  urls?: string[]
  /** 结构化 JSON 数据（json 类型） */
  data?: Record<string, unknown>
}

// ===== Task Domain Types =====

/** 任务输入参数 — 结构随 task type 定义 */
export interface TaskInput {
  [key: string]: unknown
}

/** 任务输出结果 — 结构随 task type 定义 */
export interface TaskOutput {
  [key: string]: unknown
}

/** 任务错误信息 — 区分 retriable vs permanent */
export interface TaskErrorInfo {
  /** 错误分类（provider_error / timeout / validation / system） */
  category: string
  /** 是否可重试 */
  retriable: boolean
  /** 原始错误码（如 provider error code） */
  code?: string
  /** 错误详情 */
  message: string
  /** 重试延迟建议（ms） */
  retryDelayMs?: number
}

/** 故事分析结果 */
export interface NovelAnalysis {
  summary: string
  mainConflict: string
  timeline: string[]
  characterNames: string[]
  sceneNames: string[]
}

/** 角色档案（LLM 输出） */
export interface CharacterProfile {
  name: string
  role: string
  age: string
  gender: string
  bodyShape: string
  height: string
  face: { shape: string, eyes: string, eyebrows: string, nose: string, mouth: string, skin: string }
  hair: { color: string, style: string, length: string }
  costume: { mainColor: string, style: string, material: string, details: string[] }
  accessories: string[]
  identityPrompt: string
  negativePrompt: string
}

/** 场景档案（LLM 输出） */
export interface LocationProfile {
  name: string
  type: 'interior' | 'exterior' | 'mixed'
  location: string
  era: string
  atmosphere: string
  visualRules: {
    colorPalette: string[]
    lighting: string
    architecture: string
    floor: string
    backgroundElements: string[]
  }
  cameraRules: {
    axisDirection: string
    allowedAngles: string[]
    forbiddenAngles: string[]
  }
  scenePrompt: string
  negativePrompt: string
}

/** 镜头摄影参数（从 ShotDraft.camera 提取） */
export interface ShotCamera {
  shotSize: string
  angle: string
  movement: string
  lens: string
}

/** 镜头连续性参数（从 ShotDraft.continuity 提取） */
export interface ShotContinuity {
  screenDirection: string
  characterFacing: Record<string, string>
  actionStart: string
  actionEnd: string
  emotionStart: string
  emotionEnd: string
}

/** 镜头时间线条目（从 ShotDraft.timeline 提取） */
export interface ShotTimelineEntry {
  time: string
  action: string
}

/** 镜头环境参数（从 ShotDraft.environment 提取） */
export interface ShotEnvironment {
  backgroundMotion?: string
  lighting?: string
  mood?: string
  style?: string
}

/** 连续性问题 */
export interface ContinuityIssue {
  severity: 'error' | 'warning'
  shotId?: string
  shotIndex?: number
  code: 'MISSING_SCENE' | 'MISSING_CHARACTER' | 'FORBIDDEN_CAMERA_ANGLE'
    | 'FACING_CHANGE' | 'ACTION_MISMATCH' | 'EMOTION_MISMATCH'
  message: string
  suggestion?: string
}

// ===== Canvas Shot Reference Asset Types =====

/**
 * 镜头额外参考资产的语义角色 — 用户可理解的标签，本轮不强绑定 provider 参数
 */
export type CanvasShotReferenceRole
  = | 'character'
    | 'location'
    | 'style'
    | 'firstFrame'
    | 'other'

/**
 * 镜头额外参考资产 — 保存到 canvas_shots.referenceAssetsJson JSONB 中
 *
 * 用户可以在某个镜头上选择多个额外参考资产，生成/重试/重新生成镜头视频时
 * 合并到 referenceUrls（角色/场景自动引用在前，用户额外引用在后，去重）。
 */
export interface CanvasShotReferenceAsset {
  /** 统一资产 ID。早期允许 uploaded_files.id 或 canvas_assets.id */
  assetId: string
  /** 生成时直接可用的稳定 URL，优先 publicUrl */
  url: string
  /** 语义标签：角色图 / 场景图 / 风格图 / 首帧图 / 其他 */
  role: CanvasShotReferenceRole
  /** UI 展示标签，避免只显示 URL。可选，最大 100 字符 */
  label?: string
  /** 来源：资产库 / 上传文件 / 手动输入 */
  source?: 'asset_library' | 'uploaded_file' | 'manual'
}

// ===== Generation Domain Types =====

/**
 * 生成任务输入参数信封 — 存储在 generation_records.inputParams JSONB 中
 *
 * 平坦结构：模型参数（prompt, n, duration, resolution 等）与信封字段
 * （source, projectId, shotId, referenceFileIds）在同一层级。
 * DB JSONB 无法按模型区分参数结构，故用 index signature 兼容动态键。
 *
 * 业务代码应通过 ValidatedModelParameters（@excuse/provider）访问模型参数，
 * 不应直接索引此信封的 unknown 字段。
 */
export interface GenerationInputParams {
  /** 来源标记：'canvas' = Canvas 流水线，'gateway' = OpenAI 兼容网关 */
  source?: 'canvas' | 'gateway'
  /** Canvas 项目 ID（仅 canvas 来源时存在） */
  projectId?: string
  /** Canvas 镜头 ID（仅 canvas 来源时存在） */
  shotId?: string
  /** 用户传入的原始模型名（仅 gateway 来源时存在，如 gpt-4o-mini），用于 usage 列表展示 */
  requestedModel?: string
  /** 参考文件 ID 列表（用户上传参考图时存在） */
  referenceFileIds?: string[]
  /**
   * 模型参数 — 动态键，由 ModelConfig.parameters 声明决定。
   * DB JSONB 存储边界：无法静态枚举所有模型的参数组合。
   * 服务层应通过 ValidatedModelParameters 访问，此处仅存储。
   */
  [key: string]: unknown
}

/**
 * 费用明细（jsonb cost 字段的域类型）
 *  quantity / unitPrice 仅 image/video variant 存在；
 *  token variant 使用 inputUnitPrice / outputUnitPrice / inputCost / outputCost
 */
export interface CostDetail {
  unit: 'token' | 'image' | 'video' | 'audio'
  totalPriceCents: number // 整数分，金额的权威值
  totalPrice: number // 元（浮点），向后兼容
  quantity?: number
  unitPriceCents?: number // 分（整数）
  unitPrice?: number // 元（浮点），向后兼容
  inputTokens?: number
  outputTokens?: number
  inputUnitPriceCents?: number // 分
  inputUnitPrice?: number // 元，向后兼容
  outputUnitPriceCents?: number // 分
  outputUnitPrice?: number // 元，向后兼容
  inputCostCents?: number // 分
  inputCost?: number // 元，向后兼容
  outputCostCents?: number // 分
  outputCost?: number // 元，向后兼容
  resolution?: string
  duration?: number
  estimated?: boolean
  /** 是否计入账单 — 失败/取消的任务 billable=false */
  billable?: boolean
  /** 费用来源: 'actual' = provider 返回实际用量, 'estimated' = 前端预估值 */
  source?: 'actual' | 'estimated'
  /** 失败策略: 'charge' = 仍收费, 'waive' = 免除, 'partial' = 部分收费 */
  failurePolicy?: 'charge' | 'waive' | 'partial'
}

/** 文本输出 */
export interface TextOutputResult {
  type: 'text'
  text: string
}

/** 图片输出 */
export interface ImageOutputResult {
  type: 'image'
  savedUrls: string[]
  urls?: string[]
}

/** 视频输出 */
export interface VideoOutputResult {
  type: 'video'
  savedUrls: string[]
  originalUrl?: string
  /** @deprecated 使用 originalUrl。保留以兼容 DashScope 旧数据 */
  video_url?: string
}

/** 处理中状态（异步任务尚未完成） */
export interface ProcessingOutputResult {
  type: 'processing'
  taskId?: string
  status?: string
}

/** 字幕输出（ASR 转录结果） */
export interface SubtitleOutputResult {
  type: 'subtitle'
  /** 提取后的句子列表 */
  sentences: SubtitleSentence[]
  /** ASR 转录结果下载 URL（24 小时过期） */
  transcriptionUrl?: string
}

/** outputResult 的所有可能形态（可辨识联合，通过 type 字段区分） */
export type OutputResult
  = | TextOutputResult
    | ImageOutputResult
    | VideoOutputResult
    | ProcessingOutputResult
    | SubtitleOutputResult

/**
 * Worker → PostgreSQL NOTIFY 的负载
 *
 * Worker 在更新 DB 后通过 pgClient.notify() 发送，
 * Server 端通过 LISTEN 接收并映射为 SSE 事件推送到前端。
 *
 * status / category 使用字符串字面量而非 pgEnum 推断类型，
 * 因为 domain-types.ts 不依赖 schema 层。
 */
export interface GenerationNotifyPayload {
  accountId: string
  recordId: string
  status: 'pending' | 'submitting' | 'processing' | 'saving_output' | 'succeeded' | 'failed' | 'cancelled'
  category: 'text' | 'image' | 'video' | 'subtitle'
  model: string
  /** 异步任务 ID（可为 null：未提交到 provider 的任务如用户取消 pending 状态） */
  taskId: string | null
  traceId?: string | null
  outputResult?: OutputResult
  errorMessage?: string
  cost?: CostDetail
  /** Canvas pipeline 元数据（仅当 source === 'canvas' 时存在） */
  canvasMeta?: {
    projectId: string
    shotId: string
    /** 当本次 shot 更新让视频阶段进入终态时携带最新项目状态 */
    projectStatus?: 'completed' | 'partial_failed'
  }
}

// ===== Notification Domain Types =====

/**
 * 通知定位元数据 — 携带结构化引用，供前端「点击定位」跳转到对应资源。
 *
 * 存储在 notifications.meta JSONB 列。不同通知类型携带不同字段：
 *   - task_completed / task_failed：
 *       - recordId + category（定位到工作台记录）
 *       - 如果来自 Canvas 链路：projectId + shotId（直接定位到 Canvas 镜头节点）
 *       - assetId 可选二级定位（v2 镜头资产锚点用）
 *   - canvas_completed：projectId（定位到画布项目）
 *   - balance_warning：category 可选（定位到计费页）
 */
export interface NotificationMeta {
  /** Canvas 项目 id — 点击定位到 /canvas/:projectId */
  projectId?: string
  /** 生成记录 id — 点击定位到工作台对应记录 */
  recordId?: string
  /** Canvas 镜头 id — 与 projectId 一起定位到 /canvas/:projectId?focus=shot:<shotId> */
  shotId?: string
  /** Canvas 资产 id（镜头视频等）— 可选二级定位（v2 用） */
  assetId?: string
  /** 生成类别，辅助前端选择定位目标与图标 */
  category?: 'text' | 'image' | 'video' | 'subtitle'
  /** API Key id — api_key_quota / api_key_expired 定位到 /api-keys */
  keyId?: string
  /** 模型 id — provider_anomaly 等系统风险定位辅助 */
  model?: string
  /** API Key 额度使用比例（0-1+）— api_key_quota 展示用 */
  percent?: number
}

// ===== Subtitle Domain Types =====

/**
 * 字幕句子 — ASR 转录后的最小编辑单元
 *
 * 从 Paraformer-v2 的 sentences[] 直接映射，
 * 用户可在编辑器中合并、拆分、修改文字和时间戳。
 */
export interface SubtitleSentence {
  /** 前端生成的唯一 ID（crypto.randomUUID 或 nanoid） */
  id: string
  /** 句子文本 */
  text: string
  /** 开始时间（毫秒） */
  beginTime: number
  /** 结束时间（毫秒） */
  endTime: number
  /** 说话人 ID（仅当 ASR 启用 diarization 时存在） */
  speakerId?: number
}

/**
 * 字幕样式配置 — 预设模板 + 微调参数
 *
 * 用户从预设模板中选择基础风格，然后可微调字号、颜色、位置等。
 * 导出时转换为 ASS 格式参数。
 */
export interface SubtitleStyleConfig {
  /** 预设模板 ID（如 'cinema', 'anime', 'variety' 等） */
  templateId: string
  /** 字号 */
  fontSize: number
  /** 字体颜色（HEX） */
  fontColor: string
  /** 描边颜色（HEX） */
  outlineColor: string
  /** 描边宽度（像素） */
  outlineWidth: number
  /** 垂直位置 */
  position: 'top' | 'center' | 'bottom'
  /** 垂直边距（像素） */
  marginV: number
  /** 是否加粗 */
  bold: boolean
}

// ===== Audit Detail DTOs =====
// 审计日志 detail payload 的结构化类型 — 不同 action 有不同 detail 形状
// 用于 DB schema $type<AuditDetail>() 和 server audit() helper 类型约束

export interface CanvasPhaseDetail {
  phase: string
  projectId: string
  runId: string
  autoProgress?: boolean
  taskId?: string
}

export interface CanvasProjectCreateDetail {
  projectId: string
  title?: string
}

export interface CanvasProjectDeleteDetail {
  projectId: string
}

export interface CanvasCancelDetail {
  projectId: string
  cancelledRuns: number
  phases: string[]
}

export interface CanvasAssetRegenerateDetail {
  entityType: 'character' | 'location' | 'shot'
  entityId: string
  projectId?: string
}

export interface GatewayCallDetail {
  model: string
  recordId: string
  inputTokens?: number
  outputTokens?: number
  totalPriceCents?: number
  status: 'succeeded' | 'failed'
  error?: string
}

export interface CreditFlowDetail {
  accountId: string
  generationRecordId: string
  amountCents: number
  description: string
  source: 'generate' | 'retry' | 'gateway' | 'worker_video'
}

export interface GenerationRetryDetail {
  recordId: string
  model: string
  previousStatus: string
}

export interface GenerationCancelDetail {
  recordId: string
  previousStatus: string
}

/** 所有 detail 类型的 union — schema $type<T>() 使用，保留 Record<string, unknown> 兼容 legacy action */
export type AuditDetail
  = | CanvasPhaseDetail
    | CanvasProjectCreateDetail
    | CanvasProjectDeleteDetail
    | CanvasCancelDetail
    | CanvasAssetRegenerateDetail
    | GatewayCallDetail
    | CreditFlowDetail
    | GenerationRetryDetail
    | GenerationCancelDetail
    | ProviderHealthDetail
    | Record<string, unknown>

// ===== Provider Model Health Domain Types =====

/**
 * Provider 模型健康状态 — 断路器降级策略的状态机值。
 *
 * healthy：模型可用，新任务正常派发。
 * degraded：模型连续失败达到阈值，进入冷却窗口，新任务在窗口内快速失败。
 *
 * 注意：`status` 是「最后一次设置」的快照值；是否真正阻断调用由
 * `isDegraded(record, now)`（status==='degraded' 且仍在 degradedUntil 之前）判定，
 * 冷却窗口过期后即使列值仍为 degraded 也视为半开（half-open）可探测。
 */
export type ProviderModelHealthStatus = 'healthy' | 'degraded'

/**
 * Provider 模型健康记录 — 跨进程（server + worker）共享的降级状态。
 *
 * 时间字段统一使用 epoch 毫秒（与 pure policy 的 `now: number` 对齐），
 * DB 层在 timestamptz 与 number 之间转换。`provider_model_health` 表按 model 唯一。
 */
export interface ProviderModelHealth {
  model: string
  status: ProviderModelHealthStatus
  /** 连续失败次数；任一成功清零 */
  consecutiveFailures: number
  /** 累计失败次数（只增，用于 admin 诊断） */
  totalFailures: number
  /** 累计成功次数（只增） */
  totalSuccesses: number
  /** 降级冷却截止 epoch ms；status!=='degraded' 时为 null */
  degradedUntil: number | null
  lastFailureAt: number | null
  lastSuccessAt: number | null
  /** 最近一次失败的错误摘要（observer 上报） */
  lastErrorMessage: string | null
  /** 触发降级的原因摘要 */
  degradedReason: string | null
  updatedAt: number
}

/** 管理员恢复模型健康 / 模型自动降级时的审计 detail */
export interface ProviderHealthDetail {
  model: string
  action: 'degrade' | 'restore'
  /** 恢复操作来源：admin 手动 / outcome 自动（仅 restore 记录 manual） */
  source?: 'manual' | 'auto'
  reason?: string
  previousStatus?: ProviderModelHealthStatus
}

/** 对话层结构化数据（Phase 8.5 dialogue 生成） */
export interface DialogueLine {
  speaker: string
  text: string
  emotion: string
  volume: string
}

export interface DialogueSoundEffect {
  type: string
  description: string
}

export interface DialogueJson {
  lines: DialogueLine[]
  soundEffects: DialogueSoundEffect[]
  ambientSound: string
}

/**
 * R2V 参考媒体条目 — buildR2VRequest 预算组装结果，存 canvas_shots.reference_media
 *
 * buildR2VRequest 把镜头的参考图按「主要角色 turnaround → 次要角色 portrait →
 * 关键场景 → 预留额外」优先级排序，裁剪到 DashScope R2V 上限（9 张）。
 * imageNumber 对应 R2V prompt 中的 [Image N] 指代（1-based，数组顺序）。
 */
export interface R2VReferenceMedia {
  url: string
  /** 参考类型：turnaround（主要角色三视图）/ portrait（次要角色）/ scene（场景）/ extra（预留） */
  kind: 'turnaround' | 'portrait' | 'scene' | 'extra'
  /** 对应角色 ID（kind=turnaround/portrait 时） */
  characterId?: string
  /** 对应场景 ID（kind=scene 时） */
  locationId?: string
  /** 在 R2V media[] 中的 1-based 序号，对应 prompt 的 [Image N] */
  imageNumber: number
}
