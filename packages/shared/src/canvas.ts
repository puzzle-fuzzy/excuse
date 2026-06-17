import type { EntityResponse, ListResponse, MutationOkResponse } from './api-response'
import type { CanvasFailureKind } from './canvas-failure'
import type {
  CanvasLayoutDto,
  CanvasLayoutEdge,
  CanvasLayoutNode,
  CanvasLayoutPosition,
  CanvasLayoutViewport,
  CanvasModelPreferences,
  CanvasShotReferenceAsset,
  CanvasShotReferenceRole,
  CharacterProfile,
  ContinuityIssue,
  LocationProfile,
  NovelAnalysis,
  ShotCamera,
  ShotContinuity,
  ShotEnvironment,
  ShotTimelineEntry,
} from './domain-types'

// 域类型从 shared domain-types 重导出，供 client/server/worker 共用。
export type { CanvasModelPreferences, CharacterProfile, ContinuityIssue, LocationProfile, NovelAnalysis }
export type { ShotCamera, ShotContinuity, ShotEnvironment, ShotTimelineEntry }
export type { CanvasLayoutEdge, CanvasLayoutNode, CanvasLayoutPosition, CanvasLayoutViewport }
export type { CanvasLayoutDto, CanvasShotReferenceAsset, CanvasShotReferenceRole }

// ===== 批量应用参考资产类型（client/server 共用） =====

/** 批量应用策略 */
export type ApplyReferenceAssetsMode = 'append' | 'replace'

/** 批量应用的目标镜头信息 */
export interface ReferenceAssetApplyTarget {
  shotId: string
  title?: string | null
  referenceAssets: CanvasShotReferenceAsset[]
}

/** 批量应用预览 — 单个镜头的预览结果 */
export interface ReferenceAssetApplyPreview {
  shotId: string
  beforeCount: number
  afterCount: number
  addedCount: number
  truncatedCount: number
  assets: CanvasShotReferenceAsset[]
}

// ===== 视频模型变体推荐（纯规则，client/server 共用） =====

/** 视频生成变体：文生视频 / 图生视频 / 参考生视频 */
export type CanvasVideoVariant = 't2v' | 'i2v' | 'r2v'

/**
 * 推荐镜头视频变体时所依据的参考引用——携带语义 role。
 *
 * role 决定变体：`firstFrame` → I2V（该图作为视频首帧）；
 * 其余图片参考（character/location/style/other）→ R2V（多主体一致性）。
 */
export interface CanvasVideoReference {
  url: string
  role: CanvasShotReferenceRole
  /**
   * 该引用图对应的角色 ID（role=character 且由角色 turnaround/portrait 自动解析而来时填充）。
   * 供 rebuild 阶段把 prompt 里的角色指代烘焙成 `[Image N]`（N = 该 ref 在数组中的 1-based 位置）。
   * 用户额外引用（referenceAssetsJson）不填。
   */
  characterId?: string
  /**
   * 该引用图对应的场景 ID（role=location 且由场景参考图自动解析而来时填充）。
   * 语义同 characterId，供 prompt 烘焙 `[Image N]`。
   */
  locationId?: string
}

/** 纯规则推荐结果：变体 + 给用户看的中文原因 */
export interface CanvasVideoVariantRecommendation {
  variant: CanvasVideoVariant
  reason: string
}

/**
 * 纯规则：根据镜头参考引用推断视频生成变体（T2V/I2V/R2V）。
 *
 * 规则（与「按参考资产数量推荐」一致，并用 role 消除单图歧义）：
 * - 存在 role=firstFrame 的参考 → I2V（用户明确指定该图为视频首帧）
 * - 否则存在任意图片参考 → R2V（角色/场景一致性）
 * - 无参考 → T2V
 *
 * 本函数不感知「所选 base 模型是否真有对应变体」；真实 model id 解析与
 * 能力降级在 `@excuse/canvas-runtime` 的 `recommendCanvasVideoModel` 中完成。
 * UI 可直接调用本函数展示推荐原因，无需依赖 provider/model-configs。
 */
export function recommendCanvasVideoVariant(
  references: ReadonlyArray<CanvasVideoReference>,
): CanvasVideoVariantRecommendation {
  const imageRefs = references.filter(ref => Boolean(ref.url))

  if (imageRefs.some(ref => ref.role === 'firstFrame')) {
    return {
      variant: 'i2v',
      reason: '检测到首帧图，使用图生视频（I2V）以该图作为视频首帧',
    }
  }

  if (imageRefs.length >= 1) {
    return {
      variant: 'r2v',
      reason: `检测到 ${imageRefs.length} 张参考图，使用参考生视频（R2V）保证多主体一致`,
    }
  }

  return {
    variant: 't2v',
    reason: '未检测到参考图，使用文生视频（T2V）',
  }
}

// ===== 镜头对话音频启发式（纯规则，client/server/worker 共用） =====

/**
 * 启发式判定 narrative 是否含可触发 HappyHorse 原生对话音频的对白内容。
 *
 * 判定信号：出现成对的中文/英文引号对白标记 —— 「」『』“”（含直角引号、
 * 中英文弯引号、英文双引号）。storyboard LLM 被要求把角色对白写进 narrative
 * 并用引号包裹（如 `小明：「我不能走」`），所以引号是「有对白」的可靠信号。
 *
 * 纯动作/环境镜头（narrative 仅描述动作画面，无引号）判定为无声 ——
 * 前端据此显示音频指示器，视频 prompt 生成时据此决定是否编排对话音频段。
 * 刻意不匹配 `Name:` 冒号形式，避免时间戳（如 `5s:`）和叙事冒号误判。
 */
export function hasDialogueAudio(narrative: string | null | undefined): boolean {
  if (!narrative || typeof narrative !== 'string')
    return false

  // 中文/英文成对引号任一出现即视为含对白。
  return /["“”‘’「」『』]/u.test(narrative)
}

export type CanvasPipelinePhase
  = | 'analyze'
    | 'characters'
    | 'locations'
    | 'characterRefs'
    | 'locationRefs'
    | 'storyboard'
    | 'continuity'
    | 'rebuild'
    | 'videos'

export type CanvasPipelineRunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface CanvasPipelineRunDTO {
  id: string
  projectId: string
  phase: CanvasPipelinePhase
  status: CanvasPipelineRunStatus
  startedAt: string | null
  finishedAt: string | null
  errorMessage: string | null
  createdBy: string | null
  inputSnapshotJson: Record<string, unknown> | null
  outputSummaryJson: Record<string, unknown> | null
  taskId: string | null
  createdAt: string
}

// ===== 画布状态类型（从 DB pgEnum 推导，消除重复定义） =====

export type CanvasProjectStatus
  = | 'draft'
    | 'analyzed'
    | 'characters_ready'
    | 'locations_ready'
    | 'refs_ready'
    | 'refs_all_ready'
    | 'storyboard_ready'
    | 'continuity_checked'
    | 'prompts_ready'
    | 'generating'
    | 'completed'
    | 'partial_failed'
    | 'failed'

export type CanvasShotStatus = 'draft' | 'ready' | 'generating' | 'completed' | 'failed'

// ===== LLM 输出类型 =====
// NovelAnalysis / CharacterProfile / LocationProfile / ContinuityIssue 已从 shared domain-types 重导出

/** 分镜草稿（LLM 输出） */
export interface ShotDraft {
  shotIndex: number
  duration: number
  locationId: string | null
  characterIds: string[]
  narrative: string
  camera: ShotCamera
  continuity: ShotContinuity
  timeline?: ShotTimelineEntry[]
  environment?: ShotEnvironment
}

// ===== SSE 事件 =====

/** 流水线节点 SSE 事件 */
export interface SSEPipelineNodeEvent {
  projectId: string
  nodeType: string
  nodeId: string
  status: 'running' | 'completed' | 'failed'
  runId?: string
  /** SSE 管道节点不透明数据 — 存储边界：不同 nodeType 产生不同 data 形状，backend 不解读 */
  data?: Record<string, unknown>
  error?: string
}

/** fire-and-forget 类接口的统一受理响应 */
export interface AcceptedResponse {
  accepted: true
  runId?: string
}

// ===== 画布布局类型（前端 UI 状态，后端不解释） =====

// ===== SSE 事件 =====

export interface CharacterDTO {
  id: string
  projectId: string
  name: string
  role: string | null
  description: string | null
  profile: CharacterProfile | null
  identityPrompt: string | null
  negativePrompt: string | null
  referenceImageUrl: string | null
  turnaroundSheetUrl: string | null
  locked: boolean
  createdAt: string
  updatedAt: string
}

export interface LocationDTO {
  id: string
  projectId: string
  name: string
  type: LocationProfile['type']
  profile: LocationProfile | null
  scenePrompt: string | null
  negativePrompt: string | null
  referenceImageUrl: string | null
  locked: boolean
  createdAt: string
  updatedAt: string
}

export interface ShotDTO {
  id: string
  projectId: string
  shotIndex: number
  duration: number
  locationId: string | null
  characterIds: string[]
  narrative: string
  camera: ShotCamera
  continuity: ShotContinuity
  timeline: ShotTimelineEntry[] | null
  environment: ShotEnvironment | null
  videoPrompt: string | null
  negativePrompt: string | null
  videoTaskId: string | null
  videoUrl: string | null
  status: CanvasShotStatus
  errorMessage: string | null
  /** 镜头额外参考资产列表 — 生成/重试时合并进 referenceUrls */
  referenceAssets: CanvasShotReferenceAsset[]
  createdAt: string
  updatedAt: string
}

export interface ProjectDTO {
  id: string
  accountId: string
  title: string | null
  storyText: string
  status: CanvasProjectStatus
  analysis: NovelAnalysis | null
  modelPreferences: CanvasModelPreferences | null
  characters: CharacterDTO[]
  locations: LocationDTO[]
  shots: ShotDTO[]
  continuityIssues: ContinuityIssue[]
  canvasLayout: CanvasLayoutDto | null
  createdAt: string
  updatedAt: string
}

export type CanvasProjectResponse = EntityResponse<ProjectDTO>

export type CanvasProjectListResponse = ListResponse<ProjectDTO>

export type CanvasPipelineRunResponse = EntityResponse<CanvasPipelineRunDTO>

export type CanvasPipelineRunListResponse = ListResponse<CanvasPipelineRunDTO>

export type CanvasCharacterResponse = EntityResponse<CharacterDTO>

export type CanvasLocationResponse = EntityResponse<LocationDTO>

export type CanvasShotResponse = EntityResponse<ShotDTO>

export type CanvasMutationOkResponse = MutationOkResponse

// ===== 资产轮询类型 =====

/** Canvas 资产轮询响应 — 项目资产和任务状态的一次性快照 */
export interface CanvasAssetsPoll {
  scope: 'canvas'
  projectId: string
  projectStatus: CanvasProjectStatus

  /** 角色 — 当前参考图和活跃生成任务 */
  characters: Array<{
    characterId: string
    name: string
    referenceImageUrl: string | null
    turnaroundSheetUrl: string | null
    /** 当前活跃的图片生成 canvas_asset ID（从 canvas_assets 表中 queued/running 状态匹配） */
    activeImageTaskIds: string[]
  }>

  /** 场景 — 当前参考图和活跃生成任务 */
  locations: Array<{
    locationId: string
    name: string
    referenceImageUrl: string | null
    /** 当前活跃的图片生成 canvas_asset ID（从 canvas_assets 表中 queued/running 状态匹配） */
    activeImageTaskIds: string[]
  }>

  /** 镜头 — 当前视频 URL 和活跃生成任务 */
  shots: Array<{
    shotId: string
    shotIndex: number
    status: CanvasShotStatus
    videoUrl: string | null
    /** 当前活跃的视频生成任务 ID（从 generation_records 中 status 非终态匹配 shotId） */
    activeVideoTaskIds: string[]
  }>

  /** 项目下所有活跃（非终态）的生成任务（来自 generation_records + canvas_assets） */
  activeTasks: Array<{
    id: string
    category: 'text' | 'image' | 'video'
    status: string
    /** 任务目标实体 ID */
    targetId: string
    /** 任务目标实体类型 */
    targetType: 'character' | 'location' | 'shot' | 'project'
    /** 失败时的错误信息（重试中的任务可能携带上一次失败原因） */
    errorMessage?: string | null
    /** 重试次数（仅 generation_records 有此字段；canvas_assets 为 null） */
    retryCount?: number | null
    /** 任务最后更新时间（epoch ms），用于任务队列面板展示 */
    updatedAt?: number | null
  }>

  /**
   * 项目下最近的失败任务（failed/cancelled 状态）
   * — 用于任务队列面板的失败原因与下一步建议展示
   * 来自 generation_records + canvas_assets 的终态记录，按 updatedAt 倒序，限制 20 条
   */
  recentFailures: Array<{
    id: string
    category: 'text' | 'image' | 'video'
    status: string
    targetId: string
    targetType: 'character' | 'location' | 'shot' | 'project'
    errorMessage: string | null
    retryCount: number
    /** 分类后的失败类型（balance/content/network/storage/cancel/provider/system） */
    failureKind: CanvasFailureKind
    /** 下一步建议 */
    suggestion: string
    /** 失败时间（epoch ms） */
    failedAt: number | null
  }>

  /** 项目下所有生成记录的成本快照（来自 generation_records + canvas_assets） */
  costs: Array<{
    recordId: string
    category: 'text' | 'image' | 'video'
    /** cost state: active(进行中) | completed(已成功) | failed(已失败/取消) */
    state: 'active' | 'completed' | 'failed'
    estimatedCostCents: number | null
    finalCostCents: number | null
  }>

  /**
   * 成本聚合 rollup（P2-1 成本可见）。
   * 注意：当前 beta 期间 Canvas 暂不对用户计费，此处的成本仅作「预估/已结算」展示，
   * 不进入 credit reserve/debit/refund 体系，前端必须标注「暂未计费」避免误导。
   */
  costSummary: CanvasCostSummary

  /** 服务器生成此快照的时间戳（epoch ms），前端判断数据新鲜度 */
  generatedAt: number
}

/**
 * Canvas 成本聚合阶段维度。
 * 镜像 DB 的 `CanvasPipelinePhase` enum（权威源），用于成本按阶段分组展示。
 * 此处不直接 import db 类型以避免 shared ← db 反向依赖。
 */
export type CanvasCostPhase
  = | 'analyze'
    | 'characters'
    | 'locations'
    | 'characterRefs'
    | 'locationRefs'
    | 'storyboard'
    | 'continuity'
    | 'rebuild'
    | 'videos'

/** 单个阶段的成本聚合条目（cents） */
export interface CanvasCostPhaseEntry {
  /** 进行中任务预估成本 */
  estimatedCents: number
  /** 已成功任务结算成本 */
  finalCents: number
  /** 失败/取消任务消耗成本 */
  failedCents: number
  /** 该阶段的成本记录条数 */
  count: number
}

/** Canvas 项目级成本 rollup（P2-1） */
export interface CanvasCostSummary {
  /** 进行中任务的预估成本总和（cents） */
  totalEstimatedCents: number
  /** 已成功任务的结算成本总和（cents） */
  totalFinalCents: number
  /** 失败/取消任务消耗的成本总和（cents） */
  totalFailedCents: number
  /** 按阶段拆分（仅包含有成本记录的阶段） */
  byPhase: Partial<Record<CanvasCostPhase, CanvasCostPhaseEntry>>
}

export type CanvasAssetsPollResponse = EntityResponse<CanvasAssetsPoll>
