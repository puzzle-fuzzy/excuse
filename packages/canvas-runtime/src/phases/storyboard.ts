import type { DashScopeClient } from '@excuse/provider'
import type { NovelAnalysis, ShotDraft } from '@excuse/shared'
import type { RunTextLlmOnceDeps } from '../llm-helpers'
import { shotDraftsSchema } from '@excuse/canvas-engine'
import { batchCreateCanvasShots, deleteCanvasShotsByProject } from '@excuse/db'
import { buildStoryboardPrompt, parseLLMJsonWithSchema } from '@excuse/prompt-engine'
import { runTextLlmOnce } from '../llm-helpers'

type ShotRow = Awaited<ReturnType<typeof batchCreateCanvasShots>>[number]

/**
 * 分镜阶段共享核心（单次批量）：buildStoryboardPrompt → LLM(max_tokens 8000) → 校验
 * → 清空旧分镜 → 批量创建。项目状态 'storyboard_ready' 由 host 在 runCanvasAssetStep 之后写
 * （与原 server 一致；worker 原本写在 lambda 内，本次对齐到 lambda 外）。
 */
export interface StoryboardPhaseInput {
  projectId: string
  storyText: string
  analysis: NovelAnalysis
  characters: Array<{ id: string, name: string, identityPrompt: string }>
  locations: Array<{ id: string, name: string, scenePrompt: string }>
  client: DashScopeClient
  textModel: string
  /** 测试用注入点；host 不传则用真实 provider。 */
  textLlmDeps?: RunTextLlmOnceDeps
}

export interface StoryboardPhaseResult {
  shots: ShotDraft[]
  shotsCreated: ShotRow[]
}

export async function runStoryboardPhase(input: StoryboardPhaseInput): Promise<StoryboardPhaseResult> {
  const { system, prompt: userPrompt } = buildStoryboardPrompt(
    input.storyText,
    input.analysis,
    input.characters,
    input.locations,
  )
  const text = await runTextLlmOnce({
    client: input.client,
    textModel: input.textModel,
    systemPrompt: system,
    userPrompt,
    maxTokens: 8000,
    failureMessage: '分镜生成失败',
    deps: input.textLlmDeps,
  })

  const shots = parseLLMJsonWithSchema(text, shotDraftsSchema)

  await deleteCanvasShotsByProject(input.projectId)
  const shotsCreated = await batchCreateCanvasShots(shots.map(shot => ({
    projectId: input.projectId,
    shotIndex: shot.shotIndex,
    duration: shot.duration,
    locationId: shot.locationId,
    characterIdsJson: shot.characterIds,
    narrative: shot.narrative,
    cameraJson: shot.camera,
    continuityJson: shot.continuity,
    timelineJson: shot.timeline ?? null,
    environmentJson: shot.environment ?? null,
  })))

  return { shots, shotsCreated }
}
