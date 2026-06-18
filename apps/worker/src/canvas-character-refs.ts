import type { DashScopeClient } from '@excuse/provider'
import type { AssetStorage } from '@excuse/storage'
import {
  buildCharacterPortraitPrompt,
  buildCharacterTurnaroundPrompt,
  generateCharacterRefAssets,
} from '@excuse/canvas-runtime'
import {
  createCanvasAsset,
  markCanvasAssetFailed,
  markCanvasAssetRunning,
  updateCanvasProject,
} from '@excuse/db'
import { getModelById } from '@excuse/provider'
import { createWorkerProviderAdapter, createWorkerRepoAdapter } from './canvas-adapter-factory'
import {
  getImageModel,
  loadRunnableCanvasProject,
} from './canvas-execution'

export interface CanvasCharacterRefsResult extends Record<string, unknown> {
  phase: 'characterRefs'
  projectId: string
  charactersProcessed: number
  charactersSkipped: number
  charactersFailed: number
  portraitsCreated: number
  turnaroundsCreated: number
}

export async function executeCanvasCharacterRefs(
  projectId: string,
  client: DashScopeClient,
  storage: AssetStorage,
  runId?: string,
): Promise<CanvasCharacterRefsResult> {
  const detail = await loadRunnableCanvasProject(projectId)
  const project = detail.project
  const accountId = project.accountId
  const imageModel = getImageModel(project.modelPreferencesJson)
  const imageModelConfig = getModelById(imageModel)
  if (!imageModelConfig)
    throw new Error(`未知图片模型：${imageModel}`)

  let charactersProcessed = 0
  let charactersSkipped = 0
  let charactersFailed = 0
  let portraitsCreated = 0
  let turnaroundsCreated = 0
  const repo = createWorkerRepoAdapter()
  const provider = createWorkerProviderAdapter()

  for (const character of detail.characters) {
    if (character.locked || !character.identityPrompt || character.referenceImageUrl) {
      charactersSkipped += 1
      continue
    }

    charactersProcessed += 1

    const portraitPrompt = buildCharacterPortraitPrompt(character.identityPrompt)
    const turnaroundPrompt = buildCharacterTurnaroundPrompt(character.identityPrompt)

    const portraitAsset = await createCanvasAsset({
      accountId,
      projectId,
      category: 'characterPortrait',
      targetEntityType: 'character',
      targetEntityId: character.id,
      pipelineRunId: runId ?? undefined,
      model: imageModel,
      inputJson: { prompt: portraitPrompt, size: '2048*2048', n: 1 },
    })

    const turnaroundAsset = await createCanvasAsset({
      accountId,
      projectId,
      category: 'characterTurnaround',
      targetEntityType: 'character',
      targetEntityId: character.id,
      pipelineRunId: runId ?? undefined,
      model: imageModel,
      inputJson: { prompt: turnaroundPrompt, size: '2048*2048', n: 1 },
    })

    try {
      await markCanvasAssetRunning(portraitAsset.id)
      await markCanvasAssetRunning(turnaroundAsset.id)

      const { portraitUrl, turnaroundUrl } = await generateCharacterRefAssets({
        character,
        portraitAssetId: portraitAsset.id,
        turnaroundAssetId: turnaroundAsset.id,
        imageModel,
        imageModelConfig,
        client,
        storage,
        repo,
        provider,
      })
      if (portraitUrl)
        portraitsCreated += 1
      if (turnaroundUrl)
        turnaroundsCreated += 1
    }
    catch (error) {
      charactersFailed += 1
      const errorMessage = error instanceof Error ? error.message : String(error)
      await markCanvasAssetFailed(portraitAsset.id, errorMessage).catch(() => {})
      await markCanvasAssetFailed(turnaroundAsset.id, errorMessage).catch(() => {})
    }
  }

  await updateCanvasProject(projectId, { status: 'refs_ready' })

  return {
    phase: 'characterRefs',
    projectId,
    charactersProcessed,
    charactersSkipped,
    charactersFailed,
    portraitsCreated,
    turnaroundsCreated,
  }
}
