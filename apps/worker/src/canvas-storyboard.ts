import type { CanvasAssetOutput } from '@excuse/db'
import type { DashScopeClient } from '@excuse/provider'
import { runCanvasAssetStep, runStoryboardPhase } from '@excuse/canvas-runtime'
import { updateCanvasProject } from '@excuse/db'
import { createWorkerProviderAdapter, createWorkerRepoAdapter } from './canvas-adapter-factory'
import {
  getTextModel,
  loadRunnableCanvasProject,
} from './canvas-execution'

export interface CanvasStoryboardResult extends Record<string, unknown> {
  phase: 'storyboard'
  projectId: string
  shotsCreated: number
}

export async function executeCanvasStoryboard(
  projectId: string,
  client: DashScopeClient,
  runId?: string,
): Promise<CanvasStoryboardResult> {
  const detail = await loadRunnableCanvasProject(projectId)
  const project = detail.project
  if (!project.analysisJson)
    throw new Error('项目未分析')

  const textModel = getTextModel(project.modelPreferencesJson)
  const accountId = project.accountId
  const repo = createWorkerRepoAdapter()
  const provider = createWorkerProviderAdapter()

  const result = await runCanvasAssetStep<CanvasStoryboardResult>({
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
        analysis: project.analysisJson!,
        characters: detail.characters.map(character => ({
          id: character.id,
          name: character.name,
          identityPrompt: character.identityPrompt || '',
        })),
        locations: detail.locations.map(location => ({
          id: location.id,
          name: location.name,
          scenePrompt: location.scenePrompt || '',
        })),
        client,
        textModel,
        repo,
        textLlmDeps: provider,
      })
      const output: CanvasAssetOutput = { type: 'json', data: { shotsCount: shotsCreated.length, shots } }
      return {
        result: { phase: 'storyboard', projectId, shotsCreated: shotsCreated.length },
        output,
      }
    },
    repo,
  })

  await updateCanvasProject(projectId, { status: 'storyboard_ready' })

  return result
}
