import { treaty } from '@elysia/eden'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { Elysia } from 'elysia'
import { createAdminRoutes } from '../src/routes/admin'
import { makeTestConfig, signTestToken } from './helpers/test-factory'

const mockGetAdminOverview = mock(async () => ({
  summary: {
    totalUsers: 2,
    activeUsers: 1,
    totalGenerationRecords: 5,
    failedGenerationRecords: 1,
    totalCostCents: 123,
    activeTasks: 3,
    activeCanvasProjects: 4,
  },
  generationStatus: [{ status: 'succeeded', count: 4 }, { status: 'failed', count: 1 }],
  canvasProjectStatus: [{ status: 'draft', count: 2 }],
  taskQueue: [{ domain: 'canvas', status: 'queued', count: 3 }],
  recentFailures: [],
}))

const mockListAdminTasks = mock(async () => ({
  items: [
    {
      id: 'task-1',
      accountId: 'admin-1',
      type: 'canvas.analyze',
      domain: 'canvas',
      status: 'failed',
      priority: 5,
      attempts: 3,
      maxAttempts: 3,
      projectId: 'project-1',
      targetType: 'pipeline_run',
      targetId: 'run-1',
      generationRecordId: null,
      lockedBy: '',
      lockedUntil: null,
      nextRunAt: '2026-06-14T00:00:00.000Z',
      startedAt: '2026-06-14T00:00:00.000Z',
      finishedAt: '2026-06-14T00:01:00.000Z',
      createdAt: '2026-06-14T00:00:00.000Z',
      updatedAt: '2026-06-14T00:01:00.000Z',
      errorMessage: 'provider timeout',
      canRequeue: true,
      canCancel: false,
    },
  ],
  total: 1,
}))

const mockRequeueAdminTask = mock(async (id: string) => ({
  id,
  accountId: 'admin-1',
  type: 'canvas.analyze',
  domain: 'canvas',
  status: 'queued',
  priority: 5,
  attempts: 0,
  maxAttempts: 3,
  projectId: 'project-1',
  targetType: 'pipeline_run',
  targetId: 'run-1',
  generationRecordId: null,
  lockedBy: '',
  lockedUntil: null,
  nextRunAt: '2026-06-14T00:02:00.000Z',
  startedAt: null,
  finishedAt: null,
  createdAt: '2026-06-14T00:00:00.000Z',
  updatedAt: '2026-06-14T00:02:00.000Z',
  errorMessage: null,
  canRequeue: true,
  canCancel: true,
}))

const mockCancelAdminTask = mock(async (id: string) => ({
  id,
  accountId: 'admin-1',
  type: 'generate.video',
  domain: 'generate',
  status: 'cancelled',
  priority: 5,
  attempts: 1,
  maxAttempts: 3,
  projectId: null,
  targetType: null,
  targetId: null,
  generationRecordId: 'record-1',
  lockedBy: '',
  lockedUntil: null,
  nextRunAt: '2026-06-14T00:00:00.000Z',
  startedAt: '2026-06-14T00:00:00.000Z',
  finishedAt: '2026-06-14T00:02:00.000Z',
  createdAt: '2026-06-14T00:00:00.000Z',
  updatedAt: '2026-06-14T00:02:00.000Z',
  errorMessage: null,
  canRequeue: false,
  canCancel: false,
}))

mock.module('@excuse/db', () => ({
  getAdminOverview: mockGetAdminOverview,
  listAdminTasks: mockListAdminTasks,
  requeueAdminTask: mockRequeueAdminTask,
  cancelAdminTask: mockCancelAdminTask,
  findApiKeyByHash: mock(async () => null),
  touchApiKeyLastUsed: mock(async () => undefined),
}))

function makeApp(adminUserIds: string[]) {
  const config = makeTestConfig({
    jwtSecret: 'admin-routes-secret',
    adminUserIds,
  })
  return {
    app: new Elysia().use(createAdminRoutes(config)),
    config,
  }
}

beforeEach(() => {
  mockGetAdminOverview.mockClear()
  mockListAdminTasks.mockClear()
  mockRequeueAdminTask.mockClear()
  mockCancelAdminTask.mockClear()
})

describe('admin routes', () => {
  it('returns overview for configured admin user', async () => {
    const { app, config } = makeApp(['admin-1'])
    const token = await signTestToken(config.jwtSecret, 'admin-1')
    const client = treaty(app)

    const res = await client.api.admin.overview.get({
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.error).toBeNull()
    expect(res.data?.success).toBe(true)
    expect((res.data as { success: true, data: { summary: { totalUsers: number } } } | null)?.data.summary.totalUsers).toBe(2)
    expect(mockGetAdminOverview).toHaveBeenCalledTimes(1)
  })

  it('rejects non-admin user', async () => {
    const { app, config } = makeApp(['admin-1'])
    const token = await signTestToken(config.jwtSecret, 'user-1')
    const client = treaty(app)

    const res = await client.api.admin.overview.get({
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.data).toBeNull()
    expect((res.error as { status?: number } | null)?.status).toBe(403)
    expect(mockGetAdminOverview).not.toHaveBeenCalled()
  })

  it('lists tasks for admin users with filters', async () => {
    const { app, config } = makeApp(['admin-1'])
    const token = await signTestToken(config.jwtSecret, 'admin-1')
    const client = treaty(app)

    const res = await client.api.admin.tasks.get({
      headers: { authorization: `Bearer ${token}` },
      query: { status: 'failed', domain: 'canvas', search: 'timeout' },
    })

    expect(res.error).toBeNull()
    expect((res.data as { success: true, total: number } | null)?.total).toBe(1)
    expect(mockListAdminTasks).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      domain: 'canvas',
      search: 'timeout',
    }))
  })

  it('requeues an admin task', async () => {
    const { app, config } = makeApp(['admin-1'])
    const token = await signTestToken(config.jwtSecret, 'admin-1')
    const client = treaty(app)

    const res = await client.api.admin.tasks({ id: 'task-1' }).requeue.post(null, {
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.error).toBeNull()
    expect((res.data as { success: true, data: { status: string, attempts: number } } | null)?.data.status).toBe('queued')
    expect((res.data as { success: true, data: { status: string, attempts: number } } | null)?.data.attempts).toBe(0)
    expect(mockRequeueAdminTask).toHaveBeenCalledWith('task-1')
  })

  it('cancels an admin task', async () => {
    const { app, config } = makeApp(['admin-1'])
    const token = await signTestToken(config.jwtSecret, 'admin-1')
    const client = treaty(app)

    const res = await client.api.admin.tasks({ id: 'task-2' }).cancel.post(null, {
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.error).toBeNull()
    expect((res.data as { success: true, data: { status: string } } | null)?.data.status).toBe('cancelled')
    expect(mockCancelAdminTask).toHaveBeenCalledWith('task-2')
  })
})
