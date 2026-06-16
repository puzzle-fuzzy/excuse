import type { OpenAIChatRequest } from '@excuse/shared'
import { describe, expect, it } from 'bun:test'
import {
  createOpenAIChatResponse,
  createOpenAIError,
  createOpenAIModelsResponse,
  createOpenAIStreamChunk,
  generationFailedError,
  insufficientBalanceError,
  invalidModelError,
  invalidParametersError,
  isOpenAIGatewayError,
  missingUserMessageError,
  modelNotFoundError,
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
      API_KEY_SCOPE_NOT_ALLOWED: 'api_key_scope_not_allowed',
      API_KEY_QUOTA_EXCEEDED: 'api_key_quota_exceeded',
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

  describe('error factories', () => {
    it('modelNotFoundError → 404 MODEL_NOT_FOUND，message 含 model 名，type=invalid_request_error', () => {
      const err = modelNotFoundError('qwen-max')

      expect(err.status).toBe(404)
      expect(err.response.error.code).toBe(OPENAI_GATEWAY_ERROR_CODES.MODEL_NOT_FOUND)
      expect(err.response.error.message).toBe('Model \'qwen-max\' not found')
      expect(err.response.error.type).toBe('invalid_request_error')
    })

    it('invalidModelError → 400 INVALID_MODEL，message 含 model 名', () => {
      const err = invalidModelError('wanx-v1')

      expect(err.status).toBe(400)
      expect(err.response.error.code).toBe(OPENAI_GATEWAY_ERROR_CODES.INVALID_MODEL)
      expect(err.response.error.message).toBe('Model \'wanx-v1\' is not a text model')
      expect(err.response.error.type).toBe('invalid_request_error')
    })

    it('invalidParametersError → 400 INVALID_PARAMETERS，message 用 "field: message; ..." 拼接', () => {
      const err = invalidParametersError([
        { field: 'temperature', message: 'must be >= 0' },
        { field: 'max_tokens', message: 'must be <= 4096' },
      ])

      expect(err.status).toBe(400)
      expect(err.response.error.code).toBe(OPENAI_GATEWAY_ERROR_CODES.INVALID_PARAMETERS)
      expect(err.response.error.message).toBe('temperature: must be >= 0; max_tokens: must be <= 4096')
      expect(err.response.error.type).toBe('invalid_request_error')
    })

    it('invalidParametersError 空数组 → message 为空字符串但仍 400', () => {
      const err = invalidParametersError([])

      expect(err.status).toBe(400)
      expect(err.response.error.code).toBe(OPENAI_GATEWAY_ERROR_CODES.INVALID_PARAMETERS)
      expect(err.response.error.message).toBe('')
    })

    it('missingUserMessageError → 400 MISSING_USER_MESSAGE', () => {
      const err = missingUserMessageError()

      expect(err.status).toBe(400)
      expect(err.response.error.code).toBe(OPENAI_GATEWAY_ERROR_CODES.MISSING_USER_MESSAGE)
      expect(err.response.error.message).toBe('No user message provided')
      expect(err.response.error.type).toBe('invalid_request_error')
    })

    it('insufficientBalanceError → 402 INSUFFICIENT_BALANCE，type=insufficient_quota', () => {
      const err = insufficientBalanceError()

      expect(err.status).toBe(402)
      expect(err.response.error.code).toBe(OPENAI_GATEWAY_ERROR_CODES.INSUFFICIENT_BALANCE)
      expect(err.response.error.type).toBe('insufficient_quota')
      expect(err.response.error.message).toBe('Insufficient balance to complete the request')
    })

    it('generationFailedError → 500 GENERATION_FAILED，message 透传上游错误', () => {
      const err = generationFailedError('upstream timeout')

      expect(err.status).toBe(500)
      expect(err.response.error.code).toBe(OPENAI_GATEWAY_ERROR_CODES.GENERATION_FAILED)
      expect(err.response.error.message).toBe('upstream timeout')
      expect(err.response.error.type).toBe('server_error')
    })

    it('所有工厂返回值符合 OpenAIGatewayError 结构（response.error 形状）', () => {
      const factories = [
        modelNotFoundError('m'),
        invalidModelError('m'),
        invalidParametersError([{ field: 'f', message: 'msg' }]),
        missingUserMessageError(),
        insufficientBalanceError(),
        generationFailedError('msg'),
      ]

      for (const err of factories) {
        expect(isOpenAIGatewayError(err)).toBe(true)
        expect(typeof err.status).toBe('number')
        expect(err.response).toHaveProperty('error')
        expect(err.response.error).toHaveProperty('message')
        expect(err.response.error).toHaveProperty('type')
        expect(err.response.error).toHaveProperty('code')
      }
    })

    it('工厂自动填充 hint（classifyRecovery suggestion）', () => {
      const err = modelNotFoundError('qwen-max')
      expect(err.response.error.hint).toBeTruthy()
      expect(typeof err.response.error.hint).toBe('string')
      // insufficient_balance → balance 域，hint 为充值建议
      const balErr = insufficientBalanceError()
      expect(balErr.response.error.hint).toContain('充值')
      // generation_failed → provider 域（无具体码），从文案分类
      const genErr = generationFailedError('模型推理异常')
      expect(genErr.response.error.hint).toBeTruthy()
    })
  })

  describe('normalizeOpenAIChatRequest — zod runtime guard', () => {
    it('非数组 messages 返回 invalid_parameters', () => {
      const result = normalizeOpenAIChatRequest({
        model: 'gpt-4',
        messages: 'foo',
      } as unknown as OpenAIChatRequest)

      expect(isOpenAIGatewayError(result)).toBe(true)
      if (!isOpenAIGatewayError(result))
        throw new Error('expected error')
      expect(result.status).toBe(400)
      expect(result.response.error.code).toBe(OPENAI_GATEWAY_ERROR_CODES.INVALID_PARAMETERS)
      expect(result.response.error.message).toContain('messages')
    })

    it('message 缺少 role 返回 invalid_parameters', () => {
      const result = normalizeOpenAIChatRequest({
        model: 'gpt-4',
        messages: [{ content: 'hi' }],
      } as unknown as OpenAIChatRequest)

      expect(isOpenAIGatewayError(result)).toBe(true)
      if (!isOpenAIGatewayError(result))
        throw new Error('expected error')
      expect(result.response.error.code).toBe(OPENAI_GATEWAY_ERROR_CODES.INVALID_PARAMETERS)
    })

    it('字符串 temperature 返回 invalid_parameters', () => {
      const result = normalizeOpenAIChatRequest({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
        temperature: '0.5',
      } as unknown as OpenAIChatRequest)

      expect(isOpenAIGatewayError(result)).toBe(true)
      if (!isOpenAIGatewayError(result))
        throw new Error('expected error')
      expect(result.response.error.code).toBe(OPENAI_GATEWAY_ERROR_CODES.INVALID_PARAMETERS)
      expect(result.response.error.message).toContain('temperature')
    })

    it('拒绝空 messages 数组', () => {
      const result = normalizeOpenAIChatRequest({
        model: 'gpt-4',
        messages: [],
      } as unknown as OpenAIChatRequest)

      expect(isOpenAIGatewayError(result)).toBe(true)
      if (!isOpenAIGatewayError(result))
        throw new Error('expected error')
      expect(result.response.error.code).toBe(OPENAI_GATEWAY_ERROR_CODES.INVALID_PARAMETERS)
    })

    it('未知 message role 返回 invalid_parameters', () => {
      const result = normalizeOpenAIChatRequest({
        model: 'gpt-4',
        messages: [{ role: 'developer', content: 'hi' }],
      } as unknown as OpenAIChatRequest)

      expect(isOpenAIGatewayError(result)).toBe(true)
      if (!isOpenAIGatewayError(result))
        throw new Error('expected error')
      expect(result.response.error.code).toBe(OPENAI_GATEWAY_ERROR_CODES.INVALID_PARAMETERS)
    })

    it('成功路径透传未知 OpenAI 字段（.loose() passthrough）', () => {
      const request = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
        n: 2,
        presence_penalty: 0.5,
      } as unknown as OpenAIChatRequest
      const result = normalizeOpenAIChatRequest(request)

      expect(isOpenAIGatewayError(result)).toBe(false)
      if (isOpenAIGatewayError(result))
        throw new Error('unexpected error')
      // request 引用透传保留（route 可继续访问原对象未知字段）
      expect((result.request as Record<string, unknown>).n).toBe(2)
      expect(result.prompt).toBe('hi')
    })

    it('有效 messages 但无 user role 时返回 missing_user_message', () => {
      const result = normalizeOpenAIChatRequest({
        model: 'gpt-4',
        messages: [{ role: 'system', content: 'sys' }],
      })

      expect(isOpenAIGatewayError(result)).toBe(true)
      if (!isOpenAIGatewayError(result))
        throw new Error('expected error')
      // schema 通过但缺少 user → missing_user_message（与 schema 失败的 invalid_parameters 区分）
      expect(result.response.error.code).toBe(OPENAI_GATEWAY_ERROR_CODES.MISSING_USER_MESSAGE)
    })

    it('multiple zod issues concatenated into one invalid_parameters message', () => {
      const result = normalizeOpenAIChatRequest({
        model: 42,
        messages: 'foo',
        temperature: 'bar',
      } as unknown as OpenAIChatRequest)

      expect(isOpenAIGatewayError(result)).toBe(true)
      if (!isOpenAIGatewayError(result))
        throw new Error('expected error')
      expect(result.response.error.code).toBe(OPENAI_GATEWAY_ERROR_CODES.INVALID_PARAMETERS)
      // 至少 2 个 issue 被拼接（model + messages + temperature）
      expect(result.response.error.message).toContain(';')
    })
  })
})
