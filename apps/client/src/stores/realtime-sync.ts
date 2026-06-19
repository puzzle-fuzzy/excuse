import type { CanvasEntityPatch, SSEGenerationStatusEvent, SSENotificationEvent, SSEPipelineNodeEvent } from '@excuse/shared'
import { create } from 'zustand'
import { canvasAssetsPollingQueryKeys, canvasPipelineRunsQueryKeys, queryClient } from '@/api/query-client'
import { sseClient } from '@/api/sse'
import { handleNotificationSSEEvent } from '@/stores/notifications'
import { useGenerationStore } from './generation'
import { useSubtitleStore } from './subtitle'

interface PhaseDoneEvent {
  projectId: string
  key: string
  status: 'completed' | 'failed'
  error?: string
}

/** SSE/轮询连接模式三态 */
export type ConnectionMode = 'sse' | 'polling' | 'disconnected'

interface RealtimeSyncState {
  /** Pipeline 阶段完成信号 — 由 PipelineController 消费 */
  phaseDone: PhaseDoneEvent | null
  consumePhaseDone: () => void

  /**
   * 项目版本计数器 — CanvasEditor watch projectVersions[projectId]
   * 每次 pipeline_node_update 到达时递增，触发 CanvasEditor 重新加载项目
   */
  projectVersions: Record<string, number>

  /**
   * 实体补丁队列 — SSE 事件携带具体实体变更时，不递增 projectVersion，
   * 而是将补丁存入此队列供 CanvasEditor 消费做局部更新。
   */
  entityPatches: CanvasEntityPatch[]

  /** 消费并清空指定项目的实体补丁 */
  consumeEntityPatches: (projectId: string) => CanvasEntityPatch[]

  /** SSE/轮询连接模式 — SSE 正常 | polling 降级 | 断开 */
  connectionMode: ConnectionMode

  /** 最近一次 SSE 事件或成功轮询的时间戳（epoch ms） */
  lastEventAt: number | null

  /** 更新连接模式 — 由 SSEClient 回调和 polling hook 驱动 */
  setConnectionMode: (mode: ConnectionMode) => void

  /**
   * 注册 SSE 事件订阅 — 在 App.tsx 中调用一次
   * @returns 取消订阅函数
   */
  initialize: () => () => void
}

export const useRealtimeSync = create<RealtimeSyncState>((set, get) => ({
  phaseDone: null,
  projectVersions: {},
  entityPatches: [],
  connectionMode: 'sse', // 初始假设 SSE 连接即将建立
  lastEventAt: null,

  setConnectionMode: (mode: ConnectionMode) => {
    set({ connectionMode: mode })
  },

  consumePhaseDone: () => {
    set({ phaseDone: null })
  },

  consumeEntityPatches: (projectId: string) => {
    const { entityPatches } = get()
    const patches = entityPatches.filter(p => p.projectId === projectId)
    if (patches.length > 0) {
      set({ entityPatches: entityPatches.filter(p => p.projectId !== projectId) })
    }
    return patches
  },

  initialize: () => {
    const unsubPipeline = sseClient.on('pipeline_node_update', (event: SSEPipelineNodeEvent) => {
      handlePipelineNodeUpdate(event, set, get)
      // 收到 SSE 事件 → 更新 lastEventAt
      set({ lastEventAt: Date.now() })
    })

    const unsubGeneration = sseClient.on('generation_status', (event: SSEGenerationStatusEvent) => {
      set({ lastEventAt: Date.now() })
      if (event.category === 'subtitle') {
        // 字幕任务的状态变更 — 刷新当前项目详情
        const currentProject = useSubtitleStore.getState().currentProject
        if (currentProject) {
          useSubtitleStore.getState().selectProject(currentProject.id)
        }
        // 同时更新项目列表
        useSubtitleStore.getState().loadProjects()
      }
      else {
        useGenerationStore.getState().updateRecordFromSSE(event)
      }
    })

    // P2-2：新通知 — React Query invalidation + 乐观更新
    const unsubNotification = sseClient.on('notification', (event: SSENotificationEvent) => {
      set({ lastEventAt: Date.now() })
      handleNotificationSSEEvent(event)
    })

    const unsubOpen = sseClient.onOpen(() => {
      // SSE 连接成功 → 恢复 sse 模式
      set({ connectionMode: 'sse' })
      // 首次连接/重连后刷新兜底快照，补偿连接建立前或断连期间丢失的事件。
      useGenerationStore.getState().fetchRecords()
      queryClient.invalidateQueries({ queryKey: canvasAssetsPollingQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: canvasPipelineRunsQueryKeys.all })
    })

    const unsubClose = sseClient.onClose(() => {
      // SSE 重连耗尽 → 切换到 polling 降级模式
      set({ connectionMode: 'polling' })
    })

    return () => {
      unsubPipeline()
      unsubGeneration()
      unsubNotification()
      unsubOpen()
      unsubClose()
    }
  },
}))

function handlePipelineNodeUpdate(
  event: SSEPipelineNodeEvent,
  set: (partial: Partial<RealtimeSyncState>) => void,
  get: () => RealtimeSyncState,
) {
  const { projectVersions, entityPatches } = get()

  // Phase 级别事件 → 全量版本递增（阶段完成/失败需整体刷新）
  if (event.nodeType === 'phase') {
    set({
      projectVersions: {
        ...projectVersions,
        [event.projectId]: (projectVersions[event.projectId] || 0) + 1,
      },
    })

    // Pipeline 阶段完成信号 — 传递给 PipelineController
    if (event.status === 'completed' || event.status === 'failed') {
      set({
        phaseDone: {
          projectId: event.projectId,
          key: event.nodeId,
          status: event.status === 'completed' ? 'completed' : 'failed',
          error: event.error,
        },
      })
    }
    return
  }

  // 实体级别事件（shot/character/location）→ 存入补丁队列，不做全量 reload
  // CanvasEditor 消费这些补丁做局部更新
  const patch: CanvasEntityPatch = {
    projectId: event.projectId,
    nodeType: event.nodeType,
    nodeId: event.nodeId,
    status: event.status,
    error: event.error,
    data: event.data,
  }
  set({ entityPatches: [...entityPatches, patch] })
}
