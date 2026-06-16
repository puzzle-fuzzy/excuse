import type { ProviderModelHealth } from '@excuse/shared'
import { describe, expect, it } from 'bun:test'
import {
  applyProviderOutcome,
  DEFAULT_DEGRADATION_CONFIG,
  degradedRemainingMs,
  freshModelHealth,
  isDegraded,
  resolveDegradationConfig,
} from '../src'

const CONFIG = { failureThreshold: 3, cooldownMs: 60_000 }
const T0 = 1_700_000_000_0

function fail(model: string, ts: number, state: ProviderModelHealth | null, message = 'boom') {
  return applyProviderOutcome(state, { model, success: false, errorMessage: message, ts }, CONFIG)
}
function ok(model: string, ts: number, state: ProviderModelHealth | null) {
  return applyProviderOutcome(state, { model, success: true, ts }, CONFIG)
}

describe('@excuse/provider-health · applyProviderOutcome', () => {
  it('首次失败不降级，累计计数', () => {
    const { record, transitionedTo } = fail('qwen-max', T0, null)
    expect(record.status).toBe('healthy')
    expect(record.consecutiveFailures).toBe(1)
    expect(record.totalFailures).toBe(1)
    expect(record.degradedUntil).toBeNull()
    expect(transitionedTo).toBeUndefined()
  })

  it('达到阈值跳变到 degraded 并设置冷却窗口', () => {
    let state: ProviderModelHealth | null = null
    state = fail('qwen-max', T0, state).record
    state = fail('qwen-max', T0 + 1, state).record
    const res = fail('qwen-max', T0 + 2, state)
    expect(res.record.status).toBe('degraded')
    expect(res.record.consecutiveFailures).toBe(3)
    expect(res.record.degradedUntil).toBe(T0 + 2 + CONFIG.cooldownMs)
    expect(res.record.degradedReason).toContain('连续失败 3 次')
    expect(res.transitionedTo).toBe('degraded')
  })

  it('冷却期内的重复失败不延长窗口、不重复触发跳变', () => {
    let state: ProviderModelHealth | null = null
    for (let i = 0; i < 3; i++)
      state = fail('qwen-max', T0 + i, state).record
    const firstWindow = state!.degradedUntil
    // 仍在冷却期内（窗口未过期）再来一次失败
    const res = fail('qwen-max', T0 + 10, state)
    expect(res.record.degradedUntil).toBe(firstWindow)
    expect(res.transitionedTo).toBeUndefined()
    expect(res.record.consecutiveFailures).toBe(4)
  })

  it('成功清零计数并从 degraded 恢复（degraded→healthy 跳变）', () => {
    let state: ProviderModelHealth | null = null
    for (let i = 0; i < 3; i++)
      state = fail('qwen-max', T0 + i, state).record
    expect(state!.status).toBe('degraded')
    const res = ok('qwen-max', T0 + 100, state)
    expect(res.record.status).toBe('healthy')
    expect(res.record.consecutiveFailures).toBe(0)
    expect(res.record.totalSuccesses).toBe(1)
    expect(res.record.degradedUntil).toBeNull()
    expect(res.transitionedTo).toBe('healthy')
  })

  it('健康态成功不产生跳变', () => {
    const state = ok('qwen-max', T0, null).record
    const res = ok('qwen-max', T0 + 1, state)
    expect(res.transitionedTo).toBeUndefined()
    expect(res.record.totalSuccesses).toBe(2)
  })

  it('冷却过期后半开探测：成功恢复', () => {
    let state: ProviderModelHealth | null = null
    for (let i = 0; i < 3; i++)
      state = fail('qwen-max', T0 + i, state).record
    // 冷却已过（ts 远超 degradedUntil）
    const probeAt = state!.degradedUntil! + 5_000
    const res = ok('qwen-max', probeAt, state)
    expect(res.record.status).toBe('healthy')
    expect(res.transitionedTo).toBe('healthy')
  })

  it('冷却过期后半开探测：失败沿用累计计数并重新降级（刷新窗口）', () => {
    let state: ProviderModelHealth | null = null
    for (let i = 0; i < 3; i++)
      state = fail('qwen-max', T0 + i, state).record
    const probeAt = state!.degradedUntil! + 5_000
    const res = fail('qwen-max', probeAt, state)
    expect(res.record.status).toBe('degraded')
    expect(res.record.consecutiveFailures).toBe(4)
    // 窗口被刷新到探测时刻 + cooldown
    expect(res.record.degradedUntil).toBe(probeAt + CONFIG.cooldownMs)
    expect(res.transitionedTo).toBe('degraded')
  })

  it('阈值边界：failureThreshold-1 次失败保持健康', () => {
    let state: ProviderModelHealth | null = null
    for (let i = 0; i < CONFIG.failureThreshold - 1; i++)
      state = fail('qwen-max', T0 + i, state).record
    expect(state!.status).toBe('healthy')
    expect(state!.consecutiveFailures).toBe(CONFIG.failureThreshold - 1)
  })
})

describe('@excuse/provider-health · isDegraded / degradedRemainingMs', () => {
  it('healthy / null 不阻断', () => {
    expect(isDegraded(null, T0)).toBe(false)
    expect(isDegraded(freshModelHealth('m', T0), T0)).toBe(false)
  })

  it('degraded 且在窗口内阻断，过期不阻断', () => {
    const { record } = applyProviderOutcome(
      null,
      { model: 'm', success: false, errorMessage: 'x', ts: T0 },
      { failureThreshold: 1, cooldownMs: 10_000 },
    )
    expect(isDegraded(record, T0)).toBe(true)
    expect(isDegraded(record, T0 + 5_000)).toBe(true)
    expect(isDegraded(record, T0 + 10_000)).toBe(false)
  })

  it('degradedRemainingMs 随时间递减至 0', () => {
    const { record } = applyProviderOutcome(
      null,
      { model: 'm', success: false, errorMessage: 'x', ts: T0 },
      { failureThreshold: 1, cooldownMs: 10_000 },
    )
    expect(degradedRemainingMs(record, T0)).toBe(10_000)
    expect(degradedRemainingMs(record, T0 + 4_000)).toBe(6_000)
    expect(degradedRemainingMs(record, T0 + 10_000)).toBe(0)
  })
})

describe('@excuse/provider-health · resolveDegradationConfig', () => {
  it('缺省回落默认值', () => {
    const cfg = resolveDegradationConfig({})
    expect(cfg).toEqual(DEFAULT_DEGRADATION_CONFIG)
  })

  it('合法覆盖', () => {
    const cfg = resolveDegradationConfig({
      PROVIDER_DEGRADATION_FAILURE_THRESHOLD: '5',
      PROVIDER_DEGRADATION_COOLDOWN_MS: '120000',
    })
    expect(cfg.failureThreshold).toBe(5)
    expect(cfg.cooldownMs).toBe(120_000)
  })

  it('非法值回落默认', () => {
    const cfg = resolveDegradationConfig({
      PROVIDER_DEGRADATION_FAILURE_THRESHOLD: 'oops',
      PROVIDER_DEGRADATION_COOLDOWN_MS: '-1',
    })
    expect(cfg).toEqual(DEFAULT_DEGRADATION_CONFIG)
  })
})
