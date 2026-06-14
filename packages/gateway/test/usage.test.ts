import { describe, expect, it } from 'bun:test'
import {
  aggregateGatewayUsage,
  mapGatewayUsageItem,
  type GatewayUsageRecordInput,
} from '../src'

/**
 * /v1/usage 聚合 + 单条映射的纯函数单元测试。
 *
 * 测试用例直接构造 GatewayUsageRecordInput[] 字面量，不需要 mock DB。
 */
function makeRecord(overrides: Partial<GatewayUsageRecordInput> = {}): GatewayUsageRecordInput {
  return {
    id: 'rec-1',
    model: 'qwen-max',
    status: 'succeeded',
    inputParams: { requestedModel: 'gpt-4o' },
    cost: { inputTokens: 100, outputTokens: 50, totalPriceCents: 12 },
    totalPriceCents: 12,
    errorMessage: null,
    createdAt: new Date('2024-06-13T00:00:00Z'),
    ...overrides,
  }
}

describe('mapGatewayUsageItem', () => {
  it('成功记录 + 完整 cost：totalTokens 求和，totalPriceCents 取 row 顶层', () => {
    const item = mapGatewayUsageItem(makeRecord())

    expect(item.id).toBe('rec-1')
    expect(item.model).toBe('qwen-max')
    expect(item.requestedModel).toBe('gpt-4o')
    expect(item.status).toBe('succeeded')
    expect(item.inputTokens).toBe(100)
    expect(item.outputTokens).toBe(50)
    expect(item.totalTokens).toBe(150)
    expect(item.totalPriceCents).toBe(12)
    expect(item.errorMessage).toBeNull()
    expect(item.createdAt).toBe('2024-06-13T00:00:00.000Z')
  })

  it('cost 为 null：inputTokens/outputTokens/totalTokens 全部 null，totalPriceCents 取 row.totalPriceCents', () => {
    const item = mapGatewayUsageItem(makeRecord({
      cost: null,
      totalPriceCents: 7,
    }))

    expect(item.inputTokens).toBeNull()
    expect(item.outputTokens).toBeNull()
    expect(item.totalTokens).toBeNull()
    expect(item.totalPriceCents).toBe(7)
  })

  it('inputTokens 为 null 但 outputTokens 有值：totalTokens 输出 null', () => {
    const item = mapGatewayUsageItem(makeRecord({
      cost: { inputTokens: null, outputTokens: 50, totalPriceCents: 12 },
    }))

    expect(item.inputTokens).toBeNull()
    expect(item.outputTokens).toBe(50)
    expect(item.totalTokens).toBeNull()
  })

  it('outputTokens 为 null 但 inputTokens 有值：totalTokens 输出 null', () => {
    const item = mapGatewayUsageItem(makeRecord({
      cost: { inputTokens: 100, outputTokens: null, totalPriceCents: 12 },
    }))

    expect(item.inputTokens).toBe(100)
    expect(item.outputTokens).toBeNull()
    expect(item.totalTokens).toBeNull()
  })

  it('requestedModel 是数字：输出 null', () => {
    const item = mapGatewayUsageItem(makeRecord({
      inputParams: { requestedModel: 42 },
    }))

    expect(item.requestedModel).toBeNull()
  })

  it('requestedModel 是对象：输出 null', () => {
    const item = mapGatewayUsageItem(makeRecord({
      inputParams: { requestedModel: { nested: 'gpt-4o' } },
    }))

    expect(item.requestedModel).toBeNull()
  })

  it('requestedModel 缺失：输出 null', () => {
    const item = mapGatewayUsageItem(makeRecord({
      inputParams: {},
    }))

    expect(item.requestedModel).toBeNull()
  })

  it('inputParams 为 null：requestedModel 输出 null', () => {
    const item = mapGatewayUsageItem(makeRecord({
      inputParams: null,
    }))

    expect(item.requestedModel).toBeNull()
  })

  it('createdAt 是 Date：输出 ISO 字符串', () => {
    const item = mapGatewayUsageItem(makeRecord({
      createdAt: new Date('2026-01-15T08:30:45.123Z'),
    }))

    expect(item.createdAt).toBe('2026-01-15T08:30:45.123Z')
    expect(typeof item.createdAt).toBe('string')
  })

  it('totalPriceCents 优先 row 顶层；当顶层为 null 时回落 cost.totalPriceCents', () => {
    const item = mapGatewayUsageItem(makeRecord({
      totalPriceCents: null,
      cost: { inputTokens: 100, outputTokens: 50, totalPriceCents: 99 },
    }))

    expect(item.totalPriceCents).toBe(99)
  })

  it('totalPriceCents 顶层和 cost 都为 null：回落 0', () => {
    const item = mapGatewayUsageItem(makeRecord({
      totalPriceCents: null,
      cost: { inputTokens: 100, outputTokens: 50, totalPriceCents: null },
    }))

    expect(item.totalPriceCents).toBe(0)
  })

  it('errorMessage 透传非空字符串', () => {
    const item = mapGatewayUsageItem(makeRecord({
      status: 'failed',
      errorMessage: 'DashScope error',
    }))

    expect(item.errorMessage).toBe('DashScope error')
  })
})

describe('aggregateGatewayUsage', () => {
  it('空数组：返回零值响应', () => {
    const result = aggregateGatewayUsage([])

    expect(result.totalCalls).toBe(0)
    expect(result.succeededCalls).toBe(0)
    expect(result.failedCalls).toBe(0)
    expect(result.totalTokens).toBe(0)
    expect(result.totalPriceCents).toBe(0)
    expect(result.items).toEqual([])
  })

  it('混合 status：succeeded/failed 各自计数，cancelled 不计入这两桶', () => {
    const result = aggregateGatewayUsage([
      makeRecord({ id: 'a', status: 'succeeded' }),
      makeRecord({ id: 'b', status: 'failed' }),
      makeRecord({ id: 'c', status: 'cancelled' }),
      makeRecord({ id: 'd', status: 'succeeded' }),
    ])

    expect(result.totalCalls).toBe(4)
    expect(result.succeededCalls).toBe(2)
    expect(result.failedCalls).toBe(1)
  })

  it('totalTokens 只累加两条 inputTokens+outputTokens 同时非 null 的记录', () => {
    const result = aggregateGatewayUsage([
      makeRecord({ id: 'a', cost: { inputTokens: 100, outputTokens: 50, totalPriceCents: 12 } }),
      // 部分缺失：不计入 totalTokens
      makeRecord({ id: 'b', cost: { inputTokens: null, outputTokens: 50, totalPriceCents: 0 } }),
      // 全 null：不计入
      makeRecord({ id: 'c', cost: null }),
      makeRecord({ id: 'd', cost: { inputTokens: 200, outputTokens: 100, totalPriceCents: 30 } }),
    ])

    expect(result.totalTokens).toBe(100 + 50 + 200 + 100)
  })

  it('totalPriceCents 优先 row.totalPriceCents 高于 cost.totalPriceCents', () => {
    const result = aggregateGatewayUsage([
      makeRecord({
        id: 'a',
        totalPriceCents: 100,
        cost: { inputTokens: 1, outputTokens: 1, totalPriceCents: 999 },
      }),
      makeRecord({
        id: 'b',
        totalPriceCents: null,
        cost: { inputTokens: 1, outputTokens: 1, totalPriceCents: 50 },
      }),
      makeRecord({
        id: 'c',
        totalPriceCents: null,
        cost: null,
      }),
    ])

    // a: 100 (row), b: 50 (cost fallback), c: 0 (both null)
    expect(result.totalPriceCents).toBe(100 + 50 + 0)
  })

  it('items 顺序与输入数组一致', () => {
    const result = aggregateGatewayUsage([
      makeRecord({ id: 'first' }),
      makeRecord({ id: 'second' }),
      makeRecord({ id: 'third' }),
    ])

    expect(result.items.map(i => i.id)).toEqual(['first', 'second', 'third'])
  })

  it('succeededCalls/failedCalls 严格按 status 字符串匹配，不误判 cancelled/processing', () => {
    const result = aggregateGatewayUsage([
      makeRecord({ id: 'a', status: 'processing' }),
      makeRecord({ id: 'b', status: 'submitting' }),
      makeRecord({ id: 'c', status: 'saving_output' }),
      makeRecord({ id: 'd', status: 'pending' }),
    ])

    expect(result.totalCalls).toBe(4)
    expect(result.succeededCalls).toBe(0)
    expect(result.failedCalls).toBe(0)
  })
})
