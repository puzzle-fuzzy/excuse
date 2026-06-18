import type { AcceptedResponse, CanvasCharacterResponse, CanvasLocationResponse, CanvasMutationOkResponse, CanvasShotResponse } from '@excuse/shared'
import { api, unwrapEden } from './client'

// ===== 实体 CRUD =====

export async function updateCanvasCharacter(characterId: string, patch: {
  name?: string
  role?: string
  description?: string
  identityPrompt?: string
  negativePrompt?: string
  referenceImageUrl?: string
  turnaroundSheetUrl?: string
  locked?: boolean
}): Promise<CanvasCharacterResponse> {
  return unwrapEden<CanvasCharacterResponse>(
    await api.api.canvas.characters({ characterId }).patch(patch),
  )
}

export async function updateCanvasLocation(locationId: string, patch: {
  name?: string
  type?: string
  scenePrompt?: string
  negativePrompt?: string
  referenceImageUrl?: string
  locked?: boolean
}): Promise<CanvasLocationResponse> {
  return unwrapEden<CanvasLocationResponse>(
    await api.api.canvas.locations({ locationId }).patch(patch),
  )
}

export async function updateCanvasShot(shotId: string, patch: {
  duration?: number
  locationId?: string
  characterIdsJson?: string[]
  narrative?: string
  cameraJson?: { shotSize: string, angle: string, movement: string, lens: string }
  environmentJson?: { backgroundMotion?: string, lighting?: string, mood?: string, style?: string }
  videoPrompt?: string
  referenceAssetsJson?: Array<{ assetId: string, url: string, role: 'character' | 'location' | 'style' | 'firstFrame' | 'other', label?: string, source?: 'asset_library' | 'uploaded_file' | 'manual' }>
}): Promise<CanvasShotResponse> {
  return unwrapEden<CanvasShotResponse>(
    await api.api.canvas.shots({ shotId }).patch(patch),
  )
}

export async function deleteCanvasCharacter(characterId: string): Promise<CanvasMutationOkResponse> {
  return unwrapEden<CanvasMutationOkResponse>(
    await api.api.canvas.characters({ characterId }).delete(),
  )
}

export async function deleteCanvasLocation(locationId: string): Promise<CanvasMutationOkResponse> {
  return unwrapEden<CanvasMutationOkResponse>(
    await api.api.canvas.locations({ locationId }).delete(),
  )
}

export async function deleteCanvasShot(shotId: string): Promise<CanvasMutationOkResponse> {
  return unwrapEden<CanvasMutationOkResponse>(
    await api.api.canvas.shots({ shotId }).delete(),
  )
}

// ===== Retry + Cancel =====

export async function retryCanvasShot(shotId: string): Promise<AcceptedResponse> {
  return unwrapEden<AcceptedResponse>(
    await api.api.canvas.shots({ shotId }).retry.post(),
  )
}

export async function retryFailedCanvasShots(projectId: string): Promise<AcceptedResponse> {
  return unwrapEden<AcceptedResponse>(
    await api.api.canvas.projects({ projectId })['retry-failed-shots'].post(),
  )
}

/** 终止当前活跃阶段 — 取消 pipeline run + 关联 task + 活跃 canvas_assets */
export async function cancelCanvasActivePhase(projectId: string): Promise<{ cancelled: number, message: string }> {
  return unwrapEden<{ cancelled: number, message: string }>(
    await api.api.canvas.projects({ projectId })['cancel-active'].post(),
  )
}

// ===== 单个实体重新生成 =====

export async function regenerateCanvasCharacter(characterId: string): Promise<AcceptedResponse> {
  return unwrapEden<AcceptedResponse>(
    await api.api.canvas.characters({ characterId }).regenerate.post(),
  )
}

export async function regenerateCanvasLocation(locationId: string): Promise<AcceptedResponse> {
  return unwrapEden<AcceptedResponse>(
    await api.api.canvas.locations({ locationId }).regenerate.post(),
  )
}

export async function regenerateCanvasShot(shotId: string): Promise<AcceptedResponse> {
  return unwrapEden<AcceptedResponse>(
    await api.api.canvas.shots({ shotId }).regenerate.post(),
  )
}

// ===== 批量应用参考资产 =====

export interface ApplyShotReferenceAssetsResponse {
  success: boolean
  applied: Array<{
    shotId: string
    beforeCount: number
    afterCount: number
    addedCount: number
    truncatedCount: number
  }>
}

export async function applyShotReferenceAssets(
  projectId: string,
  params: {
    sourceShotId?: string
    targetShotIds: string[]
    referenceAssetsJson: Array<{ assetId: string, url: string, role: 'character' | 'location' | 'style' | 'firstFrame' | 'other', label?: string, source?: 'asset_library' | 'uploaded_file' | 'manual' }>
    mode: 'append' | 'replace'
  },
): Promise<ApplyShotReferenceAssetsResponse> {
  return unwrapEden<ApplyShotReferenceAssetsResponse>(
    await api.api.canvas.projects({ projectId }).shots['reference-assets'].apply.post(params),
  )
}
