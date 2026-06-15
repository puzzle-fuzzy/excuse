import { afterEach, describe, expect, it } from 'bun:test'
import { COOLDOWN_MS, getCooldownSize, resetCooldowns, shouldSend } from '../src/services/notification-cooldown'

afterEach(() => {
  resetCooldowns()
})

describe('shouldSend', () => {
  it('首次调用总是返回 true', () => {
    expect(shouldSend('user-1', 'task_completed', 'rec-1', 5000)).toBe(true)
  })

  it('冷却期内再次调用返回 false', () => {
    expect(shouldSend('user-1', 'task_completed', 'rec-1', 5000)).toBe(true)
    expect(shouldSend('user-1', 'task_completed', 'rec-1', 5000)).toBe(false)
  })

  it('不同 dedupKey 互不影响', () => {
    expect(shouldSend('user-1', 'task_completed', 'rec-1', 5000)).toBe(true)
    expect(shouldSend('user-1', 'task_completed', 'rec-2', 5000)).toBe(true)
  })

  it('不同 type 互不影响', () => {
    expect(shouldSend('user-1', 'task_completed', 'rec-1', 5000)).toBe(true)
    expect(shouldSend('user-1', 'task_failed', 'rec-1', 5000)).toBe(true)
  })

  it('不同 accountId 互不影响', () => {
    expect(shouldSend('user-1', 'task_completed', 'rec-1', 5000)).toBe(true)
    expect(shouldSend('user-2', 'task_completed', 'rec-1', 5000)).toBe(true)
  })

  it('cooldownMs=0 时总是返回 true', () => {
    expect(shouldSend('user-1', 'canvas_completed', 'proj-1', 0)).toBe(true)
    expect(shouldSend('user-1', 'canvas_completed', 'proj-1', 0)).toBe(true)
    expect(shouldSend('user-1', 'canvas_completed', 'proj-1', 0)).toBe(true)
  })

  it('冷却期过后返回 true', async () => {
    const shortCooldown = 50 // 50ms for fast test
    expect(shouldSend('user-1', 'task_completed', 'rec-1', shortCooldown)).toBe(true)
    expect(shouldSend('user-1', 'task_completed', 'rec-1', shortCooldown)).toBe(false)
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(shouldSend('user-1', 'task_completed', 'rec-1', shortCooldown)).toBe(true)
  })
})

describe('resetCooldowns', () => {
  it('清除所有冷却状态', () => {
    shouldSend('user-1', 'task_completed', 'rec-1', 5000)
    shouldSend('user-2', 'task_failed', 'rec-2', 5000)
    expect(getCooldownSize()).toBe(2)
    resetCooldowns()
    expect(getCooldownSize()).toBe(0)
  })
})

describe('COOLDOWN_MS 常量', () => {
  it('balanceWarning = 5 分钟', () => {
    expect(COOLDOWN_MS.balanceWarning).toBe(5 * 60 * 1000)
  })

  it('syncTask = 3 秒', () => {
    expect(COOLDOWN_MS.syncTask).toBe(3 * 1000)
  })

  it('system = 1 小时', () => {
    expect(COOLDOWN_MS.system).toBe(60 * 60 * 1000)
  })

  it('apiKeyExpired = 24 小时', () => {
    expect(COOLDOWN_MS.apiKeyExpired).toBe(24 * 60 * 60 * 1000)
  })

  it('apiKeyQuota（已用尽）= 6 小时', () => {
    expect(COOLDOWN_MS.apiKeyQuota).toBe(6 * 60 * 60 * 1000)
  })

  it('apiKeyQuotaApproaching（即将用尽 80%）= 24 小时', () => {
    expect(COOLDOWN_MS.apiKeyQuotaApproaching).toBe(24 * 60 * 60 * 1000)
  })

  it('none = 0', () => {
    expect(COOLDOWN_MS.none).toBe(0)
  })
})
