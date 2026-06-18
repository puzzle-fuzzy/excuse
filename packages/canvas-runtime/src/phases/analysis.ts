import type { NovelAnalysis } from '@excuse/shared'
import type { CanvasRuntimeLlmClient, CanvasRuntimeRepoAdapter } from '../adapter-types'
import type { RunTextLlmOnceDeps } from '../llm-helpers'
import { novelAnalysisSchema } from '@excuse/canvas-engine'
import { buildAnalysisPrompt, parseLLMJsonWithSchema } from '@excuse/prompt-engine'
import { runTextLlmOnce } from '../llm-helpers'

/**
 * 分析阶段共享核心：可选级联清理（重新分析时）→ LLM 分析 → 校验 → 落库 analysisJson。
 * status:'analyzed' 与 analysisJson 同写在一次 updateCanvasProject —— 这是唯一在 core 内
 * 写项目状态的阶段（拆成两次写是行为变更，无收益）。
 */
export interface AnalysisPhaseInput {
  projectId: string
  storyText: string
  /** 重新分析（项目已分析过）时级联清理已有镜头/场景/角色，与原 server/worker 行为一致。 */
  isReanalysis: boolean
  client: CanvasRuntimeLlmClient
  textModel: string
  repo: CanvasRuntimeRepoAdapter
  /** 测试用注入点；host 不传则用真实 provider。 */
  textLlmDeps?: RunTextLlmOnceDeps
}

export interface AnalysisPhaseResult {
  analysis: NovelAnalysis
}

export async function runAnalysisPhase(input: AnalysisPhaseInput): Promise<AnalysisPhaseResult> {
  if (input.isReanalysis) {
    await input.repo.deleteCanvasShotsByProject(input.projectId)
    await input.repo.deleteCanvasLocationsByProject(input.projectId, { excludeLocked: true })
    await input.repo.deleteCanvasCharactersByProject(input.projectId, { excludeLocked: true })
  }

  const { system, prompt: userPrompt } = buildAnalysisPrompt(input.storyText)
  const text = await runTextLlmOnce({
    client: input.client,
    textModel: input.textModel,
    systemPrompt: system,
    userPrompt,
    maxTokens: 4096,
    failureMessage: '分析失败',
    deps: input.textLlmDeps,
  })

  const analysis = parseLLMJsonWithSchema(text, novelAnalysisSchema)
  await input.repo.updateCanvasProject(input.projectId, {
    status: 'analyzed',
    analysisJson: analysis,
  })

  return { analysis }
}
