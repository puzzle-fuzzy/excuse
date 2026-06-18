import type { CanvasPipelineRunDTO } from '@excuse/shared'
import type { ReactNode } from 'react'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCanvasPipelineRunsPolling } from '../src/hooks/use-canvas-pipeline-runs-polling'
import { useRealtimeSync } from '../src/stores/realtime-sync'

// ── Mocks ─────────────────────────────────────────────────

vi.mock('../src/api/client', () => ({
  fetchCanvasPipelineRuns: vi.fn(),
}))

const { fetchCanvasPipelineRuns } = await import('../src/api/client')

// ── Fixtures ──────────────────────────────────────────────

function makeRun(overrides: Partial<CanvasPipelineRunDTO> = {}): CanvasPipelineRunDTO {
  return {
    id: 'run-1',
    projectId: 'proj-1',
    phase: 'analyze',
    status: 'succeeded',
    startedAt: '2026-06-14T00:00:00.000Z',
    finishedAt: '2026-06-14T00:01:00.000Z',
    errorMessage: null,
    createdBy: null,
    inputSnapshotJson: null,
    outputSummaryJson: null,
    ...overrides,
  }
}

// ── Helpers ───────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
        gcTime: 0,
      },
    },
  })
}

function resetRealtimeSync(overrides: { projectVersions?: Record<string, number> } = {}) {
  act(() => {
    useRealtimeSync.setState({
      projectVersions: overrides.projectVersions ?? {},
      phaseDone: null,
      lastEventAt: null,
    })
  })
}

function wrapperWith(client: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
}

// ── useCanvasPipelineRunsPolling ───────────────────────────

describe('useCanvasPipelineRunsPolling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetRealtimeSync()
  })

  // ── enabled ────────────────────────────────────────────────

  it('enabled=true 时发起首次 fetch 并填充 runs', async () => {
    const runs = [makeRun({ phase: 'analyze', status: 'succeeded' })]
    vi.mocked(fetchCanvasPipelineRuns).mockResolvedValue(runs)

    const { result } = renderHook(
      () => useCanvasPipelineRunsPolling('proj-1', { enabled: true }),
      { wrapper: wrapperWith(makeQueryClient()) },
    )

    await waitFor(() => {
      expect(result.current.runs).toEqual(runs)
    })
    expect(fetchCanvasPipelineRuns).toHaveBeenCalledWith('proj-1')
  })

  it('enabled=false 时不发起 fetch，runs 为 undefined', () => {
    vi.mocked(fetchCanvasPipelineRuns).mockResolvedValue([makeRun()])

    const { result } = renderHook(
      () => useCanvasPipelineRunsPolling('proj-1', { enabled: false }),
      { wrapper: wrapperWith(makeQueryClient()) },
    )

    expect(result.current.runs).toBeUndefined()
    expect(fetchCanvasPipelineRuns).not.toHaveBeenCalled()
    expect(result.current.isPolling).toBe(false)
  })

  it('enabled 从 false 切换到 true 时启动 fetch', async () => {
    const runs = [makeRun({ phase: 'characters', status: 'succeeded' })]
    vi.mocked(fetchCanvasPipelineRuns).mockResolvedValue(runs)

    let enabled = false
    const { result, rerender } = renderHook(
      () => useCanvasPipelineRunsPolling('proj-1', { enabled }),
      { wrapper: wrapperWith(makeQueryClient()) },
    )

    expect(result.current.runs).toBeUndefined()
    expect(fetchCanvasPipelineRuns).not.toHaveBeenCalled()

    enabled = true
    rerender()

    await waitFor(() => {
      expect(result.current.runs).toEqual(runs)
    })
    expect(fetchCanvasPipelineRuns).toHaveBeenCalledTimes(1)
  })

  // ── projectId 切换 ─────────────────────────────────────────

  it('projectId 切换时 queryKey 变化触发新 fetch', async () => {
    const runsA = [makeRun({ projectId: 'proj-a', phase: 'analyze' })]
    const runsB = [makeRun({ projectId: 'proj-b', phase: 'characters' })]
    vi.mocked(fetchCanvasPipelineRuns)
      .mockResolvedValueOnce(runsA)
      .mockResolvedValueOnce(runsB)

    let projectId: string | undefined = 'proj-a'
    const { result, rerender } = renderHook(
      () => useCanvasPipelineRunsPolling(projectId, { enabled: true }),
      { wrapper: wrapperWith(makeQueryClient()) },
    )

    await waitFor(() => expect(result.current.runs).toEqual(runsA))

    projectId = 'proj-b'
    rerender()

    await waitFor(() => expect(result.current.runs).toEqual(runsB))
    expect(fetchCanvasPipelineRuns).toHaveBeenNthCalledWith(1, 'proj-a')
    expect(fetchCanvasPipelineRuns).toHaveBeenNthCalledWith(2, 'proj-b')
  })

  it('projectId 为 undefined 时 enabled=false（不发起 fetch）', () => {
    vi.mocked(fetchCanvasPipelineRuns).mockResolvedValue([makeRun()])

    const { result } = renderHook(
      () => useCanvasPipelineRunsPolling(undefined, { enabled: true }),
      { wrapper: wrapperWith(makeQueryClient()) },
    )

    expect(result.current.runs).toBeUndefined()
    expect(fetchCanvasPipelineRuns).not.toHaveBeenCalled()
  })

  // ── projectVersion invalidate ──────────────────────────────

  it('projectVersion 从 0 变为正数时触发 invalidateQueries（重新 fetch）', async () => {
    vi.mocked(fetchCanvasPipelineRuns).mockResolvedValue([makeRun()])
    resetRealtimeSync({ projectVersions: {} })

    const { result } = renderHook(
      () => useCanvasPipelineRunsPolling('proj-1', { enabled: true }),
      { wrapper: wrapperWith(makeQueryClient()) },
    )

    await waitFor(() => {
      expect(fetchCanvasPipelineRuns).toHaveBeenCalledTimes(1)
      expect(result.current.runs).toBeDefined()
    })

    // 模拟 SSE pipeline_node_update → 递增 projectVersion
    act(() => {
      useRealtimeSync.setState(s => ({
        projectVersions: { ...s.projectVersions, 'proj-1': 1 },
      }))
    })

    await waitFor(() => expect(fetchCanvasPipelineRuns).toHaveBeenCalledTimes(2))
  })

  it('projectVersion 为 0 时不触发 invalidate', async () => {
    vi.mocked(fetchCanvasPipelineRuns).mockResolvedValue([makeRun()])
    resetRealtimeSync({ projectVersions: { 'proj-1': 0 } })

    renderHook(
      () => useCanvasPipelineRunsPolling('proj-1', { enabled: true }),
      { wrapper: wrapperWith(makeQueryClient()) },
    )

    await waitFor(() => expect(fetchCanvasPipelineRuns).toHaveBeenCalledTimes(1))

    // 再次 setState 为 0 —— 不应触发额外 fetch
    act(() => {
      useRealtimeSync.setState({ projectVersions: { 'proj-1': 0 } })
    })

    // 给一点时间确认不会有额外调用
    await new Promise(r => setTimeout(r, 50))
    expect(fetchCanvasPipelineRuns).toHaveBeenCalledTimes(1)
  })

  // ── placeholderData ────────────────────────────────────────

  it('refetch 期间 runs 不会回退到 undefined（placeholderData 生效）', async () => {
    const first = [makeRun({ phase: 'analyze', status: 'succeeded' })]

    let resolveFirst!: (v: CanvasPipelineRunDTO[]) => void
    vi.mocked(fetchCanvasPipelineRuns)
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r }))
      .mockImplementationOnce(() => new Promise(() => {})) // 永不 resolve（refetch in-flight）

    const { result } = renderHook(
      () => useCanvasPipelineRunsPolling('proj-1', { enabled: true }),
      { wrapper: wrapperWith(makeQueryClient()) },
    )

    resolveFirst(first)
    await waitFor(() => expect(result.current.runs).toEqual(first))

    // 触发 refetch（projectVersion 变化）
    act(() => {
      useRealtimeSync.setState(s => ({
        projectVersions: { ...s.projectVersions, 'proj-1': 1 },
      }))
    })

    // refetch 进行中（永不 resolve），runs 应仍保留 first
    await waitFor(() => expect(fetchCanvasPipelineRuns).toHaveBeenCalledTimes(2))
    expect(result.current.runs).toEqual(first)
  })

  // ── 返回 shape ────────────────────────────────────────────

  it('返回 shape 包含 { runs, isPolling } 两个字段', async () => {
    vi.mocked(fetchCanvasPipelineRuns).mockResolvedValue([makeRun()])

    const { result } = renderHook(
      () => useCanvasPipelineRunsPolling('proj-1', { enabled: true }),
      { wrapper: wrapperWith(makeQueryClient()) },
    )

    await waitFor(() => expect(result.current.runs).toBeDefined())

    expect(result.current).toHaveProperty('runs')
    expect(result.current).toHaveProperty('isPolling')
    expect(Object.keys(result.current).length).toBe(2)
  })

  // ── 错误兜底 ──────────────────────────────────────────────

  it('fetchCanvasPipelineRuns 抛错时 runs 保持 undefined（兜底静默）', async () => {
    vi.mocked(fetchCanvasPipelineRuns).mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(
      () => useCanvasPipelineRunsPolling('proj-1', { enabled: true }),
      { wrapper: wrapperWith(makeQueryClient()) },
    )

    // runs 应保持 undefined（不抛到消费方）
    await waitFor(() => expect(fetchCanvasPipelineRuns).toHaveBeenCalled())
    expect(result.current.runs).toBeUndefined()
  })
})
