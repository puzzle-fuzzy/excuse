import type { CanvasAssetOutput } from '@excuse/db'
import type { DashScopeClient } from '@excuse/provider'
import type { NovelAnalysis } from '@excuse/shared'
import { runAnalysisPhase, runCanvasAssetStep } from '@excuse/canvas-runtime'
import {
  getCanvasProjectById,
  markPipelineRunFailed,
  markPipelineRunRunning,
  markPipelineRunSucceeded,
} from '@excuse/db'
import { NotFoundError } from '../../utils/app-errors'
import { getProjectDetail } from './service-crud'
import { getTextModel, notifyNode } from './service-helpers'

export async function analyzeProject(projectId: string, client: DashScopeClient, runId?: string) {
  const project = await getCanvasProjectById(projectId)
  if (!project)
    throw new NotFoundError('项目不存在')

  if (runId)
    await markPipelineRunRunning(runId)
  notifyNode(project.accountId, projectId, 'analysis', projectId, 'running', undefined, undefined, runId)

  const textModel = getTextModel(project.modelPreferencesJson)
  const isReanalysis = project.status !== 'draft'

  try {
    const analysis = await runCanvasAssetStep<NovelAnalysis>({
      asset: {
        accountId: project.accountId,
        projectId,
        category: 'analysis',
        targetEntityType: 'project',
        targetEntityId: projectId,
        pipelineRunId: runId ?? undefined,
        model: textModel,
      },
      execute: async () => {
        const { analysis } = await runAnalysisPhase({
          projectId,
          storyText: project.storyText,
          isReanalysis,
          client,
          textModel,
        })
        const output: CanvasAssetOutput = { type: 'json', data: { ...analysis } }
        return { result: analysis, output }
      },
    })

    notifyNode(project.accountId, projectId, 'analysis', projectId, 'completed', { analysis }, undefined, runId)
    if (runId)
      await markPipelineRunSucceeded(runId, { phase: 'analyze' })
    return getProjectDetail(projectId)
  }
  catch (error) {
    const errorMessage = (error as Error).message
    notifyNode(project.accountId, projectId, 'analysis', projectId, 'failed', undefined, errorMessage, runId)
    if (runId)
      await markPipelineRunFailed(runId, errorMessage)
    throw error
  }
}
