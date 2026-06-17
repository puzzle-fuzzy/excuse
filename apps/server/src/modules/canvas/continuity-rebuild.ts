import type { CanvasAssetOutput } from '@excuse/db'
import {
  buildShotVideoPromptEntity,
  resolveShotVideoReferences,
  runCanvasAssetStep,
  runContinuityPhase,
  toPromptReferenceEntries,
} from '@excuse/canvas-runtime'
import {
  getCanvasProjectDetail,
  markPipelineRunFailed,
  markPipelineRunRunning,
  markPipelineRunSucceeded,
  updateCanvasProject,
  updateCanvasShot,
} from '@excuse/db'
import { getProjectDetail } from './service-crud'
import { assertNotGenerating, notifyNode } from './service-helpers'

export async function checkContinuity(projectId: string, runId?: string) {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')
  assertNotGenerating(detail.project.status)

  const accountId = detail.project.accountId

  if (runId)
    await markPipelineRunRunning(runId)

  try {
    const issues = await runCanvasAssetStep({
      asset: {
        accountId,
        projectId,
        category: 'continuityReport',
        targetEntityType: 'project',
        targetEntityId: projectId,
        pipelineRunId: runId ?? undefined,
      },
      execute: async () => {
        const { issues } = await runContinuityPhase({ projectId, detail })

        const output: CanvasAssetOutput = { type: 'json', data: { issuesCount: issues.length, issues } }
        return { result: issues, output }
      },
    })

    notifyNode(accountId, projectId, 'continuity', projectId, 'completed', { issues }, undefined, runId)
    await updateCanvasProject(projectId, { status: 'continuity_checked' })
    if (runId)
      await markPipelineRunSucceeded(runId, { phase: 'continuity', issuesFound: issues.length })
    return getProjectDetail(projectId)
  }
  catch (error) {
    const errorMessage = (error as Error).message
    notifyNode(accountId, projectId, 'continuity', projectId, 'failed', undefined, errorMessage, runId)
    if (runId)
      await markPipelineRunFailed(runId, errorMessage)
    throw error
  }
}

export async function rebuildShotPrompts(projectId: string, runId?: string) {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')
  assertNotGenerating(detail.project.status)

  const accountId = detail.project.accountId

  if (runId)
    await markPipelineRunRunning(runId)

  try {
    const characterMap = new Map(detail.characters.map(c => [c.id, c]))
    const locationMap = new Map(detail.locations.map(l => [l.id, l]))

    for (const shot of detail.shots) {
      const shotCharacters = shot.characterIdsJson
        .map(id => characterMap.get(id))
        .filter(Boolean) as typeof detail.characters

      const shotLocation = shot.locationId ? locationMap.get(shot.locationId) : undefined

      if (!shotLocation)
        continue

      await runCanvasAssetStep({
        asset: {
          accountId,
          projectId,
          category: 'videoPrompt',
          targetEntityType: 'shot',
          targetEntityId: shot.id,
          pipelineRunId: runId ?? undefined,
        },
        execute: async () => {
          // 解析 R2V 参考图（与 submit 用同一纯函数），把角色/场景指代烘焙成 [Image N]。
          const references = resolveShotVideoReferences({ shot, characters: detail.characters, locations: detail.locations })
          const { videoPrompt, negativePrompt } = buildShotVideoPromptEntity({
            shot,
            characters: shotCharacters,
            location: shotLocation,
            references: toPromptReferenceEntries(references),
          })

          await updateCanvasShot(shot.id, {
            videoPrompt,
            negativePrompt,
            status: 'ready',
          })

          const output: CanvasAssetOutput = { type: 'text', text: videoPrompt }
          return { result: undefined, output }
        },
      })
    }

    await updateCanvasProject(projectId, { status: 'prompts_ready' })
    notifyNode(accountId, projectId, 'prompts', projectId, 'completed', undefined, undefined, runId)
    if (runId)
      await markPipelineRunSucceeded(runId, { phase: 'rebuild' })
    return getProjectDetail(projectId)
  }
  catch (error) {
    const errorMessage = (error as Error).message
    notifyNode(accountId, projectId, 'rebuild', projectId, 'failed', undefined, errorMessage, runId)
    if (runId)
      await markPipelineRunFailed(runId, errorMessage)
    throw error
  }
}
