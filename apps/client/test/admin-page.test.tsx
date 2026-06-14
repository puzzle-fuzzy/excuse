import type { AdminOverview, AdminTaskItem } from '../src/api/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelAdminTask, fetchAdminOverview, fetchAdminTasks, requeueAdminTask } from '../src/api/client'
import Admin from '../src/pages/Admin'

vi.mock('../src/api/client', () => ({
  fetchAdminOverview: vi.fn(),
  fetchAdminTasks: vi.fn(),
  requeueAdminTask: vi.fn(),
  cancelAdminTask: vi.fn(),
}))

const mockFetchAdminOverview = vi.mocked(fetchAdminOverview)
const mockFetchAdminTasks = vi.mocked(fetchAdminTasks)
const mockRequeueAdminTask = vi.mocked(requeueAdminTask)
const mockCancelAdminTask = vi.mocked(cancelAdminTask)

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
})

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
})
