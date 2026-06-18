import type { DashScopeClient } from '@excuse/provider'
import { submitShotVideoEntity } from '@excuse/canvas-runtime'
import {
  createCanvasAsset,
  findReusableCanvasAssetForPipelineTarget,
  markCanvasAssetFailed,
  markCanvasAssetRunning,
  notifyNotification,
  updateCanvasProject,
  updateCanvasShot,
} from '@excuse/db'
import { createWorkerProviderAdapter, createWorkerRepoAdapter } from './canvas-adapter-factory'
import {
  getVideoModel,
  loadRunnableCanvasProject,
} from './canvas-execution'

export interface CanvasVideosResult extends Record<string, unknown> {
  phase: 'videos'
  projectId: string
  shotsSubmitted: number
  shotsSkipped: number
  shotsFailed: number
}

export async function executeCanvasVideos(
  projectId: string,
  client: DashScopeClient,
  runId?: string,
  workerTaskId?: string,
): Promise<CanvasVideosResult> {
  const detail = await loadRunnableCanvasProject(projectId)
  const project = detail.project
  const accountId = project.accountId
  let shotsSubmitted = 0
  let shotsSkipped = 0
  let shotsFailed = 0
  const repo = createWorkerRepoAdapter()
  const provider = createWorkerProviderAdapter()

  await updateCanvasProject(projectId, { status: 'generating' })

  for (const shot of detail.shots) {
    if (!shot.videoPrompt) {
      shotsSkipped += 1
      continue
    }

    const existingAsset = runId
      ? await findReusableCanvasAssetForPipelineTarget({
          pipelineRunId: runId,
          targetEntityType: 'shot',
          targetEntityId: shot.id,
          category: 'shotVideo',
        })
      : null

    if (existingAsset && (existingAsset.status === 'succeeded' || shot.videoTaskId || existingAsset.taskId)) {
      shotsSubmitted += 1
      continue
    }

    const pendingModel = getVideoModel(project.modelPreferencesJson, [])
    const shotVideoAsset = existingAsset ?? await createCanvasAsset({
      accountId,
      projectId,
      category: 'shotVideo',
      targetEntityType: 'shot',
      targetEntityId: shot.id,
      pipelineRunId: runId ?? undefined,
      model: pendingModel,
    })
    if (shotVideoAsset.status === 'queued')
      await markCanvasAssetRunning(shotVideoAsset.id)

    try {
      await submitShotVideoEntity({
        projectId,
        accountId,
        shotId: shot.id,
        assetId: shotVideoAsset.id,
        shot,
        characters: detail.characters,
        locations: detail.locations,
        modelPreferences: project.modelPreferencesJson,
        client,
        repo,
        provider,
        diagnostics: {
          workerTaskId,
          pipelineRunId: runId,
          canvasAssetId: shotVideoAsset.id,
        },
      })

      shotsSubmitted += 1
    }
    catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      await updateCanvasShot(shot.id, { status: 'failed', errorMessage })
      await markCanvasAssetFailed(shotVideoAsset.id, errorMessage).catch(() => {})
      // 通知：镜头视频提交失败（P2-2） — 提交阶段失败不会进入 task-processor 轮询，需在此显式通知
      await notifyNotification({
        accountId,
        type: 'task_failed',
        title: '镜头视频提交失败',
        body: errorMessage,
        meta: { projectId, assetId: shotVideoAsset.id, category: 'video' },
      }).catch(() => {})
      shotsFailed += 1
    }
  }

  await updateCanvasProject(projectId, {
    status: shotsSubmitted > 0 ? 'generating' : 'prompts_ready',
  })

  return {
    phase: 'videos',
    projectId,
    shotsSubmitted,
    shotsSkipped,
    shotsFailed,
  }
}
