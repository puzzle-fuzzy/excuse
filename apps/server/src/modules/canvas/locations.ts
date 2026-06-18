import type { CanvasAssetOutput } from '@excuse/db'
import type { DashScopeClient } from '@excuse/provider'
import { generateLocationEntity, runCanvasAssetStep } from '@excuse/canvas-runtime'
import {
  deleteCanvasLocationsByProject,
  deleteCanvasShotsByProject,
  getCanvasProjectById,
  markPipelineRunRunning,
  markPipelineRunSucceeded,
  updateCanvasProject,
} from '@excuse/db'
import { ConflictError, NotFoundError } from '../../utils/app-errors'
import { createServerRepoAdapter } from './adapter-factory'
import { getProjectDetail } from './service-crud'
import { assertNotGenerating, getTextModel, notifyNode } from './service-helpers'
import { tryMatchLocation } from './subject-matching'

export async function generateLocations(projectId: string, client: DashScopeClient, runId?: string) {
  const project = await getCanvasProjectById(projectId)
  if (!project)
    throw new NotFoundError('项目不存在')
  if (!project.analysisJson)
    throw new ConflictError('项目尚未分析，请先完成分析阶段')
  assertNotGenerating(project.status)

  const analysis = project.analysisJson!
  const accountId = project.accountId
  const textModel = getTextModel(project.modelPreferencesJson)

  if (runId)
    await markPipelineRunRunning(runId)

  await deleteCanvasLocationsByProject(projectId, { excludeLocked: true })
  await deleteCanvasShotsByProject(projectId)

  const repo = createServerRepoAdapter()

  for (const name of analysis.sceneNames) {
    // ── 先尝试匹配资产库 ──────────────────────────────
    const match = await tryMatchLocation(accountId, projectId, name)
    if (match.matched) {
      notifyNode(accountId, projectId, 'location', match.location.id, 'completed', { name: match.location.name, source: 'subject_library' }, undefined, runId)
      continue
    }

    notifyNode(accountId, projectId, 'location', name, 'running', undefined, undefined, runId)

    try {
      const { location, profile } = await runCanvasAssetStep({
        repo,
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
          const result = await generateLocationEntity({ projectId, storyText: project.storyText, analysis, name, client, textModel, repo })
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
