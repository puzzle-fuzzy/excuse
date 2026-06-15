import type { NotificationItem } from '@/api/notifications'
import { describe, expect, it } from 'vitest'
import { resolveNotificationTarget } from '../src/lib/notification-target'

function makeNotification(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: 'n-001',
    type: 'task_completed',
    title: '测试通知',
    body: null,
    meta: null,
    read: false,
    createdAt: '2026-06-14T00:00:00.000Z',
    ...overrides,
  }
}

describe('resolveNotificationTarget', () => {
  describe('task_completed / task_failed — Canvas 锚点优先', () => {
    it('projectId + shotId → /canvas/:projectId?focus=shot:<shotId>', () => {
      const url = resolveNotificationTarget(makeNotification({
        type: 'task_completed',
        meta: { projectId: 'proj-1', shotId: 'shot-9', recordId: 'rec-x', category: 'video' },
      }))
      expect(url).toBe('/canvas/proj-1?focus=shot:shot-9')
    })

    it('仅 projectId（无 shotId）→ /canvas/:projectId', () => {
      const url = resolveNotificationTarget(makeNotification({
        type: 'task_completed',
        meta: { projectId: 'proj-1', recordId: 'rec-x' },
      }))
      expect(url).toBe('/canvas/proj-1')
    })

    it('仅 recordId（无 projectId）→ /?record=<recordId>', () => {
      const url = resolveNotificationTarget(makeNotification({
        type: 'task_completed',
        meta: { recordId: 'rec-x', category: 'video' },
      }))
      expect(url).toBe('/?record=rec-x')
    })

    it('projectId + shotId + recordId 同时存在 → Canvas 锚点优先', () => {
      const url = resolveNotificationTarget(makeNotification({
        type: 'task_completed',
        meta: { projectId: 'proj-1', shotId: 'shot-9', recordId: 'rec-x' },
      }))
      expect(url).toBe('/canvas/proj-1?focus=shot:shot-9')
    })

    it('task_failed + projectId + shotId 行为与 task_completed 一致', () => {
      const url = resolveNotificationTarget(makeNotification({
        type: 'task_failed',
        meta: { projectId: 'proj-1', shotId: 'shot-9', recordId: 'rec-x' },
      }))
      expect(url).toBe('/canvas/proj-1?focus=shot:shot-9')
    })

    it('task_failed + 仅 recordId → /?record=<recordId>', () => {
      const url = resolveNotificationTarget(makeNotification({
        type: 'task_failed',
        meta: { recordId: 'rec-x' },
      }))
      expect(url).toBe('/?record=rec-x')
    })
  })

  describe('canvas_completed', () => {
    it('仅 projectId → /canvas/:projectId', () => {
      const url = resolveNotificationTarget(makeNotification({
        type: 'canvas_completed',
        meta: { projectId: 'proj-1' },
      }))
      expect(url).toBe('/canvas/proj-1')
    })

    it('projectId + shotId → /canvas/:projectId?focus=shot:<shotId>', () => {
      const url = resolveNotificationTarget(makeNotification({
        type: 'canvas_completed',
        meta: { projectId: 'proj-1', shotId: 'shot-9' },
      }))
      expect(url).toBe('/canvas/proj-1?focus=shot:shot-9')
    })

    it('无 projectId → undefined（即使有 recordId 也不跳）', () => {
      const url = resolveNotificationTarget(makeNotification({
        type: 'canvas_completed',
        meta: { recordId: 'rec-x' },
      }))
      expect(url).toBeUndefined()
    })
  })

  describe('balance_warning', () => {
    it('恒定 → /billing（忽略 meta）', () => {
      const url = resolveNotificationTarget(makeNotification({
        type: 'balance_warning',
        meta: { category: 'video' },
      }))
      expect(url).toBe('/billing')
    })

    it('无 meta 也跳 /billing', () => {
      const url = resolveNotificationTarget(makeNotification({
        type: 'balance_warning',
        meta: null,
      }))
      expect(url).toBe('/billing')
    })
  })

  describe('其他类型 / 无定位信息', () => {
    it('api_key_expired → /api-keys', () => {
      const url = resolveNotificationTarget(makeNotification({
        type: 'api_key_expired',
        meta: { recordId: 'rec-x' },
      }))
      expect(url).toBe('/api-keys')
    })

    it('api_key_expired 无 meta 也跳 /api-keys', () => {
      const url = resolveNotificationTarget(makeNotification({
        type: 'api_key_expired',
        meta: null,
      }))
      expect(url).toBe('/api-keys')
    })

    it('system → undefined', () => {
      const url = resolveNotificationTarget(makeNotification({
        type: 'system',
        meta: null,
      }))
      expect(url).toBeUndefined()
    })

    it('task_completed 无任何 meta → undefined（不再回落到 /）', () => {
      const url = resolveNotificationTarget(makeNotification({
        type: 'task_completed',
        meta: null,
      }))
      expect(url).toBeUndefined()
    })
  })

  describe('subtitle 定位', () => {
    it('task_completed + category=subtitle + recordId → /subtitle/:recordId', () => {
      const url = resolveNotificationTarget(makeNotification({
        type: 'task_completed',
        meta: { category: 'subtitle', recordId: 'sub-1' },
      }))
      expect(url).toBe('/subtitle/sub-1')
    })

    it('task_failed + category=subtitle + recordId → /subtitle/:recordId', () => {
      const url = resolveNotificationTarget(makeNotification({
        type: 'task_failed',
        meta: { category: 'subtitle', recordId: 'sub-2' },
      }))
      expect(url).toBe('/subtitle/sub-2')
    })
  })
})
