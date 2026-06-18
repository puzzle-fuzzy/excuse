import type { CanvasRuntimeLlmClient, CanvasRuntimeProviderAdapter } from './adapter-types'

/**
 * 文本 LLM 单次调用共享内核：构建 prompt → 校验参数 → 调用 chat → 返回原始文本。
 * server 与 worker 的 4 个文本阶段（analysis/characters/locations/storyboard）原本各自复制
 * 了 getModelById + validateAndMerge + chatCompletion + 错误格式化这一整段；本函数收口。
 *
 * 解析与 schema 校验（parseLLMJson + validateX）留在各 phase core 内，
 * 因为每个阶段的校验器与目标类型不同，与对应类型同处一文件更清晰。
 */
export interface RunTextLlmOnceDeps {
  getModelById: CanvasRuntimeProviderAdapter['getModelById']
  validateAndMerge: CanvasRuntimeProviderAdapter['validateAndMerge']
}

export interface RunTextLlmOnceInput {
  client: CanvasRuntimeLlmClient
  textModel: string
  systemPrompt: string
  userPrompt: string
  maxTokens: number
  temperature?: number
  failureMessage: string
  deps?: RunTextLlmOnceDeps
}

export async function runTextLlmOnce(input: RunTextLlmOnceInput): Promise<string> {
  const deps = input.deps
  if (!deps) {
    throw new Error('runTextLlmOnce requires deps (provider adapter) — inject via textLlmDeps parameter')
  }
  const modelConfig = deps.getModelById(input.textModel)
  if (!modelConfig)
    throw new Error(`未知文本模型：${input.textModel}`)

  const rawParams: Record<string, unknown> = {
    prompt: `${input.systemPrompt}\n\n${input.userPrompt}`,
    max_tokens: input.maxTokens,
    temperature: input.temperature ?? 0.7,
  }
  const validationResult = deps.validateAndMerge(modelConfig, rawParams)
  if (!validationResult.ok) {
    const detail = validationResult.errors.map(error => `${error.field}: ${error.message}`).join('; ')
    throw new Error(`参数校验失败：${detail}`)
  }

  const result = await input.client.chatCompletion(input.textModel, validationResult.params)
  if (result.type === 'failed') {
    // 透传 provider 传输层错误码（TIMEOUT/ECONNRESET）给 task-engine，进入可重试分类
    const err = new Error(result.error || input.failureMessage)
    if (result.code)
      (err as Error & { cause?: { code?: string } }).cause = { code: result.code }
    throw err
  }

  return result.output.text as string
}
