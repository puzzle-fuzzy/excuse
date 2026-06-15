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
    generationRecords: [
      {
        id: 'gen-1',
        model: 'wanx2.1-t2v',
        category: 'video',
        status: 'succeeded',
        costCents: 120,
        createdAt: '2026-06-14T00:00:45.000Z',
        errorMessage: null,
        matchReason: 'time-window',
      },
    ],
  }
})

const mockListAdminGatewayClients = mock(async (query: { search?: string, limit?: number, offset?: number }) => ({
  items: [
    {
      accountId: 'acc-gw-1',
      username: query.search?.includes('alice') ? 'alice' : 'bob',
      email: query.search?.includes('alice') ? 'alice@example.com' : 'bob@example.com',
      activeKeyCount: 1,
      totalKeyCount: 2,
      totalSpendCents: 500,
      totalQuotaCents: 10000,
      lastKeyActivityAt: '2026-06-14T12:00:00.000Z',
    },
  ],
  total: 1,
}))

const mockGetAdminGatewayClientDetail = mock(async (accountId: string) => {
  if (accountId === 'missing-client')
    return null
  return {
    summary: {
      accountId,
      username: 'alice',
      email: 'alice@example.com',
      creditBalanceCents: 5000,
      activeKeyCount: 1,
      totalKeyCount: 2,
      totalSpendCents: 500,
      totalQuotaCents: 10000,
      gatewayCalls: 42,
      gatewaySpendCents: 1234,
      lastKeyActivityAt: '2026-06-14T12:00:00.000Z',
    },
    keys: [
      { id: 'key-1', prefix: 'exc_abcd', name: 'prod', scope: 'gateway', rateLimitPerMinute: 60, quotaMaxCents: 10000, totalSpendCents: 500, quotaResetAt: null, lastUsedAt: new Date('2026-06-14T12:00:00.000Z'), createdAt: new Date('2026-06-01T00:00:00.000Z'), revokedAt: null },
    ],
    recentGatewayRecords: [
      { id: 'rec-1', model: 'qwen-plus', status: 'succeeded', costCents: 10, createdAt: '2026-06-14T10:00:00.000Z' },
    ],
  }
})

const mockRevokeApiKeyAdmin = mock(async (id: string) => {
  if (id === 'missing-key')
    return null
  return { id, revokedAt: new Date('2026-06-14T12:00:00.000Z') }
})

const mockResetApiKeySpend = mock(async () => undefined)

const mockUpdateApiKeyConfig = mock(async () => ({ id: 'key-1', scope: 'gateway' }))

mock.module('@excuse/db', () => ({
  getAdminOverview: mockGetAdminOverview,
  listAdminTasks: mockListAdminTasks,
  requeueAdminTask: mockRequeueAdminTask,
  cancelAdminTask: mockCancelAdminTask,
  listAdminUsers: mockListAdminUsers,
  getAdminUserDetail: mockGetAdminUserDetail,
  getAdminProviderStats: mockGetAdminProviderStats,
  getAdminTaskDetail: mockGetAdminTaskDetail,
  listAdminGatewayClients: mockListAdminGatewayClients,
  getAdminGatewayClientDetail: mockGetAdminGatewayClientDetail,
  revokeApiKeyAdmin: mockRevokeApiKeyAdmin,
  resetApiKeySpend: mockResetApiKeySpend,
  updateApiKeyConfig: mockUpdateApiKeyConfig,
  findApiKeyByHash: mock(async () => null),
  findRevokedApiKeyByHash: mock(async () => null),
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

// worker /provider-calls 聚合 —— 默认返回空（worker 不可达 / 未配置），测试按需覆盖
const mockFetchWorkerProviderCalls = mock(async (): Promise<Record<string, { success: number, failed: number, durations: number[] }>> => ({}))
mock.module('../src/services/worker-metrics', () => ({
  fetchWorkerProviderCalls: mockFetchWorkerProviderCalls,
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
  mockListAdminGatewayClients.mockClear()
  mockGetAdminGatewayClientDetail.mockClear()
  mockRevokeApiKeyAdmin.mockClear()
  mockResetApiKeySpend.mockClear()
  mockUpdateApiKeyConfig.mockClear()
  mockProviderCallsSnapshot.mockClear()
  mockFetchWorkerProviderCalls.mockClear()
})

describe('admin routes', () => {
  it('已配置的管理员用户返回概览', async () => {
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

  it('拒绝非管理员用户', async () => {
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

  it('管理员可按条件筛选任务列表', async () => {
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

  it('重新入队管理任务', async () => {
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

  it('取消管理任务', async () => {
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

  describe('管理任务详情端点', () => {
    it('拒绝非管理员用户', async () => {
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

    it('缺失任务返回 404', async () => {
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

    it('返回任务 + pipeline runs 级联含 durationMs', async () => {
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
          generationRecords: Array<{
            id: string
            model: string
            matchReason: 'direct' | 'time-window'
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
      // 生成记录级联诊断透传
      expect(data?.data.generationRecords.length).toBe(1)
      expect(data?.data.generationRecords[0]?.id).toBe('gen-1')
      expect(data?.data.generationRecords[0]?.matchReason).toBe('time-window')
      expect(mockGetAdminTaskDetail).toHaveBeenCalledWith('task-1')
    })
  })

  // ── 新增：users / providers endpoints ─────────────

  describe('管理用户端点', () => {
    it('拒绝非管理员用户列出用户', async () => {
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

    it('支持 search + isActive + 分页参数的用户列表', async () => {
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

    it('缺失用户返回 404', async () => {
      const { app, config } = makeApp(['admin-1'])
      const token = await signTestToken(config.jwtSecret, 'admin-1')
      const client = treaty(app)

      const res = await client.api.admin.users({ id: 'missing-user' }).get({
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.data).toBeNull()
      expect((res.error as { status?: number } | null)?.status).toBe(404)
    })

    it('返回用户详情含 daily cost + 模型分布 + 近期记录', async () => {
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

  describe('管理 provider 端点', () => {
    it('拒绝非管理员用户', async () => {
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

    it('合并 DB cost/count + metrics latency', async () => {
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

    it('windowHours 小于 1 时钳制为 1', async () => {
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

    it('windowHours 超过 720 时钳制为 720', async () => {
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

    it('metricsCollector 无样本时返回 null latency', async () => {
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

    it('合并 worker 进程 durations → 跨进程 p95/avg 反映 worker 样本', async () => {
      // server mock 已有 qwen-plus durations [800,1200,1500,2000,3000]；
      // worker 再贡献一个极大值 50000 → 合并 6 样本，p95 = 50000
      mockFetchWorkerProviderCalls.mockResolvedValueOnce({
        'qwen-plus': { success: 1, failed: 0, durations: [50000] },
      })
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
        items: Array<{ model: string, avgLatencyMs: number | null, p95LatencyMs: number | null }>
      } | null
      const qwen = data?.items.find(item => item.model === 'qwen-plus')
      // 合并后 p95 应为 worker 贡献的极大值（server-only 时 p95=3000）
      expect(qwen?.p95LatencyMs).toBe(50000)
      // avg = (800+1200+1500+2000+3000+50000)/6 = 9750
      expect(qwen?.avgLatencyMs).toBe(9750)
      expect(mockFetchWorkerProviderCalls).toHaveBeenCalledTimes(1)
    })

    it('worker 不可达（fetch 返回空）→ 仅 server 数据，不报错', async () => {
      mockFetchWorkerProviderCalls.mockResolvedValueOnce({})
      const { app, config } = makeApp(['admin-1'])
      const token = await signTestToken(config.jwtSecret, 'admin-1')
      const client = treaty(app)

      const res = await client.api.admin.providers.get({
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.error).toBeNull()
      const data = res.data as { success: true, items: Array<{ model: string, p95LatencyMs: number | null }> } | null
      const qwen = data?.items.find(item => item.model === 'qwen-plus')
      // 仅 server 5 样本 [800,1200,1500,2000,3000] → p95 = 3000
      expect(qwen?.p95LatencyMs).toBe(3000)
    })
  })

  // ── 新增：Gateway 客户管理端点 ─────────────

  describe('管理 Gateway 客户端点', () => {
    it('拒绝非管理员用户列出 Gateway 客户', async () => {
      const { app, config } = makeApp(['admin-1'])
      const token = await signTestToken(config.jwtSecret, 'user-1')
      const client = treaty(app)

      const res = await client.api.admin['gateway-clients'].get({
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.data).toBeNull()
      expect((res.error as { status?: number } | null)?.status).toBe(403)
      expect(mockListAdminGatewayClients).not.toHaveBeenCalled()
    })

    it('支持 search + 分页参数的 Gateway 客户列表', async () => {
      const { app, config } = makeApp(['admin-1'])
      const token = await signTestToken(config.jwtSecret, 'admin-1')
      const client = treaty(app)

      const res = await client.api.admin['gateway-clients'].get({
        headers: { authorization: `Bearer ${token}` },
        query: { search: 'alice', limit: 10, offset: 0 },
      })

      expect(res.error).toBeNull()
      const data = res.data as { success: true, items: Array<{ username: string, totalKeyCount: number }>, total: number } | null
      expect(data?.success).toBe(true)
      expect(data?.items[0]?.username).toBe('alice')
      expect(data?.items[0]?.totalKeyCount).toBe(2)
      expect(data?.total).toBe(1)
      expect(mockListAdminGatewayClients).toHaveBeenCalledWith(expect.objectContaining({
        search: 'alice',
        limit: 10,
        offset: 0,
      }))
    })

    it('缺失 Gateway 客户返回 404', async () => {
      const { app, config } = makeApp(['admin-1'])
      const token = await signTestToken(config.jwtSecret, 'admin-1')
      const client = treaty(app)

      const res = await client.api.admin['gateway-clients']({ accountId: 'missing-client' }).get({
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.data).toBeNull()
      expect((res.error as { status?: number } | null)?.status).toBe(404)
      expect(mockGetAdminGatewayClientDetail).toHaveBeenCalledWith('missing-client')
    })

    it('返回客户详情含 summary + keys + recentGatewayRecords', async () => {
      const { app, config } = makeApp(['admin-1'])
      const token = await signTestToken(config.jwtSecret, 'admin-1')
      const client = treaty(app)

      const res = await client.api.admin['gateway-clients']({ accountId: 'acc-gw-1' }).get({
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.error).toBeNull()
      const data = res.data as {
        success: true
        data: {
          summary: { username: string, gatewayCalls: number }
          keys: Array<{ id: string }>
          recentGatewayRecords: Array<{ id: string }>
        }
      } | null
      expect(data?.data.summary.username).toBe('alice')
      expect(data?.data.summary.gatewayCalls).toBe(42)
      expect(data?.data.keys.length).toBe(1)
      expect(data?.data.recentGatewayRecords.length).toBe(1)
    })

    it('重置 API Key 额度', async () => {
      const { app, config } = makeApp(['admin-1'])
      const token = await signTestToken(config.jwtSecret, 'admin-1')
      const client = treaty(app)

      const res = await client.api.admin['api-keys']({ id: 'key-1' })['reset-quota'].post(null, {
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.error).toBeNull()
      expect((res.data as { success: true } | null)?.success).toBe(true)
      expect(mockResetApiKeySpend).toHaveBeenCalledWith('key-1')
    })

    it('管理员撤销 API Key', async () => {
      const { app, config } = makeApp(['admin-1'])
      const token = await signTestToken(config.jwtSecret, 'admin-1')
      const client = treaty(app)

      const res = await client.api.admin['api-keys']({ id: 'key-1' }).revoke.post(null, {
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.error).toBeNull()
      expect((res.data as { success: true } | null)?.success).toBe(true)
      expect(mockRevokeApiKeyAdmin).toHaveBeenCalledWith('key-1')
    })

    it('撤销不存在或已撤销的 key 返回 409', async () => {
      const { app, config } = makeApp(['admin-1'])
      const token = await signTestToken(config.jwtSecret, 'admin-1')
      const client = treaty(app)

      const res = await client.api.admin['api-keys']({ id: 'missing-key' }).revoke.post(null, {
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.data).toBeNull()
      expect((res.error as { status?: number } | null)?.status).toBe(409)
      expect(mockRevokeApiKeyAdmin).toHaveBeenCalledWith('missing-key')
    })

    it('更新 API Key 配置', async () => {
      const { app, config } = makeApp(['admin-1'])
      const token = await signTestToken(config.jwtSecret, 'admin-1')
      const client = treaty(app)

      const res = await client.api.admin['api-keys']({ id: 'key-1' }).config.patch({
        userId: 'acc-gw-1',
        scope: 'gateway',
        rateLimitPerMinute: 120,
        quotaMaxCents: 20000,
      }, {
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.error).toBeNull()
      expect((res.data as { success: true } | null)?.success).toBe(true)
      expect(mockUpdateApiKeyConfig).toHaveBeenCalledWith('key-1', 'acc-gw-1', expect.objectContaining({
        scope: 'gateway',
        rateLimitPerMinute: 120,
        quotaMaxCents: 20000,
      }))
    })
  })
})
