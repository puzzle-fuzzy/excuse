/**
 * Canvas 资产轮询 Hook — 基于 react-query 的自适应轮询
 *
 * 核心职责：
 *   1. refetchInterval 根据 connectionMode 动态计算
 *     - SSE 正常: 5s 补充性安全轮询
 *     - SSE 断线 → polling 降级: 有 activeTasks 时 2s，空闲时 10s
 *     - 断开: 不轮询（enabled = false）
 *   2. projectVersion 变化时 invalidateQueries（SSE 事件触发的轻量补充）
 *   3. 返回 pollData、connectionMode、isPolling、lastPollAt、refresh 供 CanvasEditor 使用
 *
 * 注意：polling 是补充性数据通道，ProjectDTO（getCanvasProject）仍是权威。
 * CanvasEditor 通过比较 pollData 和 project 的状态差异来决定是否触发 loadProject()。
 */
import type { CanvasAssetsPoll } from '@excuse/shared'
import type { ConnectionMode } from '@/stores/realtime-sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { pollCanvasAssets } from '@/api/client'
import { canvasAssetsPollingQueryKeys } from '@/api/query-client'
import { useRealtimeSync } from '@/stores/realtime-sync'

interface UseCanvasAssetsPollingResult {
  /** 最新轮询数据（null 直到首次成功轮询） */
  pollData: CanvasAssetsPoll | null
  /** SSE/轮询连接模式 */
  connectionMode: ConnectionMode
  /** 是否正在轮询 */
  isPolling: boolean
  /** 最近轮询时间戳 */
  lastPollAt: number | null
  /** 手动触发一次轮询 */
  refresh: () => void
}

/**
 * 各 connectionMode 下的轮询间隔（ms）；返回 false 表示不轮询。
 * - sse: 补充性安全轮询 5s
 * - polling 降级: 有 activeTasks 时 2s 活跃轮询，空闲时 10s
 * - disconnected: 不轮询
 *
 * 导出供单元测试直接断言（避免在集成测试里对抗 react-query 的异步调度）。
 */
export function refetchIntervalFor(mode: ConnectionMode, hasActiveTasks: boolean): number | false {
  switch (mode) {
    case 'sse':
      return 5000
    case 'polling':
      return hasActiveTasks ? 2000 : 10000
    case 'disconnected':
      return false
    default:
      return false
  }
}

export function useCanvasAssetsPolling(projectId: string | undefined): UseCanvasAssetsPollingResult {
  const queryClient = useQueryClient()
  const connectionMode = useRealtimeSync(s => s.connectionMode)
  const projectVersion = useRealtimeSync(s => projectId ? s.projectVersions[projectId] : 0)
  // lastPollAt 用 ref 维护，避免每次 queryFn 完成都触发组件 re-render（react-query 已经管了 data 状态）
  const lastPollAtRef = useRef<number | null>(null)

  const enabled = Boolean(projectId) && connectionMode !== 'disconnected'

  const query = useQuery<CanvasAssetsPoll>({
    queryKey: projectId
      ? canvasAssetsPollingQueryKeys.poll(projectId)
      : ['canvas-assets-poll', 'disabled'] as const,
    queryFn: async () => {
      const data = await pollCanvasAssets(projectId!)
      lastPollAtRef.current = Date.now()
      return data
    },
    enabled,
    // 回调形式避免 stale closure —— 每次 refetch 都用最新的 connectionMode + activeTasks
    refetchInterval: (q) => {
      const data = q.state.data as CanvasAssetsPoll | undefined
      const hasActive = Boolean(data?.activeTasks?.length)
      return refetchIntervalFor(connectionMode, hasActive)
    },
    placeholderData: prev => prev, // 轮询时保留上一份数据，避免 UI 闪烁
    staleTime: 0, // 每次 invalidate / mount 都重新请求（与原 polling 行为一致）
    gcTime: 30_000, // 项目切换后保留 30s，回切时秒显
    // 静默失败 —— 下次轮询周期自动重试，与原实现一致
    retry: 1,
  })

  // projectVersion 变化（SSE pipeline_node_update 事件驱动）→ invalidateQueries
  // 依赖项严格限定为 [projectVersion]；projectId 变化由 useQuery 的 queryKey 自动失效。
  useEffect(() => {
    if (!projectId || projectVersion === 0)
      return
    queryClient.invalidateQueries({ queryKey: canvasAssetsPollingQueryKeys.poll(projectId) })
    // eslint-disable-next-line react/exhaustive-deps
  }, [projectVersion])

  return {
    pollData: query.data ?? null,
    connectionMode,
    isPolling: query.isFetching,
    lastPollAt: lastPollAtRef.current,
    refresh: () => {
      void query.refetch()
    },
  }
}
