import type { DashScopeClient } from '@excuse/provider'
import type { NovelAnalysis } from '@excuse/shared'
import type { RunTextLlmOnceDeps } from '../llm-helpers'
import { novelAnalysisSchema } from '@excuse/canvas-engine'
import {
  deleteCanvasCharactersByProject,
  deleteCanvasLocationsByProject,
  deleteCanvasShotsByProject,
  updateCanvasProject,
} from '@excuse/db'
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
  client: DashScopeClient
  textModel: string
  /** 测试用注入点；host 不传则用真实 provider。 */
  textLlmDeps?: RunTextLlmOnceDeps
}

export interface AnalysisPhaseResult {
  analysis: NovelAnalysis
}

export async function runAnalysisPhase(input: AnalysisPhaseInput): Promise<AnalysisPhaseResult> {
  if (input.isReanalysis) {
    await deleteCanvasShotsByProject(input.projectId)
    await deleteCanvasLocationsByProject(input.projectId, { excludeLocked: true })
    await deleteCanvasCharactersByProject(input.projectId, { excludeLocked: true })
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
  await updateCanvasProject(input.projectId, {
    status: 'analyzed',
    analysisJson: analysis,
  })

  return { analysis }
}
