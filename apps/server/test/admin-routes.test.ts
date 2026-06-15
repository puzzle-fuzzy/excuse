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

const mockListAdminUsers = mock(async (query: { search?: string, isActive?: boolean, limit?: number, offset?: number }) => ({
  items: [
    {
      id: 'acc-1',
      username: query.search?.includes('alice') ? 'alice' : 'bob',
      email: query.search?.includes('alice') ? 'alice@example.com' : 'bob@example.com',
      isActive: query.isActive ?? true,
      createdAt: '2026-06-01T00:00:00.000Z',
      lastActivityAt: '2026-06-14T12:00:00.000Z',
      creditBalanceCents: 5000,
      totalCostCents: 1234,
      totalCalls: 42,
    },
  ],
  total: 1,
}))

const mockGetAdminUserDetail = mock(async (accountId: string) => {
  if (accountId === 'missing-user')
    return null
  return {
    summary: {
      id: accountId,
      username: 'alice',
      email: 'alice@example.com',
      isActive: true,
      createdAt: '2026-06-01T00:00:00.000Z',
      lastActivityAt: '2026-06-14T12:00:00.000Z',
      creditBalanceCents: 5000,
      totalCostCents: 1234,
      totalCalls: 42,
    },
    dailyCost: [
      { date: '2026-06-14', costCents: 500, calls: 5 },
      { date: '2026-06-13', costCents: 300, calls: 3 },
    ],
    modelBreakdown: [
      { model: 'qwen-plus', calls: 30, costCents: 1000 },
    ],
    recentRecords: [
      { id: 'rec-1', model: 'qwen-plus', status: 'succeeded', costCents: 100, createdAt: '2026-06-14T10:00:00.000Z' },
    ],
  }
})

const mockGetAdminProviderStats = mock(async (_windowHours: number) => [
  {
    model: 'qwen-plus',
    category: 'text',
    totalCalls: 100,
    succeededCalls: 95,
    failedCalls: 5,
    totalCostCents: 5000,
    totalInputTokens: 50000,
    totalOutputTokens: 25000,
  },
])

const mockGetAdminTaskDetail = mock(async (taskId: string) => {
  if (taskId === 'missing-task')
    return null
  return {
    task: {
      id: taskId,
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
    pipelineRuns: [
      {
        id: 'run-1',
        projectId: 'project-1',
        phase: 'analyze',
        status: 'succeeded',
        startedAt: '2026-06-14T00:00:00.000Z',
        finishedAt: '2026-06-14T00:00:30.000Z',
        durationMs: 30_000,
        errorMessage: null,
        outputSummary: { summary: '一个故事' },
        createdAt: '2026-06-14T00:00:00.000Z',
      },
      {
        id: 'run-2',
        projectId: 'project-1',
        phase: 'storyboard',
        status: 'failed',
        startedAt: '2026-06-14T00:01:00.000Z',
        finishedAt: '2026-06-14T00:01:30.000Z',
        durationMs: 30_000,
        errorMessage: 'LLM 输出校验失败',
        outputSummary: null,
        createdAt: '2026-06-14T00:01:00.000Z',
      },
    ],
  }
})

mock.module('@excuse/db', () => ({
  getAdminOverview: mockGetAdminOverview,
  listAdminTasks: mockListAdminTasks,
  requeueAdminTask: mockRequeueAdminTask,
  cancelAdminTask: mockCancelAdminTask,
  listAdminUsers: mockListAdminUsers,
  getAdminUserDetail: mockGetAdminUserDetail,
  getAdminProviderStats: mockGetAdminProviderStats,
  getAdminTaskDetail: mockGetAdminTaskDetail,
  findApiKeyByHash: mock(async () => null),
  touchApiKeyLastUsed: mock(async () => undefined),
}))

// metricsCollector.snapshot() — 仅 stub providerCalls 字段
const mockProviderCallsSnapshot = mock((): Record<string, { success: number, failed: number, durations: number[] }> => ({
  'qwen-plus': { success: 95, failed: 5, durations: [800, 1200, 1500, 2000, 3000] },
}))
mock.module('../src/services/metrics', () => ({
  getProviderCallsSnapshot: mockProviderCallsSnapshot,
  getMetrics: mock(() => ({ requests: { total: 0, byStatus: {} }, latency: { p50: 0, p95: 0, p99: 0, avgMs: 0 }, sse: { onlineUsers: 0 }, generation: { byStatus: {} }, providerCalls: {}, errors: 0, uptime: 0 })),
  recordRequest: mock(() => {}),
  recordError: mock(() => {}),
  recordGenerationStatus: mock(() => {}),
  recordProviderCall: mock(() => {}),
  resetMetrics: mock(() => {}),
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
  mockListAdminUsers.mockClear()
  mockGetAdminUserDetail.mockClear()
  mockGetAdminProviderStats.mockClear()
  mockGetAdminTaskDetail.mockClear()
  mockProviderCallsSnapshot.mockClear()
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

  // ── 新增：task detail endpoint ─────────────

  describe('admin task detail endpoint', () => {
    it('rejects non-admin user', async () => {
      const { app, config } = makeApp(['admin-1'])
      const token = await signTestToken(config.jwtSecret, 'user-1')
      const client = treaty(app)

      const res = await client.api.admin.tasks({ id: 'task-1' }).get({
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.data).toBeNull()
      expect((res.error as { status?: number } | null)?.status).toBe(403)
      expect(mockGetAdminTaskDetail).not.toHaveBeenCalled()
    })

    it('returns 404 for missing task', async () => {
      const { app, config } = makeApp(['admin-1'])
      const token = await signTestToken(config.jwtSecret, 'admin-1')
      const client = treaty(app)

      const res = await client.api.admin.tasks({ id: 'missing-task' }).get({
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.data).toBeNull()
      expect((res.error as { status?: number } | null)?.status).toBe(404)
      expect(mockGetAdminTaskDetail).toHaveBeenCalledWith('missing-task')
    })

    it('returns task + pipeline runs cascade with durationMs', async () => {
      const { app, config } = makeApp(['admin-1'])
      const token = await signTestToken(config.jwtSecret, 'admin-1')
      const client = treaty(app)

      const res = await client.api.admin.tasks({ id: 'task-1' }).get({
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.error).toBeNull()
      const data = res.data as {
        success: true
        data: {
          task: { id: string, type: string }
          pipelineRuns: Array<{
            phase: string
            status: string
            durationMs: number | null
            errorMessage: string | null
            outputSummary: Record<string, unknown> | null
          }>
        }
      } | null
      expect(data?.data.task.id).toBe('task-1')
      expect(data?.data.pipelineRuns.length).toBe(2)
      const analyze = data?.data.pipelineRuns.find(r => r.phase === 'analyze')
      const storyboard = data?.data.pipelineRuns.find(r => r.phase === 'storyboard')
      expect(analyze?.status).toBe('succeeded')
      expect(analyze?.durationMs).toBe(30_000)
      expect(analyze?.outputSummary).toEqual({ summary: '一个故事' })
      expect(storyboard?.status).toBe('failed')
      expect(storyboard?.errorMessage).toBe('LLM 输出校验失败')
      expect(mockGetAdminTaskDetail).toHaveBeenCalledWith('task-1')
    })
  })

  // ── 新增：users / providers endpoints ─────────────

  describe('admin users endpoints', () => {
    it('rejects non-admin user from listing users', async () => {
      const { app, config } = makeApp(['admin-1'])
      const token = await signTestToken(config.jwtSecret, 'user-1')
      const client = treaty(app)

      const res = await client.api.admin.users.get({
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.data).toBeNull()
      expect((res.error as { status?: number } | null)?.status).toBe(403)
      expect(mockListAdminUsers).not.toHaveBeenCalled()
    })

    it('lists users with search + isActive + pagination params', async () => {
      const { app, config } = makeApp(['admin-1'])
      const token = await signTestToken(config.jwtSecret, 'admin-1')
      const client = treaty(app)

      const res = await client.api.admin.users.get({
        headers: { authorization: `Bearer ${token}` },
        query: { search: 'alice', isActive: true, limit: 10, offset: 0 },
      })

      expect(res.error).toBeNull()
      const data = res.data as { success: true, items: Array<{ username: string }>, total: number } | null
      expect(data?.success).toBe(true)
      expect(data?.items[0]?.username).toBe('alice')
      expect(data?.total).toBe(1)
      expect(mockListAdminUsers).toHaveBeenCalledWith(expect.objectContaining({
        search: 'alice',
        isActive: true,
        limit: 10,
        offset: 0,
      }))
    })

    it('returns 404 for missing user', async () => {
      const { app, config } = makeApp(['admin-1'])
      const token = await signTestToken(config.jwtSecret, 'admin-1')
      const client = treaty(app)

      const res = await client.api.admin.users({ id: 'missing-user' }).get({
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.data).toBeNull()
      expect((res.error as { status?: number } | null)?.status).toBe(404)
    })

    it('returns user detail with daily cost + model breakdown + recent records', async () => {
      const { app, config } = makeApp(['admin-1'])
      const token = await signTestToken(config.jwtSecret, 'admin-1')
      const client = treaty(app)

      const res = await client.api.admin.users({ id: 'acc-1' }).get({
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.error).toBeNull()
      const data = res.data as {
        success: true
        data: {
          summary: { username: string }
          dailyCost: unknown[]
          modelBreakdown: unknown[]
          recentRecords: unknown[]
        }
      } | null
      expect(data?.data.summary.username).toBe('alice')
      expect(data?.data.dailyCost.length).toBe(2)
      expect(data?.data.modelBreakdown.length).toBe(1)
      expect(data?.data.recentRecords.length).toBe(1)
    })
  })

  describe('admin providers endpoint', () => {
    it('rejects non-admin user', async () => {
      const { app, config } = makeApp(['admin-1'])
      const token = await signTestToken(config.jwtSecret, 'user-1')
      const client = treaty(app)

      const res = await client.api.admin.providers.get({
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.data).toBeNull()
      expect((res.error as { status?: number } | null)?.status).toBe(403)
      expect(mockGetAdminProviderStats).not.toHaveBeenCalled()
    })

    it('merges DB cost/count + metrics latency', async () => {
      const { app, config } = makeApp(['admin-1'])
      const token = await signTestToken(config.jwtSecret, 'admin-1')
      const client = treaty(app)

      const res = await client.api.admin.providers.get({
        headers: { authorization: `Bearer ${token}` },
        query: { windowHours: 24 },
      })

      expect(res.error).toBeNull()
      const data = res.data as {
        success: true
        windowHours: number
        items: Array<{
          model: string
          failureRate: number
          avgLatencyMs: number | null
          p50LatencyMs: number | null
          p95LatencyMs: number | null
        }>
      } | null
      expect(data?.success).toBe(true)
      expect(data?.windowHours).toBe(24)
      const qwenItem = data?.items.find(item => item.model === 'qwen-plus')
      expect(qwenItem).toBeDefined()
      expect(qwenItem!.failureRate).toBeCloseTo(0.05, 5) // 5 failed / 100 total
      expect(qwenItem!.avgLatencyMs).not.toBeNull()
      expect(qwenItem!.p50LatencyMs).not.toBeNull()
      expect(qwenItem!.p95LatencyMs).not.toBeNull()
      expect(mockProviderCallsSnapshot).toHaveBeenCalledTimes(1)
    })

    it('clamps windowHours below 1 to 1', async () => {
      const { app, config } = makeApp(['admin-1'])
      const token = await signTestToken(config.jwtSecret, 'admin-1')
      const client = treaty(app)

      const res = await client.api.admin.providers.get({
        headers: { authorization: `Bearer ${token}` },
        query: { windowHours: 0 },
      })

      expect(res.error).toBeNull()
      const data = res.data as { success: true, windowHours: number } | null
      expect(data?.windowHours).toBe(1)
    })

    it('clamps windowHours above 720 to 720', async () => {
      const { app, config } = makeApp(['admin-1'])
      const token = await signTestToken(config.jwtSecret, 'admin-1')
      const client = treaty(app)

      const res = await client.api.admin.providers.get({
        headers: { authorization: `Bearer ${token}` },
        query: { windowHours: 99999 },
      })

      expect(res.error).toBeNull()
      const data = res.data as { success: true, windowHours: number } | null
      expect(data?.windowHours).toBe(720)
    })

    it('returns null latency when metricsCollector has no samples', async () => {
      mockProviderCallsSnapshot.mockReturnValueOnce({})
      const { app, config } = makeApp(['admin-1'])
      const token = await signTestToken(config.jwtSecret, 'admin-1')
      const client = treaty(app)

      const res = await client.api.admin.providers.get({
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.error).toBeNull()
      const data = res.data as {
        success: true
        items: Array<{ model: string, avgLatencyMs: number | null, p50LatencyMs: number | null }>
      } | null
      const qwen = data?.items.find(item => item.model === 'qwen-plus')
      expect(qwen?.avgLatencyMs).toBeNull()
      expect(qwen?.p50LatencyMs).toBeNull()
    })
  })
})
