import { describe, expect, it } from 'bun:test'
import { gatewayUsageRecordSchema, openaiChatRequestSchema } from '../src/schemas'

describe('openaiChatRequestSchema', () => {
  it('accepts valid minimal request', () => {
    const valid = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
    }
    const result = openaiChatRequestSchema.safeParse(valid)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.model).toBe('gpt-4')
      expect(result.data.messages).toHaveLength(1)
      expect(result.data.messages[0]?.content).toBe('hi')
    }
  })

  it('accepts request with all optional fields', () => {
    const result = openaiChatRequestSchema.safeParse({
      model: 'gpt-4',
      messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }],
      temperature: 0.5,
      max_tokens: 1024,
      top_p: 0.9,
      stream: true,
    })
    expect(result.success).toBe(true)
  })

  it('rejects non-array messages', () => {
    const result = openaiChatRequestSchema.safeParse({
      model: 'gpt-4',
      messages: 'foo',
    })
    expect(result.success).toBe(false)
  })

  it('rejects message missing role', () => {
    const result = openaiChatRequestSchema.safeParse({
      model: 'gpt-4',
      messages: [{ content: 'hi' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects message missing content', () => {
    const result = openaiChatRequestSchema.safeParse({
      model: 'gpt-4',
      messages: [{ role: 'user' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects unknown role enum value', () => {
    const result = openaiChatRequestSchema.safeParse({
      model: 'gpt-4',
      messages: [{ role: 'developer', content: 'hi' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty messages array (.min(1))', () => {
    const result = openaiChatRequestSchema.safeParse({
      model: 'gpt-4',
      messages: [],
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing model', () => {
    const result = openaiChatRequestSchema.safeParse({
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects string temperature', () => {
    const result = openaiChatRequestSchema.safeParse({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: '0.5',
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-positive max_tokens', () => {
    const result = openaiChatRequestSchema.safeParse({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: -1,
    })
    expect(result.success).toBe(false)
  })

  it('rejects float max_tokens (must be int)', () => {
    const result = openaiChatRequestSchema.safeParse({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1.5,
    })
    expect(result.success).toBe(false)
  })

  it('preserves unknown fields via .loose() passthrough', () => {
    const result = openaiChatRequestSchema.safeParse({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
      unknown_param: 'foo',
      n: 2,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect((result.data as Record<string, unknown>).unknown_param).toBe('foo')
      expect((result.data as Record<string, unknown>).n).toBe(2)
    }
  })
})

describe('gatewayUsageRecordSchema', () => {
  const baseValid = {
    id: 'rec-1',
    model: 'qwen-max',
    status: 'succeeded',
    inputParams: { requestedModel: 'gpt-4o' },
    cost: { inputTokens: 100, outputTokens: 50, totalPriceCents: 12 },
    totalPriceCents: 12,
    errorMessage: null,
    createdAt: new Date('2024-06-13T00:00:00Z'),
  }

  it('accepts valid record', () => {
    const result = gatewayUsageRecordSchema.safeParse(baseValid)
    expect(result.success).toBe(true)
  })

  it('accepts record with null cost', () => {
    const result = gatewayUsageRecordSchema.safeParse({
      ...baseValid,
      cost: null,
      totalPriceCents: 7,
    })
    expect(result.success).toBe(true)
  })

  it('accepts record with partial cost (only inputTokens)', () => {
    const result = gatewayUsageRecordSchema.safeParse({
      ...baseValid,
      cost: { inputTokens: 100 },
    })
    expect(result.success).toBe(true)
  })

  it('accepts record with null inputParams', () => {
    const result = gatewayUsageRecordSchema.safeParse({
      ...baseValid,
      inputParams: null,
    })
    expect(result.success).toBe(true)
  })

  it('rejects record with unknown status enum value', () => {
    const result = gatewayUsageRecordSchema.safeParse({
      ...baseValid,
      status: 'unknown_status',
    })
    expect(result.success).toBe(false)
  })

  it('rejects record with string totalPriceCents', () => {
    const result = gatewayUsageRecordSchema.safeParse({
      ...baseValid,
      totalPriceCents: '12',
    })
    expect(result.success).toBe(false)
  })

  it('rejects record with string cost.inputTokens (type guard)', () => {
    const result = gatewayUsageRecordSchema.safeParse({
      ...baseValid,
      cost: { inputTokens: '100', outputTokens: 50 },
    })
    expect(result.success).toBe(false)
  })

  it('rejects record with missing createdAt', () => {
    const { createdAt: _omit, ...rest } = baseValid
    const result = gatewayUsageRecordSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })
})
