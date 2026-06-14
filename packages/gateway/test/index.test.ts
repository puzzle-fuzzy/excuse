import { describe, expect, it } from 'bun:test'
import {
  createOpenAIChatResponse,
  createOpenAIError,
  createOpenAIModelsResponse,
  isOpenAIGatewayError,
  normalizeOpenAIChatRequest,
} from '../src'

describe('@excuse/gateway', () => {
  it('构造 OpenAI 兼容的错误响应', () => {
    expect(createOpenAIError('bad model', 'invalid_request_error', 'model_not_found', 404)).toEqual({
      response: {
        error: {
          message: 'bad model',
          type: 'invalid_request_error',
          code: 'model_not_found',
        },
      },
      status: 404,
    })
  })

  it('使用最后一条 user 消息归一化 chat 请求', () => {
    const result = normalizeOpenAIChatRequest({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'Be concise' },
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: 'second' },
      ],
      temperature: 0.3,
      max_tokens: 128,
      top_p: 0.8,
    })

    expect(isOpenAIGatewayError(result)).toBe(false)
    if (isOpenAIGatewayError(result))
      throw new Error('unexpected error')

    expect(result.internalModelId).toBe('qwen-max')
    expect(result.prompt).toBe('second')
    expect(result.parameters).toEqual({
      prompt: 'second',
      temperature: 0.3,
      max_tokens: 128,
      top_p: 0.8,
    })
  })

  it('拒绝流式请求', () => {
    const result = normalizeOpenAIChatRequest({
      model: 'qwen-max',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
    })

    expect(isOpenAIGatewayError(result)).toBe(true)
    expect(result).toMatchObject({ status: 400 })
  })

  it('拒绝缺少 user 消息的请求', () => {
    const result = normalizeOpenAIChatRequest({
      model: 'qwen-max',
      messages: [{ role: 'system', content: 'hello' }],
    })

    expect(isOpenAIGatewayError(result)).toBe(true)
    expect(result).toMatchObject({ status: 400 })
  })

  it('构造 OpenAI chat completion 响应', () => {
    expect(createOpenAIChatResponse({
      id: 'rec-1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      requestedModel: 'gpt-4',
      text: 'hello',
      inputTokens: 3,
      outputTokens: 5,
    })).toEqual({
      id: 'rec-1',
      object: 'chat.completion',
      created: 1767225600,
      model: 'gpt-4',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'hello' },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: 3,
        completion_tokens: 5,
        total_tokens: 8,
      },
    })
  })

  it('构造 OpenAI 模型列表响应', () => {
    const result = createOpenAIModelsResponse([{ id: 'qwen-max' }, { id: 'qwen-plus' }])

    expect(result.object).toBe('list')
    expect(result.data).toHaveLength(2)
    expect(result.data[0]).toMatchObject({
      id: 'qwen-max',
      object: 'model',
      owned_by: 'excuse',
    })
  })
})
