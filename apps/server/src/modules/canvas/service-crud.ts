import type { CanvasShotReferenceAsset, ShotCamera, ShotEnvironment } from '@excuse/db'
import type { CanvasModelPreferences, CharacterDTO, LocationDTO, ShotDTO } from '@excuse/shared'
import {
  batchGetProjectDetails,
  deleteCanvasCharacterById,
  deleteCanvasLocationById,
  deleteCanvasShotById,
  getCanvasCharacterById,
  getCanvasLocationById,
  getCanvasProjectById,
  getCanvasProjectDetail,
  listCanvasShotsByProject,
  softDeleteCanvasProject,
  updateCanvasCharacter,
  updateCanvasLocation,
  updateCanvasProject,
  updateCanvasShot,
} from '@excuse/db'
import { parseCanvasLayout } from './layout'
import { mapCharacter, mapLocation, mapProjectDetail, mapShot } from './mapper'
import { reconcileProjectShots } from './service-helpers'

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
