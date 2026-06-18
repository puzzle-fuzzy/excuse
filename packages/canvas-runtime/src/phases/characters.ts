import type { CharacterProfile, NovelAnalysis } from '@excuse/shared'
import type { CanvasRuntimeLlmClient, CanvasRuntimeRepoAdapter } from '../adapter-types'
import type { RunTextLlmOnceDeps } from '../llm-helpers'
import { characterProfileSchema } from '@excuse/canvas-engine'
import { buildCharacterPrompt, parseLLMJsonWithSchema } from '@excuse/prompt-engine'
import { runTextLlmOnce } from '../llm-helpers'

type CharacterRow = Awaited<ReturnType<CanvasRuntimeRepoAdapter['createCanvasCharacter']>>

/**
 * 角色档案单实体核心：buildCharacterPrompt → LLM → 校验 → createCanvasCharacter。
 * 这是按 name 循环、每个角色一个 asset 的高频漂移片段；host 保留循环、per-entity asset/notify、
 * try/catch + 计数。返回创建的行，host 用 character.id 做 completed 通知。
 */
export interface CharacterEntityInput {
  projectId: string
  storyText: string
  analysis: NovelAnalysis
  name: string
  client: CanvasRuntimeLlmClient
  textModel: string
  repo: CanvasRuntimeRepoAdapter
  /** 测试用注入点；host 不传则用真实 provider。 */
  textLlmDeps?: RunTextLlmOnceDeps
}

export interface CharacterEntityResult {
  character: CharacterRow
  profile: CharacterProfile
}

export async function generateCharacterEntity(input: CharacterEntityInput): Promise<CharacterEntityResult> {
  const { system, prompt: userPrompt } = buildCharacterPrompt(input.storyText, input.analysis, input.name)
  const text = await runTextLlmOnce({
    client: input.client,
    textModel: input.textModel,
    systemPrompt: system,
    userPrompt,
    maxTokens: 4096,
    failureMessage: '角色档案生成失败',
    deps: input.textLlmDeps,
  })

  const profile = parseLLMJsonWithSchema(text, characterProfileSchema)
  const character = await input.repo.createCanvasCharacter({
    projectId: input.projectId,
    name: profile.name || input.name,
    role: profile.role,
    description: `${profile.age} ${profile.gender} ${profile.bodyShape}`,
    identityPrompt: profile.identityPrompt,
    negativePrompt: profile.negativePrompt,
    profileJson: profile,
  })

  return { character, profile }
}
