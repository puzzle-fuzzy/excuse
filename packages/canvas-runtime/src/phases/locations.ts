import type { DashScopeClient } from '@excuse/provider'
import type { LocationProfile, NovelAnalysis } from '@excuse/shared'
import type { RunTextLlmOnceDeps } from '../llm-helpers'
import { locationProfileSchema } from '@excuse/canvas-engine'
import { createCanvasLocation } from '@excuse/db'
import { buildLocationPrompt, parseLLMJsonWithSchema } from '@excuse/prompt-engine'
import { runTextLlmOnce } from '../llm-helpers'

type LocationRow = Awaited<ReturnType<typeof createCanvasLocation>>

/**
 * 场景档案单实体核心：buildLocationPrompt → LLM → 校验 → createCanvasLocation。
 * 返回创建的行 —— 修复了 server locations.ts 原本用 name 而非 location.id 做 completed 通知的 bug。
 */
export interface LocationEntityInput {
  projectId: string
  storyText: string
  analysis: NovelAnalysis
  name: string
  client: DashScopeClient
  textModel: string
  /** 测试用注入点；host 不传则用真实 provider。 */
  textLlmDeps?: RunTextLlmOnceDeps
}

export interface LocationEntityResult {
  location: LocationRow
  profile: LocationProfile
}

export async function generateLocationEntity(input: LocationEntityInput): Promise<LocationEntityResult> {
  const { system, prompt: userPrompt } = buildLocationPrompt(input.storyText, input.analysis, input.name)
  const text = await runTextLlmOnce({
    client: input.client,
    textModel: input.textModel,
    systemPrompt: system,
    userPrompt,
    maxTokens: 4096,
    failureMessage: '场景档案生成失败',
    deps: input.textLlmDeps,
  })

  const profile = parseLLMJsonWithSchema(text, locationProfileSchema)
  const location = await createCanvasLocation({
    projectId: input.projectId,
    name: profile.name || input.name,
    type: profile.type,
    profileJson: profile,
    scenePrompt: profile.scenePrompt,
    negativePrompt: profile.negativePrompt,
  })

  return { location, profile }
}
