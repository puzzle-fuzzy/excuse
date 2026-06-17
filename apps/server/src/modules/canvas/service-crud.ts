import type { CanvasShotReferenceAsset, ShotCamera, ShotEnvironment } from '@excuse/db'
import type { CanvasModelPreferences, CanvasProjectSummaryDTO, CharacterDTO, LocationDTO, ShotDTO } from '@excuse/shared'
import {
  batchGetProjectDetails,
  deleteCanvasCharacterById,
  deleteCanvasLocationById,
  deleteCanvasShotById,
  getCanvasCharacterById,
  getCanvasCharacterDetail,
  getCanvasLocationById,
  getCanvasLocationDetail,
  getCanvasProjectById,
  getCanvasProjectDetail,
  getCanvasProjectSummary,
  getCanvasShotDetail,
  listCanvasShotsByProject,
  softDeleteCanvasProject,
  updateCanvasCharacter,
  updateCanvasLocation,
  updateCanvasProject,
  updateCanvasShot,
} from '@excuse/db'
import { parseCanvasLayout } from './layout'
import { mapCharacter, mapLocation, mapProjectDetail, mapProjectSummary, mapShot } from './mapper'
import { reconcileProjectShots } from './service-helpers'

export interface ShotReferenceAssetApplyResult {
  shotId: string
  beforeCount: number
  afterCount: number
  addedCount: number
  truncatedCount: number
}

export async function applyShotReferenceAssets(
  projectId: string,
  targetShotIds: string[],
  referenceAssets: CanvasShotReferenceAsset[],
  mode: 'append' | 'replace',
): Promise<ShotReferenceAssetApplyResult[]> {
  const MAX = 8
  const projectShots = await listCanvasShotsByProject(projectId)
  const results: ShotReferenceAssetApplyResult[] = []

  for (const shotId of targetShotIds) {
    const shot = projectShots.find(s => s.id === shotId)
    if (!shot)
      continue

    const beforeCount = shot.referenceAssetsJson?.length ?? 0
    let newAssets: CanvasShotReferenceAsset[]

    if (mode === 'replace') {
      newAssets = referenceAssets.slice(0, MAX)
    }
    else {
      // append: merge with dedup, truncation to MAX
      const seenAssetIds = new Set<string>()
      const seenUrls = new Set<string>()
      const merged: CanvasShotReferenceAsset[] = []
      const push = (asset: CanvasShotReferenceAsset) => {
        if (merged.length >= MAX)
          return
        if (seenAssetIds.has(asset.assetId) || seenUrls.has(asset.url))
          return
        seenAssetIds.add(asset.assetId)
        seenUrls.add(asset.url)
        merged.push(asset)
      }
      const existing: CanvasShotReferenceAsset[] = shot.referenceAssetsJson ?? []
      for (const a of existing)
        push(a)
      for (const a of referenceAssets)
        push(a)
      newAssets = merged
    }

    await updateCanvasShot(shotId, { referenceAssetsJson: newAssets })

    // count total unique before truncation for truncatedCount
    let totalUnique: number
    if (mode === 'replace') {
      totalUnique = referenceAssets.length
    }
    else {
      const existing: CanvasShotReferenceAsset[] = shot.referenceAssetsJson ?? []
      const seen = new Set<string>()
      let count = 0
      for (const a of existing) {
        const key = `${a.assetId}|${a.url}`
        if (seen.has(key))
          continue
        seen.add(key)
        count++
      }
      for (const a of referenceAssets) {
        const key = `${a.assetId}|${a.url}`
        if (seen.has(key))
          continue
        seen.add(key)
        count++
      }
      totalUnique = count
    }

    const afterCount = newAssets.length
    const addedCount = mode === 'replace' ? afterCount : Math.max(0, afterCount - beforeCount)
    const truncatedCount = Math.max(0, totalUnique - MAX)

    results.push({ shotId, beforeCount, afterCount, addedCount, truncatedCount })
  }

  return results
}

export async function createProject(accountId: string, input: { title?: string, storyText: string }) {
  const { createCanvasProject } = await import('@excuse/db')
  const project = await createCanvasProject({
    accountId,
    title: input.title ?? null,
    storyText: input.storyText,
    status: 'draft',
  })
  return mapProjectDetail(project, [], [], [], null)
}

export async function updateProjectProperties(projectId: string, input: { title?: string, storyText?: string }) {
  const project = await getCanvasProjectById(projectId)
  if (!project)
    throw new Error('项目不存在')

  const values: Partial<Pick<typeof project, 'title' | 'storyText'>> = {}
  if (input.title !== undefined)
    values.title = input.title
  if (input.storyText !== undefined)
    values.storyText = input.storyText

  const updated = await updateCanvasProject(projectId, values)
  if (!updated)
    throw new Error('更新失败')

  const detail = await getCanvasProjectDetail(projectId)
  return mapProjectDetail(updated, detail?.characters ?? [], detail?.locations ?? [], detail?.shots ?? [], detail?.latestContinuity ?? null)
}

export async function getProjectDetail(projectId: string) {
  const project = await getCanvasProjectById(projectId)
  if (project && (project.status === 'generating' || project.status === 'partial_failed' || project.status === 'refs_all_ready'))
    await reconcileProjectShots(projectId)
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    return null
  return mapProjectDetail(detail.project, detail.characters, detail.locations, detail.shots, detail.latestContinuity)
}

/** 获取项目摘要（轻量版）— 主画布渲染，不包含实体大字段 */
export async function getProjectSummary(projectId: string): Promise<CanvasProjectSummaryDTO | null> {
  const project = await getCanvasProjectById(projectId)
  if (project && (project.status === 'generating' || project.status === 'partial_failed' || project.status === 'refs_all_ready'))
    await reconcileProjectShots(projectId)
  const summary = await getCanvasProjectSummary(projectId)
  if (!summary)
    return null
  return mapProjectSummary(summary.project, summary.characterSummaries, summary.locationSummaries, summary.shotSummaries, summary.latestContinuity)
}

/** 查询单个角色完整数据（按需加载到详情面板） */
export async function getCharacterDetail(characterId: string): Promise<CharacterDTO | null> {
  const row = await getCanvasCharacterDetail(characterId)
  if (!row)
    return null
  return mapCharacter(row)
}

/** 查询单个场景完整数据（按需加载到详情面板） */
export async function getLocationDetail(locationId: string): Promise<LocationDTO | null> {
  const row = await getCanvasLocationDetail(locationId)
  if (!row)
    return null
  return mapLocation(row)
}

/** 查询单个镜头完整数据（按需加载到详情面板） */
export async function getShotDetail(shotId: string): Promise<ShotDTO | null> {
  const row = await getCanvasShotDetail(shotId)
  if (!row)
    return null
  return mapShot(row)
}

export async function listProjects(accountId: string) {
  const details = await batchGetProjectDetails(accountId)
  return details.map(d => mapProjectDetail(d.project, d.characters, d.locations, d.shots, d.latestContinuity))
}

export async function softDeleteProject(projectId: string) {
  return softDeleteCanvasProject(projectId)
}

export async function saveCanvasLayout(projectId: string, layout: unknown) {
  return updateCanvasProject(projectId, { canvasLayout: parseCanvasLayout(layout) })
}

export async function updateModelPreferences(projectId: string, prefs: CanvasModelPreferences) {
  await updateCanvasProject(projectId, { modelPreferencesJson: prefs })
  const detail = await getProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')
  return detail
}

export async function updateCharacterData(characterId: string, patch: {
  name?: string
  role?: string
  description?: string
  identityPrompt?: string
  negativePrompt?: string
  referenceImageUrl?: string
  turnaroundSheetUrl?: string
  locked?: boolean
}): Promise<CharacterDTO> {
  const updated = await updateCanvasCharacter(characterId, patch)
  if (!updated)
    throw new Error('更新失败')
  return mapCharacter(updated)
}

export async function updateLocationData(locationId: string, patch: {
  name?: string
  type?: string
  scenePrompt?: string
  negativePrompt?: string
  referenceImageUrl?: string
  locked?: boolean
}): Promise<LocationDTO> {
  const updated = await updateCanvasLocation(locationId, patch)
  if (!updated)
    throw new Error('更新失败')
  return mapLocation(updated)
}

export async function updateShotData(shotId: string, patch: {
  duration?: number
  locationId?: string
  characterIdsJson?: string[]
  narrative?: string
  cameraJson?: ShotCamera
  environmentJson?: ShotEnvironment
  videoPrompt?: string
  referenceAssetsJson?: CanvasShotReferenceAsset[]
}): Promise<ShotDTO> {
  const updated = await updateCanvasShot(shotId, patch)
  if (!updated)
    throw new Error('更新失败')
  return mapShot(updated)
}

export async function deleteCharacter(characterId: string) {
  const shots = await listCanvasShotsByProject(
    (await getCanvasCharacterById(characterId))?.projectId ?? '',
  )
  const characterIdStr = characterId
  for (const shot of shots) {
    if (shot.characterIdsJson.includes(characterIdStr)) {
      const updatedIds = shot.characterIdsJson.filter(id => id !== characterIdStr)
      await updateCanvasShot(shot.id, { characterIdsJson: updatedIds })
    }
  }
  await deleteCanvasCharacterById(characterId)
}

export async function deleteLocation(locationId: string) {
  const shots = await listCanvasShotsByProject(
    (await getCanvasLocationById(locationId))?.projectId ?? '',
  )
  for (const shot of shots) {
    if (shot.locationId === locationId) {
      await updateCanvasShot(shot.id, { locationId: undefined })
    }
  }
  await deleteCanvasLocationById(locationId)
}

export async function deleteShot(shotId: string) {
  await deleteCanvasShotById(shotId)
}
