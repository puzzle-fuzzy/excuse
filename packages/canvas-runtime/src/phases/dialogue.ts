/**
 * 对话层生成阶段 — Phase 8.5
 *
 * 输入：storyboard + characters → LLM 为每个 shot 生成对白/音效/环境音
 * 输出：dialoguePrompt（文本）+ dialogueJson（结构化 JSON）
 */

import type { DashScopeClient } from '@excuse/provider'
import type { CanvasProjectDetail } from '../normalize'
import { buildDialogueSystemPrompt, buildDialogueUserPrompt, type DialogueInput } from '@excuse/prompt-engine'
import { getModelById, validateAndMerge } from '@excuse/provider'

export interface DialoguePhaseInput {
  projectId: string
  detail: CanvasProjectDetail
  client: DashScopeClient
  textModel: string
}

export interface ShotDialogueResult {
  shotId: string
  dialoguePrompt: string | null
  dialogueJson: Record<string, unknown> | null
}

export interface DialoguePhaseResult {
  results: ShotDialogueResult[]
}

/**
 * 为项目所有镜头生成对话层数据
 *
 * 每个镜头独立调用 LLM，失败镜头不影响其他镜头。
 */
export async function runDialoguePhase(input: DialoguePhaseInput): Promise<DialoguePhaseResult> {
  const results: ShotDialogueResult[] = []

  for (const shot of input.detail.shots) {
    if (!shot.narrative) {
      results.push({ shotId: shot.id, dialoguePrompt: null, dialogueJson: null })
      continue
    }

    const dialogueInput: DialogueInput = {
      narrative: shot.narrative,
      characters: resolveShotCharacters(shot.characterIdsJson ?? [], input.detail.characters),
      location: shot.locationId
        ? resolveSceneLocation(shot.locationId, input.detail.locations)
        : null,
      environment: shot.environmentJson,
    }

    const system = buildDialogueSystemPrompt()
    const userPrompt = buildDialogueUserPrompt(dialogueInput)
    const fullPrompt = `${system}\n\n${userPrompt}`

    try {
      const modelConfig = getModelById(input.textModel)
      if (!modelConfig) {
        results.push({ shotId: shot.id, dialoguePrompt: null, dialogueJson: null })
        continue
      }
      const validation = validateAndMerge(modelConfig, { prompt: fullPrompt, max_tokens: 4096, temperature: 0.7 })
      if (!validation.ok) {
        results.push({ shotId: shot.id, dialoguePrompt: null, dialogueJson: null })
        continue
      }
      const result = await input.client.chatCompletion(input.textModel, validation.params)

      if (result.type === 'failed' || !result.output?.text) {
        results.push({ shotId: shot.id, dialoguePrompt: null, dialogueJson: null })
        continue
      }

      const rawText = result.output.text as string
      let dialogueJson: Record<string, unknown> | null = null
      try {
        // 尝试从 LLM 输出中提取 JSON
        const jsonMatch = rawText.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          dialogueJson = JSON.parse(jsonMatch[0])
        }
      }
      catch {
        dialogueJson = null
      }

      results.push({
        shotId: shot.id,
        dialoguePrompt: rawText,
        dialogueJson,
      })
    }
    catch {
      results.push({ shotId: shot.id, dialoguePrompt: null, dialogueJson: null })
    }
  }

  return { results }
}

function resolveShotCharacters(characterIds: string[], characters: CanvasProjectDetail['characters']) {
  const map = new Map(characters.map(c => [c.id, c]))
  return characterIds.map(id => map.get(id)).filter(Boolean).map(c => ({
    id: c!.id,
    name: c!.name,
    identityPrompt: c!.identityPrompt,
    profileJson: c!.profileJson,
  }))
}

function resolveSceneLocation(locationId: string, locations: CanvasProjectDetail['locations']) {
  const loc = locations.find(l => l.id === locationId)
  if (!loc) return null
  return {
    name: loc.name,
    scenePrompt: loc.scenePrompt,
    profileJson: loc.profileJson,
  }
}
