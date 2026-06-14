import { describe, expect, it } from 'bun:test'
import {
  createOpenAIChatResponse,
  createOpenAIError,
  createOpenAIModelsResponse,
  createOpenAIStreamChunk,
  isOpenAIGatewayError,
  normalizeOpenAIChatRequest,
  OPENAI_GATEWAY_ERROR_CODES,
  OPENAI_STREAM_DONE,
  serializeOpenAIStreamChunk,
} from '../src'

describe('@excuse/gateway', () => {
  it('OPENAI_GATEWAY_ERROR_CODES 暴露所有公开错误码', () => {
    expect(OPENAI_GATEWAY_ERROR_CODES).toEqual({
      MODEL_NOT_FOUND: 'model_not_found',
      INVALID_MODEL: 'invalid_model',
      INVALID_PARAMETERS: 'invalid_parameters',
      INSUFFICIENT_BALANCE: 'insufficient_balance',
      GENERATION_FAILED: 'generation_failed',
      STREAM_NOT_SUPPORTED: 'stream_not_supported',
      STREAMING_MODEL_NOT_SUPPORTED: 'streaming_model_not_supported',
      MISSING_USER_MESSAGE: 'missing_user_message',
    })
  })

  it('构造 OpenAI 兼容的错误响应', () => {
    expect(createOpenAIError('bad model', 'invalid_request_error', OPENAI_GATEWAY_ERROR_CODES.MODEL_NOT_FOUND, 404)).toEqual({
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

  it('stream=true 时透传 stream 字段（route 层根据模型协议决定是否支持）', () => {
    const result = normalizeOpenAIChatRequest({
      model: 'qwen-max',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
    })

    expect(isOpenAIGatewayError(result)).toBe(false)
    if (isOpenAIGatewayError(result))
      throw new Error('unexpected error')
    expect(result.stream).toBe(true)
  })

  it('stream 字段缺省时为 false', () => {
    const result = normalizeOpenAIChatRequest({
      model: 'qwen-max',
      messages: [{ role: 'user', content: 'hello' }],
    })

    expect(isOpenAIGatewayError(result)).toBe(false)
    if (isOpenAIGatewayError(result))
      throw new Error('unexpected error')
    expect(result.stream).toBe(false)
  })

  it('拒绝缺少 user 消息的请求', () => {
    const result = normalizeOpenAIChatRequest({
      model: 'qwen-max',
      messages: [{ role: 'system', content: 'hello' }],
    })

    expect(isOpenAIGatewayError(result)).toBe(true)
    if (!isOpenAIGatewayError(result))
      throw new Error('expected error')
    expect(result.status).toBe(400)
    expect(result.response.error.code).toBe(OPENAI_GATEWAY_ERROR_CODES.MISSING_USER_MESSAGE)
  })

  it('多轮对话取最后一条 user 消息作为 prompt', () => {
    const result = normalizeOpenAIChatRequest({
      model: 'qwen-max',
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'mid' },
        { role: 'user', content: 'second' },
        { role: 'user', content: 'third' },
      ],
    })

    expect(isOpenAIGatewayError(result)).toBe(false)
    if (isOpenAIGatewayError(result))
      throw new Error('unexpected error')
    expect(result.prompt).toBe('third')
    expect(result.parameters.prompt).toBe('third')
  })

  it('未传入 temperature/max_tokens/top_p 时不进入 parameters', () => {
    const result = normalizeOpenAIChatRequest({
      model: 'qwen-max',
      messages: [{ role: 'user', content: 'hello' }],
    })

    expect(isOpenAIGatewayError(result)).toBe(false)
    if (isOpenAIGatewayError(result))
      throw new Error('unexpected error')
    expect(result.parameters).toEqual({ prompt: 'hello' })
    expect('temperature' in result.parameters).toBe(false)
    expect('max_tokens' in result.parameters).toBe(false)
    expect('top_p' in result.parameters).toBe(false)
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

  describe('createOpenAIStreamChunk', () => {
    const baseInput = {
      id: 'chatcmpl-1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      requestedModel: 'gpt-4',
      delta: 'hello',
    }

    it('首帧 isFirst=true：delta 带 role: assistant', () => {
      const chunk = createOpenAIStreamChunk({ ...baseInput, finishReason: null, isFirst: true })

      expect(chunk.object).toBe('chat.completion.chunk')
      expect(chunk.created).toBe(1767225600)
      expect(chunk.choices[0]?.delta).toEqual({ role: 'assistant', content: 'hello' })
      expect(chunk.choices[0]?.finish_reason).toBeNull()
      expect(chunk.usage).toBeUndefined()
    })

    it('非首帧 isFirst=false：delta 不带 role', () => {
      const chunk = createOpenAIStreamChunk({ ...baseInput, finishReason: null, isFirst: false })

      expect(chunk.choices[0]?.delta).toEqual({ content: 'hello' })
    })

    it('finishReason=stop：写入 choices[0].finish_reason', () => {
      const chunk = createOpenAIStreamChunk({ ...baseInput, delta: '', finishReason: 'stop', isFirst: false })

      expect(chunk.choices[0]?.finish_reason).toBe('stop')
    })

    it('finishReason=length', () => {
      const chunk = createOpenAIStreamChunk({ ...baseInput, delta: '', finishReason: 'length', isFirst: false })

      expect(chunk.choices[0]?.finish_reason).toBe('length')
    })

    it('usage 传入：输出 total_tokens 是 sum', () => {
      const chunk = createOpenAIStreamChunk({
        ...baseInput,
        delta: '',
        finishReason: 'stop',
        isFirst: false,
        usage: { prompt_tokens: 3, completion_tokens: 5 },
      })

      expect(chunk.usage).toEqual({ prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 })
    })

    it('usage 缺失：usage 字段为 undefined', () => {
      const chunk = createOpenAIStreamChunk({ ...baseInput, finishReason: null, isFirst: false })

      expect(chunk.usage).toBeUndefined()
    })
  })

  describe('serializeOpenAIStreamChunk + OPENAI_STREAM_DONE', () => {
    it('序列化首帧：含 role，整体形如 data: {...}\\n\\n', () => {
      const serialized = serializeOpenAIStreamChunk(createOpenAIStreamChunk({
        id: 'chatcmpl-1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        requestedModel: 'gpt-4',
        delta: 'hi',
        finishReason: null,
        isFirst: true,
      }))

      expect(serialized.startsWith('data: ')).toBe(true)
      expect(serialized.endsWith('\n\n')).toBe(true)
      const json = serialized.slice('data: '.length, -2)
      const parsed = JSON.parse(json) as { object: string, choices: Array<{ delta: { role?: string, content?: string } }> }
      expect(parsed.object).toBe('chat.completion.chunk')
      expect(parsed.choices[0]?.delta.role).toBe('assistant')
      expect(parsed.choices[0]?.delta.content).toBe('hi')
    })

    it('OPENAI_STREAM_DONE 形如 data: [DONE]\\n\\n', () => {
      expect(OPENAI_STREAM_DONE).toBe('data: [DONE]\n\n')
    })
  })
})
