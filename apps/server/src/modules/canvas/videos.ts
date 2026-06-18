import type { DashScopeClient } from '@excuse/provider'
import type { BatchItemLike } from '@excuse/workflow-engine'
import { submitShotVideoEntity } from '@excuse/canvas-runtime'
import {
  createCanvasAsset,
  getCanvasProjectDetail,
  getCanvasShotById,
  markCanvasAssetFailed,
  markCanvasAssetRunning,
  markPipelineRunFailed,
  markPipelineRunRunning,
  markPipelineRunSucceeded,
  resetCanvasShotToDraft,
  updateCanvasProject,
  updateCanvasShot,
} from '@excuse/db'
import { decideBatchOutcome } from '@excuse/workflow-engine'
import { ConflictError, NotFoundError } from '../../utils/app-errors'
import { getProjectDetail } from './service-crud'
import { getVideoModel, notifyNode } from './service-helpers'

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function generateVideos(projectId: string, client: DashScopeClient, runId?: string) {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new NotFoundError('项目不存在')

  const accountId = detail.project.accountId

  if (runId)
    await markPipelineRunRunning(runId)

  await updateCanvasProject(projectId, { status: 'generating' })

  // 收集本次提交的 per-shot 结果，交给 workflow-engine 做结果分类。
  // 注意：这里只判断“本次提交结果”，视频最终 completed/partial_failed 由 worker
  // 轮询完成后再判定（见 task-processor.checkProjectCompletion），不要把提交中的
  // shot 误判成失败终态。
  const submissionResults: BatchItemLike[] = []

  for (const shot of detail.shots) {
    if (!shot.videoPrompt)
      continue

    notifyNode(accountId, projectId, 'shot', shot.id, 'running', undefined, undefined, runId)

    // ── 为镜头视频创建 canvas_asset ──────────────────
    const shotVideoAsset = await createCanvasAsset({
      accountId,
      projectId,
      category: 'shotVideo',
      targetEntityType: 'shot',
      targetEntityId: shot.id,
      pipelineRunId: runId ?? undefined,
      model: getVideoModel(detail.project.modelPreferencesJson, []),
    })
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
        modelPreferences: detail.project.modelPreferencesJson,
        client,
      })
      submissionResults.push({ status: 'succeeded' })
    }
    catch (error) {
      const message = getErrorMessage(error)
      await updateCanvasShot(shot.id, { status: 'failed', errorMessage: message })
      // ── 标记视频资产失败 ──────────────────────────
      await markCanvasAssetFailed(shotVideoAsset.id, message).catch(() => {})
      notifyNode(accountId, projectId, 'shot', shot.id, 'failed', undefined, message, runId)
      submissionResults.push({ status: 'failed' })
    }
  }

  const outcome = decideBatchOutcome(submissionResults)
  // 至少一个 shot 提交成功（all_succeeded / partial_failed）→ 继续 generating，run succeeded；
  // 全部失败（all_failed）或没有任何 shot 带 prompt（empty）→ 退回 prompts_ready，run failed。
  const anySubmitted = outcome.type === 'all_succeeded' || outcome.type === 'partial_failed'

  if (anySubmitted) {
    await updateCanvasProject(projectId, { status: 'generating' })
    if (runId)
      await markPipelineRunSucceeded(runId, { phase: 'videos', shotsSubmitted: outcome.total })
  }
  else {
    await updateCanvasProject(projectId, { status: 'prompts_ready' })
    if (runId)
      await markPipelineRunFailed(runId, '所有视频提交失败')
  }

  return getProjectDetail(projectId)
}

export async function retryShotVideo(shotId: string, client: DashScopeClient) {
  const shot = await getCanvasShotById(shotId)
  if (!shot)
    throw new NotFoundError('镜头不存在')
  if (shot.status !== 'failed')
    throw new ConflictError('只能重试失败的镜头')

  await resetCanvasShotToDraft(shotId)

  const detail = await getCanvasProjectDetail(shot.projectId)
  if (!detail)
    throw new NotFoundError('项目不存在')

  await updateCanvasProject(shot.projectId, { status: 'generating' })

  notifyNode(detail.project.accountId, shot.projectId, 'shot', shot.id, 'running')

  const shotVideoAsset = await createCanvasAsset({
    accountId: detail.project.accountId,
    projectId: shot.projectId,
    category: 'shotVideo',
    targetEntityType: 'shot',
    targetEntityId: shot.id,
    model: getVideoModel(detail.project.modelPreferencesJson, []),
  })
  await markCanvasAssetRunning(shotVideoAsset.id)

  try {
    await submitShotVideoEntity({
      projectId: shot.projectId,
      accountId: detail.project.accountId,
      shotId: shot.id,
      assetId: shotVideoAsset.id,
      shot,
      characters: detail.characters,
      locations: detail.locations,
      modelPreferences: detail.project.modelPreferencesJson,
      client,
      estimatedCost: true,
    })
  }
  catch (error) {
    const message = getErrorMessage(error)
    await updateCanvasShot(shot.id, { status: 'failed', errorMessage: message })
    await markCanvasAssetFailed(shotVideoAsset.id, message).catch(() => {})
    notifyNode(detail.project.accountId, shot.projectId, 'shot', shot.id, 'failed', undefined, message)
    throw error
  }
}

export async function retryFailedShots(projectId: string, accountId: string, client: DashScopeClient) {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new NotFoundError('项目不存在')

  const failedShots = detail.shots.filter(s => s.status === 'failed')
  if (failedShots.length === 0)
    throw new ConflictError('没有失败的镜头可以重试')

  await updateCanvasProject(projectId, { status: 'generating' })

  for (const shot of failedShots) {
    await resetCanvasShotToDraft(shot.id)
    notifyNode(accountId, projectId, 'shot', shot.id, 'running')

    const shotVideoAsset = await createCanvasAsset({
      accountId,
      projectId,
      category: 'shotVideo',
      targetEntityType: 'shot',
      targetEntityId: shot.id,
      model: getVideoModel(detail.project.modelPreferencesJson, []),
    })
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
        modelPreferences: detail.project.modelPreferencesJson,
        client,
        estimatedCost: true,
      })
    }
    catch (error) {
      const message = getErrorMessage(error)
      await updateCanvasShot(shot.id, { status: 'failed', errorMessage: message })
      await markCanvasAssetFailed(shotVideoAsset.id, message).catch(() => {})
      notifyNode(accountId, projectId, 'shot', shot.id, 'failed', undefined, message)
    }
  }
}
