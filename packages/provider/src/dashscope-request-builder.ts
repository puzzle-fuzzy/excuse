import type { InputMapping, ModelConfig } from '@excuse/shared'
import type { ValidatedModelParameters } from './model-validator'

/**
 * 声明式请求体构建器 — 与 DashScopeClient 解耦的纯函数。
 *
 * 根据 model-configs 中的 requestType + inputMapping 自动组装请求体，
 * 无需任何 model-name 分支判断。新增模型只需编辑 model-configs.ts。
 */

/**
 * 根据 inputMapping 遍历 params，把每个参数放入正确的请求体位置。
 * 返回 { input, parameters, media } 三个中间收集器。
 */
export function applyMappings(
  params: ValidatedModelParameters,
  inputMapping: Record<string, InputMapping>,
): {
  input: Record<string, unknown>
  parameters: Record<string, unknown>
  media: Array<{ type: string, url: string }>
} {
  const input: Record<string, unknown> = {}
  const parameters: Record<string, unknown> = {}
  const media: Array<{ type: string, url: string }> = []

  for (const [paramName, mapping] of Object.entries(inputMapping)) {
    const value = params[paramName]
    // 跳过未提供、null 的参数
    if (value === undefined || value === null)
      continue
    // 跳过空字符串
    if (typeof value === 'string' && value.trim() === '')
      continue
    // 保留 false / 0 等有意义的 falsy 值

    switch (mapping.target) {
      case 'prompt':
        input.prompt = value
        break
      case 'parameter':
        parameters[paramName] = value
        break
      case 'mediaField':
        input[mapping.field] = value
        break
      case 'media':
        media.push({ type: mapping.mediaType, url: value as string })
        break
      case 'ignored':
        break
    }
  }

  return { input, parameters, media }
}

/**
 * 根据 requestType 组装最终请求体
 */
export function buildRequestBody(
  modelConfig: ModelConfig,
  params: ValidatedModelParameters,
  referenceUrls?: string[],
): Record<string, unknown> {
  const { requestType, inputMapping } = modelConfig
  if (!inputMapping || !requestType) {
    throw new Error(`模型 ${modelConfig.id} 缺少 requestType 或 inputMapping 配置`)
  }

  const { input, parameters, media } = applyMappings(params, inputMapping)

  // referenceUrls → input.media[]（仅 r2v 等声明了 referenceMediaType 的模型）
  if (referenceUrls?.length && modelConfig.referenceMediaType) {
    for (const url of referenceUrls) {
      media.push({ type: modelConfig.referenceMediaType, url })
    }
  }

  switch (requestType) {
    case 'chat': {
      return {
        model: modelConfig.id,
        input: {
          messages: [{ role: 'user', content: input.prompt || '' }],
        },
        parameters: {
          ...parameters,
          result_format: 'message',
        },
      }
    }

    case 'image': {
      return {
        model: modelConfig.id,
        input: {
          messages: [{
            role: 'user',
            content: [{ text: input.prompt || '' }],
          }],
        },
        parameters,
      }
    }

    case 'video-t2v': {
      if (media.length > 0) {
        input.media = media
      }
      return {
        model: modelConfig.id,
        input,
        parameters,
      }
    }

    case 'openai-chat': {
      return {
        model: modelConfig.id,
        messages: [{ role: 'user', content: input.prompt || '' }],
        ...parameters,
      }
    }

    case 'video-media': {
      if (media.length > 0) {
        input.media = media
      }
      return {
        model: modelConfig.id,
        input,
        parameters,
      }
    }

    case 'audio': {
      return {
        model: modelConfig.id,
        input,
      }
    }

    default:
      throw new Error(`未知的 requestType: ${requestType}`)
  }
}
