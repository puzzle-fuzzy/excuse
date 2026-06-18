import type { CanvasAssetOutput } from '@excuse/db'
import type { DashScopeClient } from '@excuse/provider'
import { generateCharacterEntity, runCanvasAssetStep } from '@excuse/canvas-runtime'
import {
  deleteCanvasCharactersByProject,
  deleteCanvasShotsByProject,
  getCanvasProjectById,
  updateCanvasProject,
} from '@excuse/db'
import { createWorkerProviderAdapter, createWorkerRepoAdapter } from './canvas-adapter-factory'
import {
  assertCanvasProjectNotGenerating,
  getTextModel,
} from './canvas-execution'

export interface CanvasCharactersResult extends Record<string, unknown> {
  phase: 'characters'
  projectId: string
  charactersCreated: number
  charactersFailed: number
}

export async function executeCanvasCharacters(
  projectId: string,
  client: DashScopeClient,
  runId?: string,
): Promise<CanvasCharactersResult> {
  const project = await getCanvasProjectById(projectId)
  if (!project || !project.analysisJson)
    throw new Error('项目不存在或未分析')
  assertCanvasProjectNotGenerating(project.status)

  const analysis = project.analysisJson
  const accountId = project.accountId
  const textModel = getTextModel(project.modelPreferencesJson)
  let charactersCreated = 0
  let charactersFailed = 0
  const repo = createWorkerRepoAdapter()
  const provider = createWorkerProviderAdapter()

  await deleteCanvasCharactersByProject(projectId, { excludeLocked: true })
  await deleteCanvasShotsByProject(projectId)

  for (const name of analysis.characterNames) {
    try {
      await runCanvasAssetStep({
        asset: {
          accountId,
          projectId,
          category: 'characterProfile',
          targetEntityType: 'project',
          targetEntityId: projectId,
          pipelineRunId: runId ?? undefined,
          model: textModel,
        },
        execute: async () => {
          const result = await generateCharacterEntity({ projectId, storyText: project.storyText, analysis, name, client, textModel, repo, textLlmDeps: provider })
          const output: CanvasAssetOutput = { type: 'json', data: { ...result.profile } }
          return {
            result: undefined,
            output,
          }
        },
        repo,
      })
      charactersCreated += 1
    }
    catch {
      charactersFailed += 1
    }
  }

  await updateCanvasProject(projectId, { status: 'characters_ready' })

  return {
    phase: 'characters',
    projectId,
    charactersCreated,
    charactersFailed,
  }
}
