/**
 * Canvas PipelineController 兜底轮询 Hook — 基于 react-query
 *
 * 设计约束：
 *   - SSE 主路径（`phaseDone` 事件）由 `useRealtimeSync` 接管并直接驱动 onPhaseComplete；
 *     本 hook 仅作为 SSE 断线 / 漏事件时的兜底，避免自动执行卡在 running。
 *   - 不暴露业务推进逻辑（advance / setError）：消费方在 useEffect 里 watch `runs`，
 *     按 `activeRunId` 或 `phase.key + status` 命中规则推进，行为与原 setInterval 实现一致。
 *   - `projectVersion` 变化时主动 invalidate，让 SSE 事件也能立刻触发一次 fetch（与 canvas 资产轮询一致）。
 *
 * 注意：polling 是兜底数据通道，ProjectDTO（getCanvasProject）+ phaseDone SSE 仍是权威。
 */
import type { CanvasPipelineRunDTO } from '@excuse/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { fetchCanvasPipelineRuns } from '@/api/client'
import { canvasPipelineRunsQueryKeys } from '@/api/query-client'
import { useRealtimeSync } from '@/stores/realtime-sync'

/** Pipeline-run 兜底轮询间隔（ms），与原 PipelineController 内 setInterval 一致 */
const PIPELINE_RUNS_POLL_INTERVAL_MS = 3000

export interface UseCanvasPipelineRunsPollingOptions {
  /** 是否启用轮询；通常 = `running && currentPhase >= 0` */
  enabled: boolean
}

export interface UseCanvasPipelineRunsPollingResult {
  /** 最新一次轮询拿到的 runs；首轮未完成或被禁用时为 undefined */
  runs: CanvasPipelineRunDTO[] | undefined
  /** 是否正在拉取（含初次 + refetch），等价于原 polling 的"正在轮询"语义 */
  isPolling: boolean
}

export function useCanvasPipelineRunsPolling(
  projectId: string | undefined,
  options: UseCanvasPipelineRunsPollingOptions,
): UseCanvasPipelineRunsPollingResult {
  const queryClient = useQueryClient()
  const projectVersion = useRealtimeSync(s => projectId ? s.projectVersions[projectId] : 0)

  const enabled = Boolean(projectId) && options.enabled

  const query = useQuery<CanvasPipelineRunDTO[]>({
    queryKey: projectId
      ? canvasPipelineRunsQueryKeys.poll(projectId)
      : ['canvas-pipeline-runs-poll', 'disabled'] as const,
    queryFn: () => fetchCanvasPipelineRuns(projectId!),
    enabled,
    refetchInterval: enabled ? PIPELINE_RUNS_POLL_INTERVAL_MS : false,
    placeholderData: prev => prev, // 轮询时保留上一份数据，避免 UI 闪烁
    staleTime: 0, // 每次 invalidate / mount 都重新请求（与原 polling 行为一致）
    gcTime: 30_000, // 项目切换后保留 30s，回切时秒显
    retry: 1, // 静默失败兜底 —— 下次轮询周期自动重试，与原 catch 语义一致
  })

  // projectVersion 变化（SSE pipeline_node_update 事件驱动）→ invalidateQueries
  // 依赖项严格限定为 [projectVersion]；projectId 变化由 useQuery 的 queryKey 自动失效。
  useEffect(() => {
    if (!projectId || projectVersion === 0)
      return
    queryClient.invalidateQueries({ queryKey: canvasPipelineRunsQueryKeys.poll(projectId) })
    // eslint-disable-next-line react/exhaustive-deps
  }, [projectVersion])

  return {
    runs: query.data,
    isPolling: query.isFetching,
  }
}
