import type { AdminGatewayClientDetailResponse, AdminGatewayClientListResponse, AdminOverview, AdminProviderStatsResponse, AdminTaskDetailResponse, AdminTaskItem, AdminUserDetailResponse, AdminUserListResponse } from '@excuse/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchAdminGatewayClientDetail, fetchAdminGatewayClients, fetchAdminProviderStats, fetchAdminTaskDetail, fetchAdminUpdateApiKeyConfig, fetchAdminUserApiKeys, fetchAdminUserDetail, fetchAdminUsers, resetApiKeyQuota, revokeApiKeyAdmin } from '../src/api/admin'
import { cancelAdminTask, fetchAdminOverview, fetchAdminTasks, requeueAdminTask } from '../src/api/client'
import Admin from '../src/pages/Admin'

vi.mock('../src/api/client', () => ({
  fetchAdminOverview: vi.fn(),
  fetchAdminTasks: vi.fn(),
  requeueAdminTask: vi.fn(),
  cancelAdminTask: vi.fn(),
}))

vi.mock('../src/api/admin', () => ({
  fetchAdminUsers: vi.fn(),
  fetchAdminUserDetail: vi.fn(),
  fetchAdminProviderStats: vi.fn(),
  fetchAdminTaskDetail: vi.fn(),
  fetchAdminGatewayClients: vi.fn(),
  fetchAdminGatewayClientDetail: vi.fn(),
  resetApiKeyQuota: vi.fn(),
  revokeApiKeyAdmin: vi.fn(),
  fetchAdminUpdateApiKeyConfig: vi.fn(),
  fetchAdminUserApiKeys: vi.fn(),
  adminUsersQueryKeys: {
    list: (params: unknown) => ['admin', 'users', 'list', params] as const,
    detail: (id: string) => ['admin', 'users', 'detail', id] as const,
  },
  adminProvidersQueryKeys: {
    list: (windowHours: number) => ['admin', 'providers', windowHours] as const,
  },
  adminTasksQueryKeys: {
    detail: (taskId: string) => ['admin', 'tasks', 'detail', taskId] as const,
  },
  adminGatewayClientsQueryKeys: {
    list: (params: unknown) => ['admin', 'gateway-clients', 'list', params] as const,
    detail: (accountId: string) => ['admin', 'gateway-clients', 'detail', accountId] as const,
  },
  adminUserApiKeysQueryKeys: {
    list: (accountId: string) => ['admin', 'users', accountId, 'api-keys'] as const,
  },
}))

const mockFetchAdminOverview = vi.mocked(fetchAdminOverview)
const mockFetchAdminTasks = vi.mocked(fetchAdminTasks)
const mockRequeueAdminTask = vi.mocked(requeueAdminTask)
const mockCancelAdminTask = vi.mocked(cancelAdminTask)
const mockFetchAdminUsers = vi.mocked(fetchAdminUsers)
const mockFetchAdminUserDetail = vi.mocked(fetchAdminUserDetail)
const mockFetchAdminProviderStats = vi.mocked(fetchAdminProviderStats)
const mockFetchAdminTaskDetail = vi.mocked(fetchAdminTaskDetail)
const mockFetchAdminGatewayClients = vi.mocked(fetchAdminGatewayClients)
const mockFetchAdminGatewayClientDetail = vi.mocked(fetchAdminGatewayClientDetail)
const mockRevokeApiKeyAdmin = vi.mocked(revokeApiKeyAdmin)
const mockResetApiKeyQuota = vi.mocked(resetApiKeyQuota)
const mockFetchAdminUpdateApiKeyConfig = vi.mocked(fetchAdminUpdateApiKeyConfig)
const mockFetchAdminUserApiKeys = vi.mocked(fetchAdminUserApiKeys)

function makeOverview(overrides?: Partial<AdminOverview>): AdminOverview {
  return {
    summary: {
      totalUsers: 10,
      activeUsers: 8,
      totalGenerationRecords: 30,
      failedGenerationRecords: 2,
      totalCostCents: 1234,
      activeTasks: 4,
      activeCanvasProjects: 3,
    },
    generationStatus: [
      { status: 'succeeded', count: 28 },
      { status: 'failed', count: 2 },
    ],
    canvasProjectStatus: [
      { status: 'draft', count: 1 },
      { status: 'completed', count: 2 },
    ],
    taskQueue: [
      { domain: 'canvas', status: 'queued', count: 3 },
      { domain: 'generate', status: 'running', count: 1 },
    ],
    recentFailures: [
      {
        id: 'task-1',
        kind: 'task',
        accountId: 'acc-1',
        title: 'canvas.analyze',
        status: 'failed',
        errorMessage: 'provider timeout',
        createdAt: '2026-06-14T00:00:00.000Z',
        updatedAt: '2026-06-14T00:01:00.000Z',
      },
    ],
    ...overrides,
  }
}

function makeTask(overrides?: Partial<AdminTaskItem>): AdminTaskItem {
  return {
    id: 'task-1',
    accountId: 'acc-1',
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
    ...overrides,
  }
}

function renderAdmin() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <Admin />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetchAdminTasks.mockResolvedValue({ success: true, items: [makeTask()], total: 1 })
  mockRequeueAdminTask.mockResolvedValue(makeTask({ status: 'queued', attempts: 0, errorMessage: null }))
  mockCancelAdminTask.mockResolvedValue(makeTask({ status: 'cancelled', canRequeue: false, canCancel: false }))
  mockFetchAdminUsers.mockResolvedValue(makeAdminUsersResponse())
  mockFetchAdminUserDetail.mockResolvedValue(makeAdminUserDetailResponse())
  mockFetchAdminProviderStats.mockResolvedValue(makeAdminProvidersResponse())
  mockFetchAdminTaskDetail.mockResolvedValue(makeAdminTaskDetailResponse())
  mockFetchAdminGatewayClients.mockResolvedValue(makeAdminGatewayClientsResponse())
  mockFetchAdminGatewayClientDetail.mockResolvedValue(makeAdminGatewayClientDetailResponse())
  mockRevokeApiKeyAdmin.mockResolvedValue(undefined)
  mockResetApiKeyQuota.mockResolvedValue(undefined)
  mockFetchAdminUpdateApiKeyConfig.mockResolvedValue(undefined)
  mockFetchAdminUserApiKeys.mockResolvedValue({ success: true, items: [] })
})

function makeAdminUsersResponse(overrides?: Partial<AdminUserListResponse>): AdminUserListResponse {
  return {
    success: true,
    items: [
      {
        id: 'acc-1',
        username: 'alice',
        email: 'alice@example.com',
        isActive: true,
        createdAt: '2026-06-01T00:00:00.000Z',
        lastActivityAt: '2026-06-14T12:00:00.000Z',
        creditBalanceCents: 5000,
        totalCostCents: 1234,
        totalCalls: 42,
      },
    ],
    total: 1,
    ...overrides,
  }
}

function makeAdminUserDetailResponse(): AdminUserDetailResponse {
  return {
    success: true,
    data: {
      summary: {
        id: 'acc-1',
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
      ],
      modelBreakdown: [
        { model: 'qwen-plus', calls: 30, costCents: 1000 },
      ],
      recentRecords: [
        { id: 'rec-1', model: 'qwen-plus', status: 'succeeded', costCents: 100, createdAt: '2026-06-14T10:00:00.000Z' },
      ],
    },
  }
}

function makeAdminProvidersResponse(overrides?: Partial<AdminProviderStatsResponse>): AdminProviderStatsResponse {
  return {
    success: true,
    windowHours: 24,
    items: [
      {
        model: 'qwen-plus',
        category: 'text',
        totalCalls: 100,
        succeededCalls: 95,
        failedCalls: 5,
        failureRate: 0.05,
        avgLatencyMs: 1500,
        p50LatencyMs: 1200,
        p95LatencyMs: 3000,
        totalCostCents: 5000,
        totalInputTokens: 50000,
        totalOutputTokens: 25000,
      },
    ],
    ...overrides,
  }
}

function makeAdminTaskDetailResponse(overrides?: { pipelineRuns?: AdminTaskDetailResponse['data']['pipelineRuns'] }): AdminTaskDetailResponse {
  return {
    success: true,
    data: {
      task: makeTask(),
      pipelineRuns: overrides?.pipelineRuns ?? [
        {
          id: 'run-1',
          projectId: 'project-1',
          phase: 'analyze',
          status: 'succeeded',
          startedAt: '2026-06-14T00:00:00.000Z',
          finishedAt: '2026-06-14T00:00:30.000Z',
          durationMs: 30_000,
          errorMessage: null,
          outputSummary: null,
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
    },
  }
}

function makeAdminGatewayClientsResponse(overrides?: Partial<AdminGatewayClientListResponse>): AdminGatewayClientListResponse {
  return {
    success: true,
    items: [
      {
        accountId: 'acc-1',
        username: 'alice',
        email: 'alice@example.com',
        activeKeyCount: 1,
        totalKeyCount: 2,
        totalSpendCents: 1234,
        totalQuotaCents: 10000,
        lastKeyActivityAt: '2026-06-14T12:00:00.000Z',
      },
    ],
    total: 1,
    ...overrides,
  }
}

function makeAdminGatewayClientDetailResponse(): AdminGatewayClientDetailResponse {
  return {
    success: true,
    data: {
      summary: {
        accountId: 'acc-1',
        username: 'alice',
        email: 'alice@example.com',
        creditBalanceCents: 5000,
        activeKeyCount: 1,
        totalKeyCount: 2,
        totalSpendCents: 1234,
        totalQuotaCents: 10000,
        gatewayCalls: 42,
        gatewaySpendCents: 2345,
        lastKeyActivityAt: '2026-06-14T12:00:00.000Z',
      },
      keys: [
        {
          id: 'key-1',
          prefix: 'exc_abc',
          name: '生产',
          scope: 'gateway',
          rateLimitPerMinute: 60,
          quotaMaxCents: 10000,
          totalSpendCents: 1234,
          quotaResetAt: null,
          lastUsedAt: '2026-06-14T12:00:00.000Z',
          createdAt: '2026-06-01T00:00:00.000Z',
          revokedAt: null,
        },
        {
          id: 'key-2',
          prefix: 'exc_xyz',
          name: null,
          scope: 'all',
          rateLimitPerMinute: null,
          quotaMaxCents: null,
          totalSpendCents: 0,
          quotaResetAt: null,
          lastUsedAt: null,
          createdAt: '2026-06-02T00:00:00.000Z',
          revokedAt: '2026-06-10T00:00:00.000Z',
        },
      ],
      recentGatewayRecords: [
        { id: 'rec-1', model: 'qwen-plus', status: 'succeeded', costCents: 100, createdAt: '2026-06-14T10:00:00.000Z' },
      ],
    },
  }
}

describe('admin page', () => {
  it('renders overview metrics and recent failures', async () => {
    mockFetchAdminOverview.mockResolvedValue(makeOverview())

    renderAdmin()

    expect(await screen.findByText('管理后台')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('活跃 8')).toBeInTheDocument()
    expect(screen.getAllByText('provider timeout').length).toBeGreaterThan(0)
    expect(screen.getAllByText('canvas.analyze').length).toBeGreaterThan(0)
    expect(await screen.findByText('任务诊断')).toBeInTheDocument()
  })

  it('shows forbidden/error state and can retry', async () => {
    const user = userEvent.setup()
    mockFetchAdminOverview.mockRejectedValueOnce(new Error('无权访问管理后台'))
    mockFetchAdminOverview.mockResolvedValueOnce(makeOverview())

    renderAdmin()

    expect(await screen.findByText('无法访问管理后台')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /重试/ }))
    expect(await screen.findByText('管理后台')).toBeInTheDocument()
    expect(mockFetchAdminOverview).toHaveBeenCalledTimes(2)
  })

  it('can requeue a failed task from the diagnostics table', async () => {
    const user = userEvent.setup()
    mockFetchAdminOverview.mockResolvedValue(makeOverview())

    renderAdmin()

    await screen.findByText('任务诊断')
    await user.click(await screen.findByRole('button', { name: /重排/ }))

    expect(mockRequeueAdminTask.mock.calls[0]?.[0]).toBe('task-1')
    await waitFor(() => {
      expect(mockFetchAdminTasks).toHaveBeenCalledTimes(2)
    })
  })

  // ── 新增：任务详情 dialog ─────────────────

  describe('task detail dialog', () => {
    it('opens detail dialog on row 详情 click and renders pipeline run timeline', async () => {
      const user = userEvent.setup()
      mockFetchAdminOverview.mockResolvedValue(makeOverview())

      renderAdmin()
      await screen.findByText('任务诊断')

      await user.click(await screen.findByRole('button', { name: '详情' }))

      expect(await screen.findByText('Canvas pipeline run 时间线')).toBeInTheDocument()
      expect(screen.getAllByText('分析').length).toBeGreaterThan(0)
      expect(screen.getAllByText('分镜').length).toBeGreaterThan(0)
      expect(screen.getByText('LLM 输出校验失败')).toBeInTheDocument()
      expect(mockFetchAdminTaskDetail).toHaveBeenCalledWith('task-1')
    })

    it('shows empty hint when pipelineRuns is empty', async () => {
      const user = userEvent.setup()
      mockFetchAdminOverview.mockResolvedValue(makeOverview())
      mockFetchAdminTaskDetail.mockResolvedValueOnce(makeAdminTaskDetailResponse({ pipelineRuns: [] }))

      renderAdmin()
      await screen.findByText('任务诊断')
      await user.click(await screen.findByRole('button', { name: '详情' }))

      expect(await screen.findByText(/无关联 Canvas pipeline run/)).toBeInTheDocument()
    })

    it('requeue button inside dialog triggers mutation', async () => {
      const user = userEvent.setup()
      mockFetchAdminOverview.mockResolvedValue(makeOverview())

      renderAdmin()
      await screen.findByText('任务诊断')
      await user.click(await screen.findByRole('button', { name: '详情' }))

      // dialog 内的重排按钮（第一个匹配）
      await user.click(await screen.findByText('Canvas pipeline run 时间线'))
      const requeueButtons = await screen.findAllByRole('button', { name: /重排/ })
      // 至少存在 dialog 内的重排按钮
      expect(requeueButtons.length).toBeGreaterThanOrEqual(1)
      await user.click(requeueButtons[requeueButtons.length - 1]!)
      await waitFor(() => {
        expect(mockRequeueAdminTask).toHaveBeenCalled()
      })
    })
  })

  // ── 新增：用户 tab + Provider tab ─────────────────

  describe('users tab', () => {
    it('renders user list when switching to users tab', async () => {
      const user = userEvent.setup()
      mockFetchAdminOverview.mockResolvedValue(makeOverview())

      renderAdmin()

      await screen.findByText('管理后台')
      await user.click(screen.getByRole('button', { name: '用户' }))

      expect(await screen.findByText('alice')).toBeInTheDocument()
      expect(screen.getByText('alice@example.com')).toBeInTheDocument()
      expect(mockFetchAdminUsers).toHaveBeenCalled()
    })

    it('search input triggers debounced fetch', async () => {
      const user = userEvent.setup()
      mockFetchAdminOverview.mockResolvedValue(makeOverview())
      // 用变体 username 模拟 search 命中
      mockFetchAdminUsers.mockResolvedValueOnce(makeAdminUsersResponse())
      mockFetchAdminUsers.mockResolvedValueOnce(makeAdminUsersResponse({
        items: [{
          id: 'acc-2',
          username: 'bob',
          email: 'bob@example.com',
          isActive: true,
          createdAt: '2026-06-01T00:00:00.000Z',
          lastActivityAt: '2026-06-14T12:00:00.000Z',
          creditBalanceCents: 100,
          totalCostCents: 50,
          totalCalls: 1,
        }],
        total: 1,
      }))

      renderAdmin()
      await screen.findByText('管理后台')
      await user.click(screen.getByRole('button', { name: '用户' }))
      await screen.findByText('alice')

      await user.type(screen.getByLabelText('搜索用户'), 'bob')

      await waitFor(() => {
        expect(mockFetchAdminUsers.mock.calls.some(args => args[0]?.search === 'bob')).toBe(true)
      })
    })

    it('opens detail dialog when clicking a row', async () => {
      const user = userEvent.setup()
      mockFetchAdminOverview.mockResolvedValue(makeOverview())

      renderAdmin()
      await screen.findByText('管理后台')
      await user.click(screen.getByRole('button', { name: '用户' }))
      await screen.findByText('alice')

      await user.click(screen.getByText('alice'))

      expect(await screen.findByText('最近 30 天成本趋势')).toBeInTheDocument()
      expect(screen.getByText('模型成本分解（前 10）')).toBeInTheDocument()
      expect(mockFetchAdminUserDetail).toHaveBeenCalledWith('acc-1')
    })
  })

  describe('provider tab', () => {
    it('renders provider table with stats when switching to providers tab', async () => {
      const user = userEvent.setup()
      mockFetchAdminOverview.mockResolvedValue(makeOverview())

      renderAdmin()
      await screen.findByText('管理后台')
      await user.click(screen.getByRole('button', { name: 'Provider' }))

      expect(await screen.findByText('qwen-plus')).toBeInTheDocument()
      expect(screen.getByText('5.0%')).toBeInTheDocument() // failureRate
      expect(mockFetchAdminProviderStats).toHaveBeenCalled()
    })

    it('switching windowHours triggers refetch', async () => {
      const user = userEvent.setup()
      mockFetchAdminOverview.mockResolvedValue(makeOverview())

      renderAdmin()
      await screen.findByText('管理后台')
      await user.click(screen.getByRole('button', { name: 'Provider' }))
      await screen.findByText('qwen-plus')

      // 切到近 1 小时（Radix Select：打开 combobox 后点选 option）
      await user.click(screen.getByRole('combobox'))
      await user.click(await screen.findByRole('option', { name: '近 1 小时' }))

      await waitFor(() => {
        expect(mockFetchAdminProviderStats.mock.calls.some(args => args[0]?.windowHours === 1)).toBe(true)
      })
    })
  })

  // ── 新增：Gateway 客户管理 tab ─────────────────

  describe('gateway tab', () => {
    it('renders gateway client list when switching to gateway tab', async () => {
      const user = userEvent.setup()
      mockFetchAdminOverview.mockResolvedValue(makeOverview())

      renderAdmin()
      await screen.findByText('管理后台')

      await user.click(screen.getByRole('button', { name: 'Gateway 客户' }))

      expect(await screen.findByText('alice')).toBeInTheDocument()
      expect(screen.getByText('alice@example.com')).toBeInTheDocument()
      expect(mockFetchAdminGatewayClients).toHaveBeenCalled()
    })

    it('opens detail dialog with keys + recent records when clicking a row', async () => {
      const user = userEvent.setup()
      mockFetchAdminOverview.mockResolvedValue(makeOverview())

      renderAdmin()
      await screen.findByText('管理后台')
      await user.click(screen.getByRole('button', { name: 'Gateway 客户' }))
      await screen.findByText('alice')

      await user.click(screen.getByText('alice'))

      expect(await screen.findByText('API Key 管理')).toBeInTheDocument()
      expect(screen.getByText('最近 Gateway 调用记录（前 50）')).toBeInTheDocument()
      expect(mockFetchAdminGatewayClientDetail).toHaveBeenCalledWith('acc-1')
    })

    it('revokes a key via the action button + confirm dialog', async () => {
      const user = userEvent.setup()
      mockFetchAdminOverview.mockResolvedValue(makeOverview())

      renderAdmin()
      await screen.findByText('管理后台')
      await user.click(screen.getByRole('button', { name: 'Gateway 客户' }))
      await screen.findByText('alice')
      await user.click(screen.getByText('alice'))

      // detail dialog 渲染活跃 key（key-1）行，带「撤销」按钮
      await screen.findByText('API Key 管理')
      await user.click(await screen.findByRole('button', { name: /撤销/ }))

      // 确认 dialog
      expect(await screen.findByText('确认撤销该 Key？')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: '确认' }))

      await waitFor(() => {
        expect(mockRevokeApiKeyAdmin).toHaveBeenCalledWith('key-1')
      })
    })
  })
})
