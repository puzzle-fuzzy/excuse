import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { extractEdenError, makeTestConfig, signTestToken } from './helpers/test-factory'

const mockListNotifications = mock(() => Promise.resolve([
  {
    id: 'notification-001',
    accountId: 'acc-001',
    type: 'system',
    title: '系统通知',
    body: '欢迎使用',
    read: false,
    createdAt: new Date('2024-01-03T00:00:00Z'),
  },
]))
const mockGetUnreadCount = mock(() => Promise.resolve(3))
const mockMarkNotificationRead = mock(() => Promise.resolve(true))
const mockMarkAllNotificationsRead = mock(() => Promise.resolve(2))
const mockCreateNotification = mock(() => Promise.resolve({
  id: 'notification-002',
  accountId: 'acc-001',
  type: 'system',
  title: '系统通知',
  body: null,
  read: false,
  createdAt: new Date('2024-01-04T00:00:00Z'),
}))

mock.module('@excuse/db', () => ({
  createNotification: mockCreateNotification,
  getUnreadCount: mockGetUnreadCount,
  listNotifications: mockListNotifications,
  markAllNotificationsRead: mockMarkAllNotificationsRead,
  markNotificationRead: mockMarkNotificationRead,
  notifyNotification: async () => {},
  findApiKeyByHash: async () => null,
  findRevokedApiKeyByHash: async () => null,
  touchApiKeyLastUsed: async () => {},
}))

// eslint-disable-next-line import/first
import { treaty } from '@elysia/eden'
// eslint-disable-next-line import/first
import { createNotificationRoutes } from '../src/routes/notifications'

const testConfig = makeTestConfig({
  dashscopeApiKey: 'test-key',
  dashscopeBaseUrl: 'https://test.local',
  storageRoot: '/tmp/test-uploads',
  jwtSecret: 'test-notifications-secret',
})

describe('notification routes', () => {
  let app: ReturnType<typeof createNotificationRoutes>
  let client: ReturnType<typeof treaty>
  let token: string

  beforeAll(async () => {
    token = await signTestToken(testConfig.jwtSecret, 'acc-001')
  })

  beforeEach(() => {
    for (const fn of [
      mockListNotifications,
      mockGetUnreadCount,
      mockMarkNotificationRead,
      mockMarkAllNotificationsRead,
      mockCreateNotification,
    ]) {
      fn.mockClear()
    }

    app = createNotificationRoutes(testConfig)
    client = treaty(app)
  })

  it('未登录时返回错误', async () => {
    const response = await app.handle(new Request('http://localhost/api/notifications'))
    const res = {
      data: undefined,
      error: {
        status: response.status,
        value: await response.json(),
      },
    }

    const err = extractEdenError(res)
    expect(err).toBeTruthy()
    expect(err!.error).toContain('登录')
  })

  it('列表返回 items DTO，并序列化 createdAt', async () => {
    const response = await app.handle(new Request('http://localhost/api/notifications?limit=10&offset=0', {
      headers: { Authorization: `Bearer ${token}` },
    }))
    const data = await response.json() as {
      success: true
      items: Array<{ createdAt: string }>
      total: number
    }

    expect(data.success).toBe(true)
    expect(data.items).toHaveLength(1)
    expect(data.items[0]?.createdAt).toBe('2024-01-03T00:00:00.000Z')
    expect(data.total).toBe(1)
  })

  it('未读数量返回 data.count', async () => {
    const { data } = await client.api.notifications.unread.get({
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(data?.success).toBe(true)
    expect(data?.data.count).toBe(3)
  })

  it('单条标记已读返回 mutation ok', async () => {
    const { data } = await client.api.notifications({ id: 'notification-001' }).read.patch(undefined, {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(data).toEqual({ success: true })
  })

  it('全部标记已读返回 data.count', async () => {
    const { data } = await client.api.notifications['read-all'].post(undefined, {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(data?.success).toBe(true)
    expect(data?.data.count).toBe(2)
  })
})
