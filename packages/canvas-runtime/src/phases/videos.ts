import type { DashScopeClient } from '@excuse/provider'
import type { CanvasProjectDetail } from '../normalize'
import { getCanvasVideoModel, submitCanvasShotVideo } from '..'

type ShotRow = CanvasProjectDetail['shots'][number]
type CharacterRow = CanvasProjectDetail['characters'][number]
type LocationRow = CanvasProjectDetail['locations'][number]

/** URL 去重，保持首次出现顺序 */
function dedupe(urls: string[]): string[] {
  const seen = new Set<string>()
  return urls.filter((url) => {
    if (seen.has(url))
      return false
    seen.add(url)
    return true
  })
}

/**
 * 镜头视频提交核心（per-entity, async submit）：referenceUrls 解析 → model 重定后缀 → submit。
 * Host 保留 per-shot 循环、skip-guards（!videoPrompt）、资产行 createCanvasAsset / markRunning / markFailed、
 * per-shot try/catch + updateCanvasShot(failed) + notifyNode。
 *
 * asset-row 的 model 由 host 用 getVideoModel(prefs, []) 决定（始终 t2v），core 用 referenceUrls
 * 重解析出 -r2v/-t2v 后缀的 model 做 submitCanvasShotVideo。这一差异与原 server/worker 行为一致。
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
  client: DashScopeClient
  estimatedCost?: boolean
}

export interface ShotVideoEntityResult {
  taskId: string
  model: string
  referenceUrls: string[]
}

export async function submitShotVideoEntity(input: ShotVideoEntityInput): Promise<ShotVideoEntityResult> {
  const characterMap = new Map(input.characters.map(c => [c.id, c]))
  const locationMap = new Map(input.locations.map(l => [l.id, l]))

  const characterReferenceUrls = input.shot.characterIdsJson
    .map(id => characterMap.get(id)?.referenceImageUrl)
    .filter((url): url is string => Boolean(url))
  const locationReferenceUrl = input.shot.locationId
    ? locationMap.get(input.shot.locationId)?.referenceImageUrl ?? null
    : null
  /** 镜头额外参考资产 URL（角色/场景在前，用户额外引用在后，去重） */
  const extraReferenceUrls = input.shot.referenceAssetsJson
    ?.map(asset => asset.url)
    .filter((url): url is string => Boolean(url)) ?? []
  const referenceUrls = dedupe([...characterReferenceUrls, ...(locationReferenceUrl ? [locationReferenceUrl] : []), ...extraReferenceUrls])
  const model = getCanvasVideoModel(input.modelPreferences, referenceUrls)

  const { taskId } = await submitCanvasShotVideo({
    accountId: input.accountId,
    projectId: input.projectId,
    shotId: input.shotId,
    assetId: input.assetId,
    model,
    videoPrompt: input.shot.videoPrompt!,
    negativePrompt: input.shot.negativePrompt,
    duration: input.shot.duration,
    referenceUrls,
    client: input.client,
    estimatedCost: input.estimatedCost,
  })

  return { taskId, model, referenceUrls }
}
