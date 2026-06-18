import type { RecoveryClassification } from '@excuse/error-recovery'
import type { ListResponse, MutationOkResponse, RecordResponse } from './api-response'
import type {
  CostDetail,
  GenerationInputParams,
  GenerationNotifyPayload,
  ImageOutputResult,
  OutputResult,
  ProcessingOutputResult,
  SubtitleOutputResult,
  TextOutputResult,
  VideoOutputResult,
} from './domain-types'

// 重导出域类型，保持下游 import 不变
export type { CostDetail, GenerationInputParams, GenerationNotifyPayload }
export type { ImageOutputResult, OutputResult, ProcessingOutputResult, SubtitleOutputResult, TextOutputResult, VideoOutputResult }

export type GenerationCategory = 'text' | 'image' | 'video' | 'subtitle'

export type GenerationStatus
  = | 'pending'
    | 'submitting'
    | 'processing'
    | 'saving_output'
    | 'succeeded'
    | 'failed'
    | 'cancelled'

/**
 * 进行中的 generation status（非终态）—— 用于去重检查、取消活跃记录等场景。
 *
 * 之前散落在 generation/service、generation-records.repo、assets/service 各自定义，
 * 成员重叠。现在单一来源，消费者直接 import。
 */
export const ACTIVE_GENERATION_STATUSES = ['pending', 'submitting', 'processing', 'saving_output'] as const

/**
 * Provider 侧正在执行的 generation status（不含 pending 排队态）。
 */
export const GEN_RUNNING_STATUSES: readonly GenerationStatus[] = ['submitting', 'processing', 'saving_output']

// ===== SSE → GenerationRecord 运行时解析 =====

/** 根据 type 辨识字段的类型守卫 */
export function isTextOutput(o: OutputResult | null | undefined): o is TextOutputResult {
  return o != null && o.type === 'text'
}
export function isImageOutput(o: OutputResult | null | undefined): o is ImageOutputResult {
  return o != null && o.type === 'image'
}
export function isVideoOutput(o: OutputResult | null | undefined): o is VideoOutputResult {
  return o != null && o.type === 'video'
}
export function isProcessingOutput(o: OutputResult | null | undefined): o is ProcessingOutputResult {
  return o != null && o.type === 'processing'
}
export function isSubtitleOutput(o: OutputResult | null | undefined): o is SubtitleOutputResult {
  return o != null && o.type === 'subtitle'
}

// ===== SSE → GenerationRecord 运行时解析 =====

/** 将 SSE 端的 Record<string, unknown> 解析为 OutputResult discriminated union */
export function parseOutputResult(data: unknown): OutputResult | null {
  if (data == null || typeof data !== 'object')
    return null
  const o = data as Record<string, unknown>

  // 已有 type 辨识字段（新版）
  if ('type' in o && typeof o.type === 'string') {
    switch (o.type) {
      case 'text':
        return { type: 'text', text: typeof o.text === 'string' ? o.text : '' }
      case 'image':
        return { type: 'image', savedUrls: Array.isArray(o.savedUrls) ? o.savedUrls as string[] : [], urls: Array.isArray(o.urls) ? o.urls as string[] : undefined }
      case 'video':
        return { type: 'video', savedUrls: Array.isArray(o.savedUrls) ? o.savedUrls as string[] : [], originalUrl: typeof o.originalUrl === 'string' ? o.originalUrl : undefined, video_url: typeof o.video_url === 'string' ? o.video_url : undefined }
      case 'processing':
        return { type: 'processing', taskId: typeof o.taskId === 'string' ? o.taskId : undefined, status: typeof o.status === 'string' ? o.status : undefined }
      case 'subtitle':
        return { type: 'subtitle', sentences: Array.isArray(o.sentences) ? o.sentences as SubtitleOutputResult['sentences'] : [], transcriptionUrl: typeof o.transcriptionUrl === 'string' ? o.transcriptionUrl : undefined }
      default:
        break
    }
  }

  // 兼容旧数据（无 type 字段）
  if ('text' in o && typeof o.text === 'string')
    return { type: 'text', text: o.text } satisfies TextOutputResult
  if ('savedUrls' in o && Array.isArray(o.savedUrls)) {
    if ('originalUrl' in o || 'video_url' in o)
      return { type: 'video', savedUrls: o.savedUrls as string[], originalUrl: typeof o.originalUrl === 'string' ? o.originalUrl : undefined, video_url: typeof o.video_url === 'string' ? o.video_url : undefined } satisfies VideoOutputResult
    return { type: 'image', savedUrls: o.savedUrls as string[], urls: Array.isArray(o.urls) ? o.urls as string[] : undefined } satisfies ImageOutputResult
  }
  if ('taskId' in o || 'status' in o)
    return { type: 'processing', taskId: typeof o.taskId === 'string' ? o.taskId : undefined, status: typeof o.status === 'string' ? o.status : undefined } satisfies ProcessingOutputResult
  return null
}

/** 将 SSE 端的 Record<string, unknown> 解析为 CostDetail */
export function parseCostDetail(data: unknown): CostDetail | null {
  if (data == null || typeof data !== 'object')
    return null
  const o = data as Record<string, unknown>
  if ('unit' in o && ('totalPrice' in o || 'totalPriceCents' in o)) {
    const totalPriceCents = typeof o.totalPriceCents === 'number' ? o.totalPriceCents : 0
    const totalPrice = typeof o.totalPrice === 'number' ? o.totalPrice : totalPriceCents / 100
    return {
      unit: (['token', 'image', 'video', 'audio'].includes(o.unit as string) ? o.unit : 'token') as CostDetail['unit'],
      totalPriceCents,
      totalPrice,
      quantity: typeof o.quantity === 'number' ? o.quantity : undefined,
      unitPriceCents: typeof o.unitPriceCents === 'number' ? o.unitPriceCents : undefined,
      unitPrice: typeof o.unitPrice === 'number' ? o.unitPrice : undefined,
      inputTokens: typeof o.inputTokens === 'number' ? o.inputTokens : undefined,
      outputTokens: typeof o.outputTokens === 'number' ? o.outputTokens : undefined,
      inputUnitPriceCents: typeof o.inputUnitPriceCents === 'number' ? o.inputUnitPriceCents : undefined,
      inputUnitPrice: typeof o.inputUnitPrice === 'number' ? o.inputUnitPrice : undefined,
      outputUnitPriceCents: typeof o.outputUnitPriceCents === 'number' ? o.outputUnitPriceCents : undefined,
      outputUnitPrice: typeof o.outputUnitPrice === 'number' ? o.outputUnitPrice : undefined,
      inputCostCents: typeof o.inputCostCents === 'number' ? o.inputCostCents : undefined,
      inputCost: typeof o.inputCost === 'number' ? o.inputCost : undefined,
      outputCostCents: typeof o.outputCostCents === 'number' ? o.outputCostCents : undefined,
      outputCost: typeof o.outputCost === 'number' ? o.outputCost : undefined,
      resolution: typeof o.resolution === 'string' ? o.resolution : undefined,
      duration: typeof o.duration === 'number' ? o.duration : undefined,
      estimated: typeof o.estimated === 'boolean' ? o.estimated : undefined,
    }
  }
  return null
}

export interface GenerationRecord {
  id: string
  accountId: string
  taskId: string | null
  model: string
  category: GenerationCategory
  status: GenerationStatus
  inputParams: GenerationInputParams
  outputResult: OutputResult | null
  cost: CostDetail | null
  totalPriceCents: number | null
  errorMessage: string | null
  /** 失败/取消时的恢复分类（succeeded/进行中 为 null） */
  recovery: RecoveryClassification | null
  retryCount: number
  traceId: string | null
  dedupeKey: string | null
  hiddenAt: string | null
  cancelRequestedAt: string | null
  providerCancelStatus: 'not_requested' | 'no_task' | 'requested' | 'succeeded' | 'failed'
  createdAt: string
  updatedAt: string
}

// ===== 请求/响应类型 =====

export interface GenerateRequest {
  model: string
  parameters: Record<string, unknown>
  referenceFileIds?: string[]
}

export interface GenerationRecordSuccessResponse extends RecordResponse<GenerationRecord> {
  duplicated?: true
}

export interface GenerationRecordFailedResponse {
  success: false
  record: GenerationRecord
}

export type GenerateResponse = GenerationRecordSuccessResponse | GenerationRecordFailedResponse

export type GenerationRecordResponse = RecordResponse<GenerationRecord>

export type GenerationRecordListResponse = ListResponse<GenerationRecord>

export type DeleteGenerationRecordResponse = MutationOkResponse
