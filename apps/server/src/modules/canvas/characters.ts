import type { CanvasAssetOutput, createCanvasCharacter } from '@excuse/db'
import { generateCharacterEntity, runCanvasAssetStep } from '@excuse/canvas-runtime'
import {
  deleteCanvasCharactersByProject,
  deleteCanvasShotsByProject,
  getCanvasProjectById,
  markPipelineRunRunning,
  markPipelineRunSucceeded,
  updateCanvasProject,
} from '@excuse/db'
import type { DashScopeClient } from '@excuse/provider'
import { getProjectDetail } from './service-crud'
import { assertNotGenerating, getTextModel, notifyNode } from './service-helpers'

type CharacterRow = Awaited<ReturnType<typeof createCanvasCharacter>>

export async function generateCharacters(projectId: string, client: DashScopeClient, runId?: string) {
  const project = await getCanvasProjectById(projectId)
  if (!project || !project.analysisJson)
    throw new Error('项目不存在或未分析')
  assertNotGenerating(project.status)

  const analysis = project.analysisJson!
  const accountId = project.accountId
  const textModel = getTextModel(project.modelPreferencesJson)

  if (runId)
    await markPipelineRunRunning(runId)

  await deleteCanvasCharactersByProject(projectId, { excludeLocked: true })
  await deleteCanvasShotsByProject(projectId)

  const created: CharacterRow[] = []
  for (const name of analysis.characterNames) {
    notifyNode(accountId, projectId, 'character', name, 'running', undefined, undefined, runId)

    try {
      const { character, profile } = await runCanvasAssetStep({
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
          const result = await generateCharacterEntity({ projectId, storyText: project.storyText, analysis, name, client, textModel })
          const output: CanvasAssetOutput = { type: 'json', data: { ...result.profile } }
          return { result, output }
        },
      })

      notifyNode(accountId, projectId, 'character', character.id, 'completed', { name: profile.name, profile }, undefined, runId)
      created.push(character)
    }
    catch (error) {
      const errorMessage = (error as Error).message
      notifyNode(accountId, projectId, 'character', name, 'failed', undefined, errorMessage, runId)
    }
  }

  await updateCanvasProject(projectId, { status: 'characters_ready' })
  if (runId)
    await markPipelineRunSucceeded(runId, { phase: 'characters', charactersCreated: created.length })
  return getProjectDetail(projectId)
}
