/**
 * Canvas 资源 handler — 角色/场景/镜头 PATCH/DELETE + retry + regenerate + 资产
 */
import type { CanvasShotReferenceAsset } from '@excuse/shared'
import type { ServerContext } from '../../context'
import {
  getCanvasAssetById, getCanvasCharacterForAccount, getCanvasLocationForAccount,
  getCanvasProjectByIdForAccount, getCanvasShotForAccount, listCanvasAssetsByTarget,
  listCanvasShotsByProject, setCanvasAssetActive, setCanvasAssetLocked, updateCanvasProject,
} from '@excuse/db'
import { ReferenceAssetValidationError, validateShotReferenceAssetsForAccount } from '../../modules/canvas/reference-assets'
import * as svc from '../../modules/canvas/service'
import { createLogger } from '@excuse/shared'
import { acceptedResponse } from './helpers'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/app-errors'
import { audit } from '../../services/audit'
import { dispatchToUser } from '../../services/sse-manager'

const logger = createLogger('canvas-resource-handlers')

// ── 角色 ────────────────────────────────────────────────
export async function handlePatchCharacter(characterId: string, userId: string, body: Record<string, unknown>) {
  const character = await getCanvasCharacterForAccount(characterId, userId)
  if (!character) throw new NotFoundError('角色不存在或无权访问')
  return { success: true, data: await svc.updateCharacterData(characterId, body) }
}

export async function handleGetCharacterDetail(characterId: string, userId: string) {
  const character = await getCanvasCharacterForAccount(characterId, userId)
  if (!character) throw new NotFoundError('角色不存在或无权访问')
  const detail = await svc.getCharacterDetail(characterId)
  if (!detail) throw new NotFoundError('角色不存在')
  return { success: true, data: detail }
}

// ── 场景 ────────────────────────────────────────────────
export async function handlePatchLocation(locationId: string, userId: string, body: Record<string, unknown>) {
  const location = await getCanvasLocationForAccount(locationId, userId)
  if (!location) throw new NotFoundError('场景不存在或无权访问')
  return { success: true, data: await svc.updateLocationData(locationId, body) }
}

export async function handleGetLocationDetail(locationId: string, userId: string) {
  const location = await getCanvasLocationForAccount(locationId, userId)
  if (!location) throw new NotFoundError('场景不存在或无权访问')
  const detail = await svc.getLocationDetail(locationId)
  if (!detail) throw new NotFoundError('场景不存在')
  return { success: true, data: detail }
}

// ── 镜头 ────────────────────────────────────────────────
export async function handlePatchShot(shotId: string, userId: string, body: Record<string, unknown>) {
  const shot = await getCanvasShotForAccount(shotId, userId)
  if (!shot) throw new NotFoundError('镜头不存在或无权访问')
  let validatedAssets: CanvasShotReferenceAsset[] | undefined
  try {
    validatedAssets = await validateShotReferenceAssetsForAccount(userId, body.referenceAssetsJson as CanvasShotReferenceAsset[] | undefined)
  }
  catch (err) {
    if (err instanceof ReferenceAssetValidationError)
      throw err.status === 403 ? new ForbiddenError(err.message) : new ValidationError(err.message)
    throw err
  }
  return { success: true, data: await svc.updateShotData(shotId, { ...body, referenceAssetsJson: validatedAssets }) }
}

export async function handleGetShotDetail(shotId: string, userId: string) {
  const shot = await getCanvasShotForAccount(shotId, userId)
  if (!shot) throw new NotFoundError('镜头不存在或无权访问')
  const detail = await svc.getShotDetail(shotId)
  if (!detail) throw new NotFoundError('镜头不存在')
  return { success: true, data: detail }
}

// ── 批量参考资产 ──────────────────────────────────────
export async function handleApplyReferenceAssets(projectId: string, userId: string, body: { targetShotIds: string[], referenceAssetsJson: CanvasShotReferenceAsset[], mode: 'append' | 'replace' }) {
  const owned = await getCanvasProjectByIdForAccount(projectId, userId)
  if (!owned) throw new NotFoundError('项目不存在或无权访问')
  const projectShots = await listCanvasShotsByProject(projectId)
  const validShotIds = new Set(projectShots.map(s => s.id))
  const invalidIds = body.targetShotIds.filter((id: string) => !validShotIds.has(id))
  if (invalidIds.length > 0) throw new ValidationError(`镜头 ${invalidIds.join(', ')} 不属于该项目`)
  let validatedAssets: CanvasShotReferenceAsset[]
  try {
    validatedAssets = await validateShotReferenceAssetsForAccount(userId, body.referenceAssetsJson) ?? []
  }
  catch (err) {
    if (err instanceof ReferenceAssetValidationError)
      throw err.status === 403 ? new ForbiddenError(err.message) : new ValidationError(err.message)
    throw err
  }
  const applied = await svc.applyShotReferenceAssets(projectId, body.targetShotIds, validatedAssets, body.mode)
  audit('canvas_apply_reference_assets', { accountId: userId, targetId: projectId, detail: { projectId, mode: body.mode, shotCount: body.targetShotIds.length, assetCount: validatedAssets.length } })
  return { success: true, applied }
}

// ── DELETE ──────────────────────────────────────────────
export async function handleDeleteCharacter(characterId: string, userId: string) {
  const character = await getCanvasCharacterForAccount(characterId, userId)
  if (!character) throw new NotFoundError('角色不存在或无权访问')
  await svc.deleteCharacter(characterId)
  return { success: true }
}

export async function handleDeleteLocation(locationId: string, userId: string) {
  const location = await getCanvasLocationForAccount(locationId, userId)
  if (!location) throw new NotFoundError('场景不存在或无权访问')
  await svc.deleteLocation(locationId)
  return { success: true }
}

export async function handleDeleteShot(shotId: string, userId: string) {
  const shot = await getCanvasShotForAccount(shotId, userId)
  if (!shot) throw new NotFoundError('镜头不存在或无权访问')
  await svc.deleteShot(shotId)
  return { success: true }
}

// ── Retry ──────────────────────────────────────────────
export function handleRetryShot(shotId: string, userId: string, ctx: ServerContext) {
  const shotP = getCanvasShotForAccount(shotId, userId)
  shotP.then((shot) => {
    if (!shot) throw new NotFoundError('镜头不存在或无权访问')
    svc.retryShotVideo(shotId, ctx.client).catch((err) => {
      logger.error({ err, shotId }, 'retry failed')
      updateCanvasProject(shot.projectId, { status: 'failed' }).catch(dbErr =>
        logger.error({ err: dbErr, projectId: shot.projectId }, 'Failed to update project status to failed'),
      )
      dispatchToUser(userId, 'pipeline_node_update', {
        projectId: shot.projectId, nodeType: 'shot', nodeId: shotId, status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      })
    })
  })
  return acceptedResponse()
}

export function handleRetryFailedShots(projectId: string, userId: string, ctx: ServerContext) {
  getCanvasProjectByIdForAccount(projectId, userId).then((project) => {
    if (!project) throw new NotFoundError('项目不存在或无权访问')
    svc.retryFailedShots(projectId, userId, ctx.client).catch((err) => {
      logger.error({ err, projectId }, 'batch retry failed shots error')
      dispatchToUser(userId, 'pipeline_node_update', {
        projectId, nodeType: 'phase', nodeId: 'retry-failed-shots', status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      })
    })
  })
  return acceptedResponse()
}

// ── Regenerate ─────────────────────────────────────────
export function handleRegenerateCharacter(characterId: string, userId: string, ctx: ServerContext) {
  getCanvasCharacterForAccount(characterId, userId).then((character) => {
    if (!character) throw new NotFoundError('角色不存在或无权访问')
    audit('canvas_asset_regenerate', { accountId: userId, targetId: characterId, detail: { entityType: 'character', entityId: characterId, projectId: character.projectId } })
    svc.regenerateCharacter(characterId, ctx.client).catch((err) => { logger.error({ err, characterId }, 'regenerate character failed') })
  })
  return acceptedResponse()
}

export function handleRegenerateLocation(locationId: string, userId: string, ctx: ServerContext) {
  getCanvasLocationForAccount(locationId, userId).then((location) => {
    if (!location) throw new NotFoundError('场景不存在或无权访问')
    audit('canvas_asset_regenerate', { accountId: userId, targetId: locationId, detail: { entityType: 'location', entityId: locationId, projectId: location.projectId } })
    svc.regenerateLocation(locationId, ctx.client).catch((err) => { logger.error({ err, locationId }, 'regenerate location failed') })
  })
  return acceptedResponse()
}

export function handleRegenerateShotVideo(shotId: string, userId: string, ctx: ServerContext) {
  getCanvasShotForAccount(shotId, userId).then((shot) => {
    if (!shot) throw new NotFoundError('镜头不存在或无权访问')
    audit('canvas_asset_regenerate', { accountId: userId, targetId: shotId, detail: { entityType: 'shot', entityId: shotId, projectId: shot.projectId } })
    svc.regenerateShotVideo(shotId, ctx.client).catch((err) => { logger.error({ err, shotId }, 'regenerate shot video failed') })
  })
  return acceptedResponse()
}

// ── 资产 ──────────────────────────────────────────────
export async function handleListAssets(targetEntityType: string, targetEntityId: string, userId: string) {
  if (targetEntityType === 'character') {
    const c = await getCanvasCharacterForAccount(targetEntityId, userId)
    if (!c) throw new NotFoundError('角色不存在或无权访问')
  }
  else if (targetEntityType === 'location') {
    const l = await getCanvasLocationForAccount(targetEntityId, userId)
    if (!l) throw new NotFoundError('场景不存在或无权访问')
  }
  else if (targetEntityType === 'shot') {
    const s = await getCanvasShotForAccount(targetEntityId, userId)
    if (!s) throw new NotFoundError('镜头不存在或无权访问')
  }
  else throw new ValidationError('不支持的实体类型')
  const assets = await listCanvasAssetsByTarget(targetEntityType, targetEntityId)
  return { success: true, data: assets }
}

export async function handleActivateAsset(assetId: string, userId: string) {
  const asset = await getCanvasAssetById(assetId)
  if (!asset) throw new NotFoundError('资产不存在')
  if (asset.targetEntityType === 'character') {
    const c = await getCanvasCharacterForAccount(asset.targetEntityId, userId)
    if (!c) throw new NotFoundError('无权访问此资产')
  }
  else if (asset.targetEntityType === 'location') {
    const l = await getCanvasLocationForAccount(asset.targetEntityId, userId)
    if (!l) throw new NotFoundError('无权访问此资产')
  }
  else if (asset.targetEntityType === 'shot') {
    const s = await getCanvasShotForAccount(asset.targetEntityId, userId)
    if (!s) throw new NotFoundError('无权访问此资产')
  }
  if (asset.status !== 'succeeded') throw new ConflictError('只能将成功完成的资产设为活跃版本')
  const updated = await setCanvasAssetActive(assetId)
  if (!updated) throw new NotFoundError('资产激活失败')
  return { success: true, data: updated }
}

export async function handleLockAsset(assetId: string, userId: string, locked: boolean) {
  const asset = await getCanvasAssetById(assetId)
  if (!asset) throw new NotFoundError('资产不存在')
  if (asset.targetEntityType === 'character') {
    const c = await getCanvasCharacterForAccount(asset.targetEntityId, userId)
    if (!c) throw new NotFoundError('无权访问此资产')
  }
  else if (asset.targetEntityType === 'location') {
    const l = await getCanvasLocationForAccount(asset.targetEntityId, userId)
    if (!l) throw new NotFoundError('无权访问此资产')
  }
  else if (asset.targetEntityType === 'shot') {
    const s = await getCanvasShotForAccount(asset.targetEntityId, userId)
    if (!s) throw new NotFoundError('无权访问此资产')
  }
  const updated = await setCanvasAssetLocked(assetId, locked)
  if (!updated) throw new NotFoundError('资产更新失败')
  return { success: true, data: updated }
}
