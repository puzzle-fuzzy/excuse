import type { CanvasAssetsPoll } from '@excuse/shared'
import type { ReactNode } from 'react'
import type { CanvasPollDeltaTarget } from '../src/lib/canvas-poll'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCanvasAssetsPolling } from '../src/hooks/use-canvas-assets-polling'
import { buildActiveImageTaskMaps, hasCanvasPollDelta } from '../src/lib/canvas-poll'
import { useRealtimeSync } from '../src/stores/realtime-sync'

// ── Mocks（针对 hook 测试段）────────────────────────────────

vi.mock('../src/api/client', () => ({
  pollCanvasAssets: vi.fn(),
}))

const { pollCanvasAssets } = await import('../src/api/client')

// ── Fixtures ──────────────────────────────────────────────

/** 构造一个完整的最小 CanvasAssetsPoll，测试只覆盖关心的字段 */
function makePoll(overrides: Partial<CanvasAssetsPoll> = {}): CanvasAssetsPoll {
  return {
    scope: 'canvas',
    projectId: 'proj-1',
    projectStatus: 'analyzed',
    characters: [],
    locations: [],
    shots: [],
    activeTasks: [],
    recentFailures: [],
    costs: [],
    costSummary: {
      totalEstimatedCents: 0,
      totalFinalCents: 0,
      totalFailedCents: 0,
      byPhase: {},
    },
    generatedAt: 0,
    ...overrides,
  }
}

/** 构造一个与给定 poll 快照「对齐」的本地 project（无差异） */
function makeProject(poll: CanvasAssetsPoll): CanvasPollDeltaTarget {
  return {
    status: poll.projectStatus,
    characters: poll.characters.map(c => ({
      id: c.characterId,
      referenceImageUrl: c.referenceImageUrl,
      turnaroundSheetUrl: c.turnaroundSheetUrl,
    })),
    locations: poll.locations.map(l => ({
      id: l.locationId,
      referenceImageUrl: l.referenceImageUrl,
    })),
    shots: poll.shots.map(s => ({ id: s.shotId, status: s.status })),
  }
}

// ── hasCanvasPollDelta ────────────────────────────────────

describe('hasCanvasPollDelta', () => {
  it('poll 与 project 完全一致时返回 false', () => {
    const poll = makePoll({
      characters: [{ characterId: 'c1', name: '主角', referenceImageUrl: 'img-a', turnaroundSheetUrl: null, activeImageTaskIds: [] }],
      locations: [{ locationId: 'l1', name: '客厅', referenceImageUrl: 'loc-a', activeImageTaskIds: [] }],
      shots: [{ shotId: 's1', shotIndex: 0, status: 'ready', videoUrl: null, activeVideoTaskIds: [] }],
    })
    expect(hasCanvasPollDelta(makeProject(poll), poll)).toBe(false)
  })

  it('projectStatus 不同时返回 true（阶段推进）', () => {
    const poll = makePoll({ projectStatus: 'characters_ready' })
    const project = makeProject(makePoll({ projectStatus: 'analyzed' }))
    expect(hasCanvasPollDelta(project, poll)).toBe(true)
  })

  it('镜头状态不同时返回 true（视频生成进度）', () => {
    const poll = makePoll({
      shots: [{ shotId: 's1', shotIndex: 0, status: 'completed', videoUrl: 'v', activeVideoTaskIds: [] }],
    })
    const project = makeProject(makePoll({
      shots: [{ shotId: 's1', shotIndex: 0, status: 'generating', videoUrl: null, activeVideoTaskIds: [] }],
    }))
    expect(hasCanvasPollDelta(project, poll)).toBe(true)
  })

  it('角色参考图 URL 不同时返回 true（polling 模式图片逐个完成）', () => {
    const poll = makePoll({
      characters: [{ characterId: 'c1', name: '主角', referenceImageUrl: 'img-new', turnaroundSheetUrl: null, activeImageTaskIds: [] }],
    })
    const project = makeProject(makePoll({
      characters: [{ characterId: 'c1', name: '主角', referenceImageUrl: null, turnaroundSheetUrl: null, activeImageTaskIds: [] }],
    }))
    expect(hasCanvasPollDelta(project, poll)).toBe(true)
  })

  it('角色转面图 URL 不同时返回 true', () => {
    const poll = makePoll({
      characters: [{ characterId: 'c1', name: '主角', referenceImageUrl: null, turnaroundSheetUrl: 'turn-new', activeImageTaskIds: [] }],
    })
    const project = makeProject(makePoll({
      characters: [{ characterId: 'c1', name: '主角', referenceImageUrl: null, turnaroundSheetUrl: null, activeImageTaskIds: [] }],
    }))
    expect(hasCanvasPollDelta(project, poll)).toBe(true)
  })

  it('场景参考图 URL 不同时返回 true', () => {
    const poll = makePoll({
      locations: [{ locationId: 'l1', name: '客厅', referenceImageUrl: 'loc-new', activeImageTaskIds: [] }],
    })
    const project = makeProject(makePoll({
      locations: [{ locationId: 'l1', name: '客厅', referenceImageUrl: null, activeImageTaskIds: [] }],
    }))
    expect(hasCanvasPollDelta(project, poll)).toBe(true)
  })

  it('poll 中存在 project 没有的角色时返回 true', () => {
    const poll = makePoll({
      characters: [{ characterId: 'c-new', name: '新角色', referenceImageUrl: null, turnaroundSheetUrl: null, activeImageTaskIds: [] }],
    })
    const project = makeProject(makePoll())
    expect(hasCanvasPollDelta(project, poll)).toBe(true)
  })
})

// ── buildActiveImageTaskMaps ──────────────────────────────

describe('buildActiveImageTaskMaps', () => {
  it('pollData 为 null/undefined 时返回空 Map', () => {
    expect(buildActiveImageTaskMaps(null)).toEqual({ character: new Map(), location: new Map() })
    expect(buildActiveImageTaskMaps(undefined)).toEqual({ character: new Map(), location: new Map() })
  })

  it('无活跃图片任务时返回空 Map', () => {
    const poll = makePoll({
      characters: [{ characterId: 'c1', name: '主角', referenceImageUrl: null, turnaroundSheetUrl: null, activeImageTaskIds: [] }],
      locations: [{ locationId: 'l1', name: '客厅', referenceImageUrl: null, activeImageTaskIds: [] }],
    })
    expect(buildActiveImageTaskMaps(poll)).toEqual({ character: new Map(), location: new Map() })
  })

  it('把有活跃任务的角色/场景映射到任务 ID 列表，跳过空数组', () => {
    const poll = makePoll({
      characters: [
        { characterId: 'c1', name: '主角', referenceImageUrl: null, turnaroundSheetUrl: null, activeImageTaskIds: ['task-1', 'task-2'] },
        { characterId: 'c2', name: '配角', referenceImageUrl: null, turnaroundSheetUrl: null, activeImageTaskIds: [] },
      ],
      locations: [
        { locationId: 'l1', name: '客厅', referenceImageUrl: null, activeImageTaskIds: ['task-3'] },
      ],
    })
    const { character, location } = buildActiveImageTaskMaps(poll)

    expect(character.get('c1')).toEqual(['task-1', 'task-2'])
    expect(character.has('c2')).toBe(false)
    expect(location.get('l1')).toEqual(['task-3'])
  })
})

// ── useCanvasAssetsPolling hook（react-query 改造）──────────────
//
// 验证要点：
//   - refetchIntervalFor 纯函数：4 种 connectionMode × activeTasks 组合
//   - projectId 切换会切换 queryKey 触发新 fetch
//   - projectVersion 变化触发 invalidateQueries
//   - placeholderData 保持上一份数据
//   - 返回 shape 向后兼容
//
// 注：react-query 的内部异步调度与 fake timers 难以稳定共存，
// 因此 refetchInterval 的「时间间隔」由 refetchIntervalFor 纯函数单测覆盖；
// 集成测试只验证「事件触发 fetch」行为，不验证「定时器到点」时序。

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false, // 测试友好：失败立即返回，不重试
        staleTime: 0,
        gcTime: 0,
      },
    },
  })
}

function resetRealtimeSync(overrides: { connectionMode?: 'sse' | 'polling' | 'disconnected', projectVersions?: Record<string, number> } = {}) {
  // 重置 zustand store 到已知状态，避免上一个测试的副作用
  act(() => {
    useRealtimeSync.setState({
      connectionMode: overrides.connectionMode ?? 'sse',
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

// ── refetchIntervalFor 纯函数（覆盖 4 种 connectionMode × activeTasks 组合）──

describe('refetchIntervalFor', () => {
  it('sse 模式恒为 5000ms（与 activeTasks 无关）', async () => {
    const { refetchIntervalFor } = await import('../src/hooks/use-canvas-assets-polling')
    expect(refetchIntervalFor('sse', true)).toBe(5000)
    expect(refetchIntervalFor('sse', false)).toBe(5000)
  })

  it('polling 模式 + 有 activeTasks → 2000ms', async () => {
    const { refetchIntervalFor } = await import('../src/hooks/use-canvas-assets-polling')
    expect(refetchIntervalFor('polling', true)).toBe(2000)
  })

  it('polling 模式 + 无 activeTasks → 10000ms（idle 节流）', async () => {
    const { refetchIntervalFor } = await import('../src/hooks/use-canvas-assets-polling')
    expect(refetchIntervalFor('polling', false)).toBe(10000)
  })

  it('disconnected 模式 → false（不轮询）', async () => {
    const { refetchIntervalFor } = await import('../src/hooks/use-canvas-assets-polling')
    expect(refetchIntervalFor('disconnected', true)).toBe(false)
    expect(refetchIntervalFor('disconnected', false)).toBe(false)
  })
})

// ── useCanvasAssetsPolling 集成行为 ─────────────────────────────

describe('useCanvasAssetsPolling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetRealtimeSync()
  })

  it('projectId 存在且 connectionMode=sse 时立即发起首次轮询并填充 pollData', async () => {
    const poll = makePoll({ projectId: 'proj-1', projectStatus: 'analyzed' })
    vi.mocked(pollCanvasAssets).mockResolvedValue(poll)

    const { result } = renderHook(
      () => useCanvasAssetsPolling('proj-1'),
      { wrapper: wrapperWith(makeQueryClient()) },
    )

    await waitFor(() => {
      expect(result.current.pollData).not.toBeNull()
    })
    expect(pollCanvasAssets).toHaveBeenCalledWith('proj-1')
    expect(result.current.pollData).toEqual(poll)
    expect(result.current.connectionMode).toBe('sse')
    expect(result.current.lastPollAt).not.toBeNull()
  })

  it('projectId 切换时切换 queryKey 触发新 fetch', async () => {
    const pollA = makePoll({ projectId: 'proj-a', projectStatus: 'analyzed' })
    const pollB = makePoll({ projectId: 'proj-b', projectStatus: 'characters_ready' })
    vi.mocked(pollCanvasAssets).mockResolvedValueOnce(pollA).mockResolvedValueOnce(pollB)

    let currentProjectId: string | undefined = 'proj-a'
    const { result, rerender } = renderHook(
      () => useCanvasAssetsPolling(currentProjectId),
      { wrapper: wrapperWith(makeQueryClient()) },
    )

    await waitFor(() => expect(result.current.pollData).toEqual(pollA))

    currentProjectId = 'proj-b'
    rerender()

    await waitFor(() => expect(result.current.pollData).toEqual(pollB))
    expect(pollCanvasAssets).toHaveBeenNthCalledWith(1, 'proj-a')
    expect(pollCanvasAssets).toHaveBeenNthCalledWith(2, 'proj-b')
  })

  it('connectionMode=disconnected 时 enabled=false，不发起 fetch', () => {
    resetRealtimeSync({ connectionMode: 'disconnected' })
    vi.mocked(pollCanvasAssets).mockResolvedValue(makePoll())

    renderHook(
      () => useCanvasAssetsPolling('proj-1'),
      { wrapper: wrapperWith(makeQueryClient()) },
    )

    expect(pollCanvasAssets).not.toHaveBeenCalled()
  })

  it('projectVersion 变化时触发 invalidateQueries（重新 fetch）', async () => {
    vi.mocked(pollCanvasAssets).mockResolvedValue(makePoll({ projectId: 'proj-1' }))
    resetRealtimeSync({ connectionMode: 'sse', projectVersions: {} })

    renderHook(
      () => useCanvasAssetsPolling('proj-1'),
      { wrapper: wrapperWith(makeQueryClient()) },
    )

    await waitFor(() => expect(pollCanvasAssets).toHaveBeenCalledTimes(1))

    // 模拟 SSE pipeline_node_update → 递增 projectVersion
    act(() => {
      useRealtimeSync.setState(s => ({
        projectVersions: { ...s.projectVersions, 'proj-1': 1 },
      }))
    })

    await waitFor(() => expect(pollCanvasAssets).toHaveBeenCalledTimes(2))
  })

  it('placeholderData: refetch 期间 pollData 不会回退到 null', async () => {
    const first = makePoll({ projectId: 'proj-1', projectStatus: 'analyzed' })

    let resolveFirst!: (v: CanvasAssetsPoll) => void
    vi.mocked(pollCanvasAssets)
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r }))
      .mockImplementationOnce(() => new Promise(() => {})) // 永不 resolve —— 模拟 refetch in-flight

    const { result } = renderHook(
      () => useCanvasAssetsPolling('proj-1'),
      { wrapper: wrapperWith(makeQueryClient()) },
    )

    resolveFirst(first)
    await waitFor(() => expect(result.current.pollData).toEqual(first))

    // 触发 refetch（projectVersion 变化）
    act(() => {
      useRealtimeSync.setState(s => ({
        projectVersions: { ...s.projectVersions, 'proj-1': 1 },
      }))
    })

    // refetch 进行中（永不 resolve），pollData 应仍保留 first（placeholderData 生效）
    await waitFor(() => expect(pollCanvasAssets).toHaveBeenCalledTimes(2))
    expect(result.current.pollData).toEqual(first)
  })

  it('返回 shape 向后兼容：包含 5 个字段', async () => {
    vi.mocked(pollCanvasAssets).mockResolvedValue(makePoll({ projectId: 'proj-1' }))

    const { result } = renderHook(
      () => useCanvasAssetsPolling('proj-1'),
      { wrapper: wrapperWith(makeQueryClient()) },
    )

    await waitFor(() => expect(result.current.pollData).not.toBeNull())

    expect(result.current).toHaveProperty('pollData')
    expect(result.current).toHaveProperty('connectionMode')
    expect(result.current).toHaveProperty('isPolling')
    expect(result.current).toHaveProperty('lastPollAt')
    expect(typeof result.current.refresh).toBe('function')
  })

  it('refresh() 手动触发一次 refetch', async () => {
    vi.mocked(pollCanvasAssets).mockResolvedValue(makePoll({ projectId: 'proj-1' }))

    const { result } = renderHook(
      () => useCanvasAssetsPolling('proj-1'),
      { wrapper: wrapperWith(makeQueryClient()) },
    )

    await waitFor(() => expect(pollCanvasAssets).toHaveBeenCalledTimes(1))

    act(() => {
      result.current.refresh()
    })

    await waitFor(() => expect(pollCanvasAssets).toHaveBeenCalledTimes(2))
  })
})
