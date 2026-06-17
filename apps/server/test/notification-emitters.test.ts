import type { NotificationMeta } from '@excuse/db'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

/**
 * 系统风险通知 emitter 单元测试
 *
 * 覆盖：
 *   - notifyApiKeyQuota：80% 预警 / 100% 已用尽 / 阈值外不发送 / 冷却去重 / 已用尽优先
 *   - notifyProviderFailure：type=provider_anomaly + 冷却去重
 *
 * 通过 mock @excuse/db 的 notifyNotification（唯一写入+推送 chokepoint）捕获调用，
 * 复用真实 notification-cooldown 模块（每例重置）。
 */

interface CapturedNotification {
  accountId: string
  type: string
  title: string
  body?: string
  meta?: NotificationMeta | null
}

const captured: CapturedNotification[] = []

const mockNotifyNotification = mock<(opts: CapturedNotification) => Promise<unknown>>((opts) => {
  captured.push(opts)
  return Promise.resolve({ ...opts, id: `n-${captured.length}`, read: false, createdAt: new Date() })
})

mock.module('@excuse/db', () => ({
  notifyNotification: mockNotifyNotification,
}))

// eslint-disable-next-line import/first
import { resetCooldowns } from '../src/services/notification-cooldown'
// eslint-disable-next-line import/first
import { notifyApiKeyQuota, notifyProviderFailure } from '../src/services/notifications'

const ACCOUNT = 'acc-001'
const KEY_ID = 'key-001'

beforeEach(() => {
  captured.length = 0
  mockNotifyNotification.mockClear()
  resetCooldowns()
})

afterEach(() => {
  resetCooldowns()
})

describe('notifyApiKeyQuota', () => {
  it('使用率 < 80% → 不发送', async () => {
    await notifyApiKeyQuota(ACCOUNT, { keyId: KEY_ID, totalSpendCents: 70, quotaMaxCents: 100 })
    expect(mockNotifyNotification).not.toHaveBeenCalled()
  })

  it('quotaMaxCents=null → 不发送（不限额度的 Key）', async () => {
    await notifyApiKeyQuota(ACCOUNT, { keyId: KEY_ID, totalSpendCents: 9999, quotaMaxCents: null })
    expect(mockNotifyNotification).not.toHaveBeenCalled()
  })

  it('quotaMaxCents=0 → 不发送（避免除零/无意义）', async () => {
    await notifyApiKeyQuota(ACCOUNT, { keyId: KEY_ID, totalSpendCents: 5, quotaMaxCents: 0 })
    expect(mockNotifyNotification).not.toHaveBeenCalled()
  })

  it('使用率 ≥ 80% 且 < 100% → 发送「即将用尽」，type=api_key_quota，含 keyId/percent', async () => {
    await notifyApiKeyQuota(ACCOUNT, { keyId: KEY_ID, totalSpendCents: 80, quotaMaxCents: 100 })
    expect(mockNotifyNotification).toHaveBeenCalledTimes(1)
    const sent = captured[0]!
    expect(sent.type).toBe('api_key_quota')
    expect(sent.title).toContain('即将用尽')
    expect(sent.meta).toMatchObject({ keyId: KEY_ID, percent: 0.8 })
  })

  it('使用率 ≥ 100% → 发送「已用尽」，title 区分于即将用尽', async () => {
    await notifyApiKeyQuota(ACCOUNT, { keyId: KEY_ID, totalSpendCents: 120, quotaMaxCents: 100 })
    expect(mockNotifyNotification).toHaveBeenCalledTimes(1)
    const sent = captured[0]!
    expect(sent.type).toBe('api_key_quota')
    expect(sent.title).toContain('已用尽')
    expect(sent.meta).toMatchObject({ keyId: KEY_ID, percent: 1.2 })
  })

  it('单次调用从 70% 跳到 100% → 已用尽优先（只发一条已用尽）', async () => {
    await notifyApiKeyQuota(ACCOUNT, { keyId: KEY_ID, totalSpendCents: 100, quotaMaxCents: 100 })
    expect(mockNotifyNotification).toHaveBeenCalledTimes(1)
    expect(captured[0]!.title).toContain('已用尽')
  })

  it('即将用尽（80%）冷却期内重复调用 → 去重', async () => {
    await notifyApiKeyQuota(ACCOUNT, { keyId: KEY_ID, totalSpendCents: 85, quotaMaxCents: 100 })
    await notifyApiKeyQuota(ACCOUNT, { keyId: KEY_ID, totalSpendCents: 90, quotaMaxCents: 100 })
    expect(mockNotifyNotification).toHaveBeenCalledTimes(1)
  })

  it('已用尽（100%）冷却期内重复调用 → 去重', async () => {
    await notifyApiKeyQuota(ACCOUNT, { keyId: KEY_ID, totalSpendCents: 100, quotaMaxCents: 100 })
    await notifyApiKeyQuota(ACCOUNT, { keyId: KEY_ID, totalSpendCents: 150, quotaMaxCents: 100 })
    expect(mockNotifyNotification).toHaveBeenCalledTimes(1)
  })

  it('即将用尽与已用尽 dedupKey 不同 → 互不抑制', async () => {
    // 先达 80%（即将用尽）
    await notifyApiKeyQuota(ACCOUNT, { keyId: KEY_ID, totalSpendCents: 80, quotaMaxCents: 100 })
    // 再达 100%（已用尽，不同 dedupKey，应发出）
    await notifyApiKeyQuota(ACCOUNT, { keyId: KEY_ID, totalSpendCents: 100, quotaMaxCents: 100 })
    expect(mockNotifyNotification).toHaveBeenCalledTimes(2)
    expect(captured[0]!.title).toContain('即将用尽')
    expect(captured[1]!.title).toContain('已用尽')
  })

  it('不同 keyId 互不影响', async () => {
    await notifyApiKeyQuota(ACCOUNT, { keyId: 'key-A', totalSpendCents: 80, quotaMaxCents: 100 })
    await notifyApiKeyQuota(ACCOUNT, { keyId: 'key-B', totalSpendCents: 80, quotaMaxCents: 100 })
    expect(mockNotifyNotification).toHaveBeenCalledTimes(2)
  })
})

describe('notifyProviderFailure', () => {
  it('发送 type=provider_anomaly，body 含模型名，meta.model', async () => {
    await notifyProviderFailure(ACCOUNT, 'qwen-max')
    expect(mockNotifyNotification).toHaveBeenCalledTimes(1)
    const sent = captured[0]!
    expect(sent.type).toBe('provider_anomaly')
    expect(sent.body).toContain('qwen-max')
    expect(sent.meta).toMatchObject({ model: 'qwen-max' })
  })

  it('冷却期内重复调用（同 account+model）→ 去重', async () => {
    await notifyProviderFailure(ACCOUNT, 'qwen-max')
    await notifyProviderFailure(ACCOUNT, 'qwen-max')
    expect(mockNotifyNotification).toHaveBeenCalledTimes(1)
  })

  it('不同 model 互不影响', async () => {
    await notifyProviderFailure(ACCOUNT, 'qwen-max')
    await notifyProviderFailure(ACCOUNT, 'qwen-plus')
    expect(mockNotifyNotification).toHaveBeenCalledTimes(2)
  })
})
