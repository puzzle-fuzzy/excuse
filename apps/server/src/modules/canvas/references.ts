import type { AssetStorage, DashScopeClient } from '@excuse/provider'
import {
  buildCharacterPortraitPrompt,
  buildCharacterTurnaroundPrompt,
  buildLocationRefPrompt,
  generateCharacterRefAssets,
  generateLocationRefAsset,
} from '@excuse/canvas-runtime'
import {
  createCanvasAsset,
  getCanvasProjectDetail,
  markCanvasAssetFailed,
  markCanvasAssetRunning,
  markPipelineRunRunning,
  markPipelineRunSucceeded,
  updateCanvasProject,
} from '@excuse/db'
import { getModelById } from '@excuse/provider'
import { getProjectDetail } from './service-crud'
import { assertNotGenerating, getImageModel, notifyNode } from './service-helpers'

export async function generateCharacterRefs(projectId: string, client: DashScopeClient, storage: AssetStorage, runId?: string) {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')
  assertNotGenerating(detail.project.status)

  const accountId = detail.project.accountId
  const imageModel = getImageModel(detail.project.modelPreferencesJson)
  const imageModelConfig = getModelById(imageModel)
  if (!imageModelConfig)
    throw new Error(`未知图片模型：${imageModel}`)

  if (runId)
    await markPipelineRunRunning(runId)

  for (const char of detail.characters) {
    if (char.locked || !char.identityPrompt || char.referenceImageUrl)
      continue

    notifyNode(accountId, projectId, 'character', char.id, 'running', undefined, undefined, runId)
    const portraitPrompt = buildCharacterPortraitPrompt(char.identityPrompt)
    const turnaroundPrompt = buildCharacterTurnaroundPrompt(char.identityPrompt)

    // ── 为角色肖像创建 canvas_asset ──────────────────
    const portraitAsset = await createCanvasAsset({
      accountId,
      projectId,
      category: 'characterPortrait',
      targetEntityType: 'character',
      targetEntityId: char.id,
      pipelineRunId: runId ?? undefined,
      model: imageModel,
      inputJson: { prompt: portraitPrompt, size: '2048*2048', n: 1 },
    })
    // ── 为角色三视图创建 canvas_asset ──────────────────
    const turnaroundAsset = await createCanvasAsset({
      accountId,
      projectId,
      category: 'characterTurnaround',
      targetEntityType: 'character',
      targetEntityId: char.id,
      pipelineRunId: runId ?? undefined,
      model: imageModel,
      inputJson: { prompt: turnaroundPrompt, size: '2048*2048', n: 1 },
    })

    try {
      // ── 标记资产为运行状态 ──────────────────────────
      await markCanvasAssetRunning(portraitAsset.id)
      await markCanvasAssetRunning(turnaroundAsset.id)

      await generateCharacterRefAssets({
        character: char,
        portraitAssetId: portraitAsset.id,
        turnaroundAssetId: turnaroundAsset.id,
        imageModel,
        imageModelConfig,
        client,
        storage,
      })

      notifyNode(accountId, projectId, 'character', char.id, 'completed', undefined, undefined, runId)
    }
    catch (error) {
      // ── 标记资产失败 ──────────────────────────────────
      const errorMessage = (error as Error).message
      // 尝试标记两个资产为失败（如果它们仍在运行状态）
      await markCanvasAssetFailed(portraitAsset.id, errorMessage).catch(() => {})
      await markCanvasAssetFailed(turnaroundAsset.id, errorMessage).catch(() => {})
      notifyNode(accountId, projectId, 'character', char.id, 'failed', undefined, errorMessage, runId)
    }
  }

  await updateCanvasProject(projectId, { status: 'refs_ready' })
  if (runId)
    await markPipelineRunSucceeded(runId, { phase: 'characterRefs' })
  return getProjectDetail(projectId)
}

export async function generateLocationRefs(projectId: string, client: DashScopeClient, storage: AssetStorage, runId?: string) {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')
  assertNotGenerating(detail.project.status)

  const accountId = detail.project.accountId
  const imageModel = getImageModel(detail.project.modelPreferencesJson)
  const imageModelConfig = getModelById(imageModel)
  if (!imageModelConfig)
    throw new Error(`未知图片模型：${imageModel}`)

  if (runId)
    await markPipelineRunRunning(runId)

  for (const loc of detail.locations) {
    if (loc.locked || !loc.scenePrompt || loc.referenceImageUrl)
      continue

    notifyNode(accountId, projectId, 'location', loc.id, 'running', undefined, undefined, runId)
    const prompt = buildLocationRefPrompt(loc.scenePrompt)

    // ── 为场景参考图创建 canvas_asset ──────────────────
    const refAsset = await createCanvasAsset({
      accountId,
      projectId,
      category: 'locationRef',
      targetEntityType: 'location',
      targetEntityId: loc.id,
      pipelineRunId: runId ?? undefined,
      model: imageModel,
      inputJson: { prompt, size: '2048*2048', n: 1 },
    })

    try {
      // ── 标记资产为运行状态 ──────────────────────────
      await markCanvasAssetRunning(refAsset.id)

      await generateLocationRefAsset({
        location: loc,
        refAssetId: refAsset.id,
        imageModel,
        imageModelConfig,
        client,
        storage,
      })

      notifyNode(accountId, projectId, 'location', loc.id, 'completed', undefined, undefined, runId)
    }
    catch (error) {
      // ── 标记资产失败 ──────────────────────────────────
      const errorMessage = (error as Error).message
      await markCanvasAssetFailed(refAsset.id, errorMessage).catch(() => {})
      notifyNode(accountId, projectId, 'location', loc.id, 'failed', undefined, errorMessage, runId)
    }
  }

  await updateCanvasProject(projectId, { status: 'refs_all_ready' })
  if (runId)
    await markPipelineRunSucceeded(runId, { phase: 'locationRefs' })
  return getProjectDetail(projectId)
}
