import { describe, expect, it } from 'bun:test'
import { gatewayUsageRecordSchema, openaiChatRequestSchema } from '../src/schemas'

describe('openaiChatRequestSchema', () => {
  it('接受有效的最小请求', () => {
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

  it('接受包含所有可选字段的请求', () => {
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

  it('拒绝非数组 messages', () => {
    const result = openaiChatRequestSchema.safeParse({
      model: 'gpt-4',
      messages: 'foo',
    })
    expect(result.success).toBe(false)
  })

  it('拒绝缺少 role 的 message', () => {
    const result = openaiChatRequestSchema.safeParse({
      model: 'gpt-4',
      messages: [{ content: 'hi' }],
    })
    expect(result.success).toBe(false)
  })

  it('拒绝缺少 content 的 message', () => {
    const result = openaiChatRequestSchema.safeParse({
      model: 'gpt-4',
      messages: [{ role: 'user' }],
    })
    expect(result.success).toBe(false)
  })

  it('拒绝未知的 role 枚举值', () => {
    const result = openaiChatRequestSchema.safeParse({
      model: 'gpt-4',
      messages: [{ role: 'developer', content: 'hi' }],
    })
    expect(result.success).toBe(false)
  })

  it('拒绝空 messages 数组（.min(1)）', () => {
    const result = openaiChatRequestSchema.safeParse({
      model: 'gpt-4',
      messages: [],
    })
    expect(result.success).toBe(false)
  })

  it('拒绝缺少 model', () => {
    const result = openaiChatRequestSchema.safeParse({
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(result.success).toBe(false)
  })

  it('拒绝字符串 temperature', () => {
    const result = openaiChatRequestSchema.safeParse({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: '0.5',
    })
    expect(result.success).toBe(false)
  })

  it('拒绝非正数 max_tokens', () => {
    const result = openaiChatRequestSchema.safeParse({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: -1,
    })
    expect(result.success).toBe(false)
  })

  it('拒绝浮点数 max_tokens（必须为整数）', () => {
    const result = openaiChatRequestSchema.safeParse({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1.5,
    })
    expect(result.success).toBe(false)
  })

  it('通过 .loose() 透传未知字段', () => {
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

  it('接受有效记录', () => {
    const result = gatewayUsageRecordSchema.safeParse(baseValid)
    expect(result.success).toBe(true)
  })

  it('接受 cost 为 null 的记录', () => {
    const result = gatewayUsageRecordSchema.safeParse({
      ...baseValid,
      cost: null,
      totalPriceCents: 7,
    })
    expect(result.success).toBe(true)
  })

  it('接受部分 cost（仅 inputTokens）的记录', () => {
    const result = gatewayUsageRecordSchema.safeParse({
      ...baseValid,
      cost: { inputTokens: 100 },
    })
    expect(result.success).toBe(true)
  })

  it('接受 inputParams 为 null 的记录', () => {
    const result = gatewayUsageRecordSchema.safeParse({
      ...baseValid,
      inputParams: null,
    })
    expect(result.success).toBe(true)
  })

  it('拒绝未知 status 枚举值的记录', () => {
    const result = gatewayUsageRecordSchema.safeParse({
      ...baseValid,
      status: 'unknown_status',
    })
    expect(result.success).toBe(false)
  })

  it('拒绝字符串 totalPriceCents 的记录', () => {
    const result = gatewayUsageRecordSchema.safeParse({
      ...baseValid,
      totalPriceCents: '12',
    })
    expect(result.success).toBe(false)
  })

  it('拒绝字符串 cost.inputTokens 的记录（类型守卫）', () => {
    const result = gatewayUsageRecordSchema.safeParse({
      ...baseValid,
      cost: { inputTokens: '100', outputTokens: 50 },
    })
    expect(result.success).toBe(false)
  })

  it('拒绝缺少 createdAt 的记录', () => {
    const { createdAt: _omit, ...rest } = baseValid
    const result = gatewayUsageRecordSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })
})
