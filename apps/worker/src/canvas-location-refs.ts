import type { DashScopeClient } from '@excuse/provider'
import type { AssetStorage } from '@excuse/storage'
import { buildLocationRefPrompt, generateLocationRefAsset } from '@excuse/canvas-runtime'
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

export interface CanvasLocationRefsResult extends Record<string, unknown> {
  phase: 'locationRefs'
  projectId: string
  locationsProcessed: number
  locationsSkipped: number
  locationsFailed: number
  refsCreated: number
}

export async function executeCanvasLocationRefs(
  projectId: string,
  client: DashScopeClient,
  storage: AssetStorage,
  runId?: string,
): Promise<CanvasLocationRefsResult> {
  const detail = await loadRunnableCanvasProject(projectId)
  const project = detail.project
  const accountId = project.accountId
  const imageModel = getImageModel(project.modelPreferencesJson)
  const imageModelConfig = getModelById(imageModel)
  if (!imageModelConfig)
    throw new Error(`未知图片模型：${imageModel}`)

  let locationsProcessed = 0
  let locationsSkipped = 0
  let locationsFailed = 0
  let refsCreated = 0
  const repo = createWorkerRepoAdapter()
  const provider = createWorkerProviderAdapter()

  for (const location of detail.locations) {
    if (location.locked || !location.scenePrompt || location.referenceImageUrl) {
      locationsSkipped += 1
      continue
    }

    locationsProcessed += 1
    const prompt = buildLocationRefPrompt(location.scenePrompt)

    const refAsset = await createCanvasAsset({
      accountId,
      projectId,
      category: 'locationRef',
      targetEntityType: 'location',
      targetEntityId: location.id,
      pipelineRunId: runId ?? undefined,
      model: imageModel,
      inputJson: { prompt, size: '2048*2048', n: 1 },
    })

    try {
      await markCanvasAssetRunning(refAsset.id)

      const { refUrl } = await generateLocationRefAsset({
        location,
        refAssetId: refAsset.id,
        imageModel,
        imageModelConfig,
        client,
        storage,
        repo,
        provider,
      })
      if (refUrl)
        refsCreated += 1
    }
    catch (error) {
      locationsFailed += 1
      const errorMessage = error instanceof Error ? error.message : String(error)
      await markCanvasAssetFailed(refAsset.id, errorMessage).catch(() => {})
    }
  }

  await updateCanvasProject(projectId, { status: 'refs_all_ready' })

  return {
    phase: 'locationRefs',
    projectId,
    locationsProcessed,
    locationsSkipped,
    locationsFailed,
    refsCreated,
  }
}
