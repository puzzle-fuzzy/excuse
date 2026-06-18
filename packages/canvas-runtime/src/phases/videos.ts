import type { CanvasRuntimeLlmClient, CanvasRuntimeProviderAdapter, CanvasRuntimeRepoAdapter } from '../adapter-types'
import type { CanvasProjectDetail } from '../normalize'
import { recommendCanvasVideoModel, resolveShotVideoReferences, submitCanvasShotVideo } from '..'

type ShotRow = CanvasProjectDetail['shots'][number]
type CharacterRow = CanvasProjectDetail['characters'][number]
type LocationRow = CanvasProjectDetail['locations'][number]

/**
 * 镜头视频提交核心（per-entity, async submit）：resolveShotVideoReferences → recommendCanvasVideoModel → submit。
 * Host 保留 per-shot 循环、skip-guards（!videoPrompt）、资产行 createCanvasAsset / markRunning / markFailed、
 * per-shot try/catch + updateCanvasShot(failed) + notifyNode。
 *
 * asset-row 的 model 由 host 用 getVideoModel(prefs, []) 决定（始终 t2v），
 * core 用 recommendCanvasVideoModel 解析带 role 的引用做变体推荐。
 */
export interface ShotVideoEntityInput {
  projectId: string
  accountId: string
  shotId: string
  assetId: string
  shot: ShotRow
  characters: CharacterRow[]
  locations: LocationRow[]
  modelPreferences: { videoModel?: string | null } | null | undefined
  client: CanvasRuntimeLlmClient
  provider: CanvasRuntimeProviderAdapter
  repo: CanvasRuntimeRepoAdapter
  estimatedCost?: boolean
  diagnostics?: {
    workerTaskId?: string
    pipelineRunId?: string
    canvasAssetId?: string
  }
}

export interface ShotVideoEntityResult {
  taskId: string
  model: string
  referenceUrls: string[]
  /** 推荐原因（中文），可供日志或 UI 使用 */
  recommendationReason: string
}

export async function submitShotVideoEntity(input: ShotVideoEntityInput): Promise<ShotVideoEntityResult> {
  const references = resolveShotVideoReferences({
    shot: input.shot,
    characters: input.characters,
    locations: input.locations,
  })
  const recommendation = recommendCanvasVideoModel(input.modelPreferences, references, input.provider)
  // R2V 优先复用 dialogue 产出的预算参考媒体（≤9，按说话者优先排序，存 shot.reference_media）；
  // dialogue 未产出时回退到全量解析引用。T2V 不带参考图。
  const referenceUrls = recommendation.variant === 'r2v' && input.shot.referenceMedia && input.shot.referenceMedia.length > 0
    ? input.shot.referenceMedia.map(m => m.url)
    : references.map(r => r.url)

  const { taskId } = await submitCanvasShotVideo({
    accountId: input.accountId,
    projectId: input.projectId,
    shotId: input.shotId,
    assetId: input.assetId,
    model: recommendation.model,
    videoPrompt: input.shot.videoPrompt!,
    negativePrompt: input.shot.negativePrompt,
    duration: input.shot.duration,
    referenceUrls,
    client: input.client,
    estimatedCost: input.estimatedCost,
    diagnostics: input.diagnostics,
    repo: input.repo,
    provider: input.provider,
  })

  return { taskId, model: recommendation.model, referenceUrls, recommendationReason: recommendation.reason }
}
