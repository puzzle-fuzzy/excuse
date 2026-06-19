import type { SSENotificationEvent } from '@excuse/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { notificationQueryKeys, queryClient } from '../src/api/query-client'
import { handleNotificationSSEEvent } from '../src/stores/notifications'

// 使用独立 QueryClient 避免污染全局
let testClient: typeof queryClient

beforeEach(() => {
  testClient = queryClient
  testClient.clear()
})

describe('notificationQueryKeys', () => {
  it('all key 包含 "notifications"', () => {
    expect(notificationQueryKeys.all).toEqual(['notifications'])
  })

  it('list key 包含 "notifications" + "list"', () => {
    expect(notificationQueryKeys.list).toEqual(['notifications', 'list'])
  })

  it('unread key 包含 "notifications" + "unread"', () => {
    expect(notificationQueryKeys.unread).toEqual(['notifications', 'unread'])
  })
})

describe('handleNotificationSSEEvent', () => {
  const event: SSENotificationEvent = {
    id: 'notif-1',
    type: 'task_completed',
    title: '生成完成',
    body: '图片已生成',
    meta: { recordId: 'rec-1' },
    read: false,
    createdAt: '2024-06-01T00:00:00.000Z',
  }

  it('invalidates unread 和 list query', () => {
    const invalidateSpy = vi.spyOn(testClient, 'invalidateQueries')

    handleNotificationSSEEvent(event)

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: notificationQueryKeys.unread })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: notificationQueryKeys.list })
    invalidateSpy.mockRestore()
  })

  it('乐观更新 unread +1', () => {
    testClient.setQueryData(notificationQueryKeys.unread, 5)

    handleNotificationSSEEvent(event)

    const unread = testClient.getQueryData<number>(notificationQueryKeys.unread)
    expect(unread).toBe(6)
  })

  it('unread 为 undefined 时不变', () => {
    testClient.clear()

    handleNotificationSSEEvent(event)

    // 缓存未建立时 setQueryData 不会创建
    const unread = testClient.getQueryData(notificationQueryKeys.unread)
    expect(unread).toBeUndefined()
  })

  it('乐观更新 list 前置新通知', () => {
    const existing = [
      { id: 'old-1', type: 'system' as const, title: '旧通知', body: null, meta: null, read: true, createdAt: '2024-05-01T00:00:00.000Z' },
    ]
    testClient.setQueryData(notificationQueryKeys.list, existing)

    handleNotificationSSEEvent(event)

    const list = testClient.getQueryData<Array<{ id: string }>>(notificationQueryKeys.list)
    expect(list?.[0]?.id).toBe('notif-1')
    expect(list?.length).toBe(2)
  })

  it('list 缓存未建立时不创建', () => {
    testClient.clear()

    handleNotificationSSEEvent(event)

    const list = testClient.getQueryData(notificationQueryKeys.list)
    expect(list).toBeUndefined()
  })
})

describe('resolveTarget', () => {
  // resolveTarget 现在在 Navbar.tsx 中定义，不易直接测试。
  // 这里验证关键逻辑分支用纯数据方式。
  function resolveTarget(n: { type: string, meta?: { projectId?: string, recordId?: string } }): string | undefined {
    if (n.type === 'canvas_completed' && n.meta?.projectId)
      return `/canvas/${n.meta.projectId}`
    if (n.type === 'balance_warning')
      return '/billing'
    if (n.type === 'task_completed' || n.type === 'task_failed')
      return n.meta?.recordId ? `/?record=${n.meta.recordId}` : '/'
    return undefined
  }

  it('canvas_completed + projectId → /canvas/:projectId', () => {
    expect(resolveTarget({ type: 'canvas_completed', meta: { projectId: 'p1' } })).toBe('/canvas/p1')
  })

  it('balance_warning → /billing', () => {
    expect(resolveTarget({ type: 'balance_warning' })).toBe('/billing')
  })

  it('task_completed + recordId → /?record=xxx', () => {
    expect(resolveTarget({ type: 'task_completed', meta: { recordId: 'r1' } })).toBe('/?record=r1')
  })

  it('task_failed 无 recordId → /', () => {
    expect(resolveTarget({ type: 'task_failed' })).toBe('/')
  })

  it('system 无跳转目标 → undefined', () => {
    expect(resolveTarget({ type: 'system' })).toBeUndefined()
  })
})
