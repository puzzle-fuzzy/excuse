import type { CanvasAssetOutput } from '@excuse/db'
import { generateLocationEntity, runCanvasAssetStep } from '@excuse/canvas-runtime'
import {
  deleteCanvasLocationsByProject,
  deleteCanvasShotsByProject,
  getCanvasProjectById,
  markPipelineRunRunning,
  markPipelineRunSucceeded,
  updateCanvasProject,
} from '@excuse/db'
import { getProjectDetail } from './service-crud'
import type { DashScopeClient } from '@excuse/provider'
import { assertNotGenerating, getTextModel, notifyNode } from './service-helpers'

export async function generateLocations(projectId: string, client: DashScopeClient, runId?: string) {
  const project = await getCanvasProjectById(projectId)
  if (!project || !project.analysisJson)
    throw new Error('项目不存在或未分析')
  assertNotGenerating(project.status)

  const analysis = project.analysisJson!
  const accountId = project.accountId
  const textModel = getTextModel(project.modelPreferencesJson)

  if (runId)
    await markPipelineRunRunning(runId)

  await deleteCanvasLocationsByProject(projectId, { excludeLocked: true })
  await deleteCanvasShotsByProject(projectId)

  for (const name of analysis.sceneNames) {
    notifyNode(accountId, projectId, 'location', name, 'running', undefined, undefined, runId)

    try {
      const { location, profile } = await runCanvasAssetStep({
        asset: {
          accountId,
          projectId,
          category: 'locationProfile',
          targetEntityType: 'project',
          targetEntityId: projectId,
          pipelineRunId: runId ?? undefined,
          model: textModel,
        },
        execute: async () => {
          const result = await generateLocationEntity({ projectId, storyText: project.storyText, analysis, name, client, textModel })
          const output: CanvasAssetOutput = { type: 'json', data: { ...result.profile } }
          return { result, output }
        },
      })

      notifyNode(accountId, projectId, 'location', location.id, 'completed', { name: profile.name, profile }, undefined, runId)
    }
    catch (error) {
      const errorMessage = (error as Error).message
      notifyNode(accountId, projectId, 'location', name, 'failed', undefined, errorMessage, runId)
    }
  }

  await updateCanvasProject(projectId, { status: 'locations_ready' })
  if (runId)
    await markPipelineRunSucceeded(runId, { phase: 'locations' })
  return getProjectDetail(projectId)
}
