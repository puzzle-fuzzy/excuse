import type { ModelConfig } from '@excuse/shared'
import { ValidationError } from './app-errors'

/**
 * 各生成类别的 prompt 字符长度上限（docs/TODO.md §1.2）。
 *
 * 防止超长 prompt 导致：token 计费爆量（10MB 文本 ≈ 数百万 token）、
 * `inputParams` JSONB 表膨胀、预估费用严重低估而 reserve 不足 → 穿负。
 *
 * 取值依据：text 100k 字符仍在主流模型上下文内且成本可控；
 * image/video 的 prompt 本就是短描述，8k 足够。subtitle 无 prompt（用音频 URL）。
 */
export const PROMPT_LENGTH_LIMITS: Record<string, number> = {
  text: 100_000,
  image: 8_000,
  video: 8_000,
}

/**
 * 从 modelConfig.inputMapping 找到映射到 `target: 'prompt'` 的参数值。
 * 不同模型可能用不同 key（prompt / text），按 mapping.target 识别而非硬编码 key。
 */
export function getPromptValue(modelConfig: ModelConfig, params: Record<string, unknown>): string | undefined {
  for (const [key, mapping] of Object.entries(modelConfig.inputMapping ?? {})) {
    if (mapping.target === 'prompt') {
      const value = params[key]
      return typeof value === 'string' ? value : undefined
    }
  }
  return undefined
}

/**
 * 校验 prompt 长度不超类别上限，超出抛 ValidationError（422）。
 * 在 `validateAndMerge` 之后调用（params 已是合法参数）。
 */
export function assertPromptWithinLimit(modelConfig: ModelConfig, params: Record<string, unknown>): void {
  const limit = PROMPT_LENGTH_LIMITS[modelConfig.category]
  if (!limit)
    return // subtitle 等无 prompt 类别不限
  const prompt = getPromptValue(modelConfig, params)
  if (prompt && prompt.length > limit) {
    throw new ValidationError(
      `prompt 长度 ${prompt.length} 超过 ${modelConfig.category} 类别上限 ${limit} 字符`,
    )
  }
}

/**
 * 校验 OpenAI 兼容网关的 messages 总字符数（docs/TODO.md §1.2）。
 * 网关对外暴露（外部 API key），更需要限制防滥用。
 */
export const GATEWAY_MESSAGES_MAX_TOTAL_CHARS = 100_000

export function assertGatewayMessagesWithinLimit(messages: Array<{ content: string }>): void {
  let total = 0
  for (const msg of messages) {
    total += typeof msg.content === 'string' ? msg.content.length : 0
    if (total > GATEWAY_MESSAGES_MAX_TOTAL_CHARS) {
      throw new ValidationError(
        `messages 总长度超过上限 ${GATEWAY_MESSAGES_MAX_TOTAL_CHARS} 字符（当前 ${total}）`,
      )
    }
  }
}
