import type { CanvasAssetOutput } from '@excuse/db'
import type { DashScopeClient } from '@excuse/provider'
import { runCanvasAssetStep, runStoryboardPhase } from '@excuse/canvas-runtime'
import {
  getCanvasProjectDetail,
  markPipelineRunFailed,
  markPipelineRunRunning,
  markPipelineRunSucceeded,
  updateCanvasProject,
} from '@excuse/db'
import { getProjectDetail } from './service-crud'
import { assertNotGenerating, getTextModel, notifyNode } from './service-helpers'

export async function generateStoryboard(projectId: string, client: DashScopeClient, runId?: string) {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')
  assertNotGenerating(detail.project.status)

  const project = detail.project
  if (!project.analysisJson)
    throw new Error('项目未分析')

  const analysis = project.analysisJson!
  const accountId = project.accountId
  const textModel = getTextModel(project.modelPreferencesJson)

  notifyNode(accountId, projectId, 'storyboard', projectId, 'running', undefined, undefined, runId)

  if (runId)
    await markPipelineRunRunning(runId)

  try {
    const created = await runCanvasAssetStep({
      asset: {
        accountId,
        projectId,
        category: 'storyboard',
        targetEntityType: 'project',
        targetEntityId: projectId,
        pipelineRunId: runId ?? undefined,
        model: textModel,
      },
      execute: async () => {
        const { shots, shotsCreated } = await runStoryboardPhase({
          projectId,
          storyText: project.storyText,
          analysis,
          characters: detail.characters.map(c => ({ id: c.id, name: c.name, identityPrompt: c.identityPrompt || '' })),
          locations: detail.locations.map(l => ({ id: l.id, name: l.name, scenePrompt: l.scenePrompt || '' })),
          client,
          textModel,
        })
        const output: CanvasAssetOutput = { type: 'json', data: { shotsCount: shotsCreated.length, shots } }
        return { result: shotsCreated, output }
      },
    })

    for (const shot of created)
      notifyNode(accountId, projectId, 'shot', shot.id, 'completed', undefined, undefined, runId)

    await updateCanvasProject(projectId, { status: 'storyboard_ready' })
    if (runId)
      await markPipelineRunSucceeded(runId, { phase: 'storyboard', shotsCreated: created.length })
    return getProjectDetail(projectId)
  }
  catch (error) {
    const errorMessage = (error as Error).message
    notifyNode(accountId, projectId, 'storyboard', projectId, 'failed', undefined, errorMessage, runId)
    if (runId)
      await markPipelineRunFailed(runId, errorMessage)
    throw error
  }
}
