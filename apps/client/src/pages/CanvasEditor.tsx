import type { ProjectDTO } from '@excuse/shared'
import type { RunningPhaseInfo } from '../components/canvas/PipelineController'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { getCanvasProject } from '../api/client'
import CanvasFlow from '../components/canvas/CanvasFlow'
import CanvasStatusBar from '../components/canvas/CanvasStatusBar'
import CostPanel from '../components/canvas/CostPanel'
import NodeDetailPanel from '../components/canvas/NodeDetailPanel'
import PipelineController from '../components/canvas/PipelineController'
import TaskQueuePanel from '../components/canvas/TaskQueuePanel'
import { useCanvasAssetsPolling } from '../hooks/use-canvas-assets-polling'
import { applyEntityPatches } from '../lib/apply-entity-patches'
import { resolveFocusNodeWithProject } from '../lib/asset-library'
import { hasCanvasPollDelta } from '../lib/canvas-poll'
import { useRealtimeSync } from '../stores/realtime-sync'

export default function CanvasEditor() {
  const { projectId } = useParams<{ projectId: string }>()
  const [searchParams] = useSearchParams()
  const focusParam = searchParams.get('focus')
  const [project, setProject] = useState<ProjectDTO | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<{ id: string, type: string } | null>(null)
  const [runningPhase, setRunningPhase] = useState<RunningPhaseInfo | null>(null)
  const [showTaskQueue, setShowTaskQueue] = useState(false)
  const [showCost, setShowCost] = useState(false)

  // focus 消费 ref — 避免每次 project reload 都覆盖用户手动选择
  // 只在 URL focus 参数变化时重新消费
  const consumedFocusRef = useRef<string | null>(null)

  // 从 RealtimeSync 获取项目版本号、pipeline 阶段完成信号和实体补丁
  const projectVersion = useRealtimeSync(s => projectId ? s.projectVersions[projectId] : 0)
  const phaseDone = useRealtimeSync(s => s.phaseDone)
  const consumePhaseDone = useRealtimeSync(s => s.consumePhaseDone)
  // 用计数而非数组引用做 selector —— `.filter()` 每次返回新数组会让 zustand 认为 store 变了，
  // 导致每次任意 store 更新（connectionMode / lastEventAt 等）都重渲染并空跑下方 effect。
  // 返回 number 按值比较，仅在本项目补丁数真正变化时触发。
  const entityPatchCount = useRealtimeSync(s => projectId ? s.entityPatches.filter(p => p.projectId === projectId).length : 0)
  const consumeEntityPatches = useRealtimeSync(s => s.consumeEntityPatches)

  // 资产轮询 — SSE 降级时的补充性数据通道 + 状态差异检测
  const { pollData, connectionMode, isPolling } = useCanvasAssetsPolling(projectId)
  const lastReloadRef = useRef(0)

  const loadProject = useCallback(async () => {
    if (!projectId)
      return
    try {
      const res = await getCanvasProject(projectId)
      setProject(res.data)
    }
    catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    }
    finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    loadProject()
  }, [loadProject])

  // 项目版本号变化时重新加载（由 pipeline_node_update SSE 事件中的 phase 级别事件驱动）
  // 仅用 800ms 延迟加载，避免立即调用拿到尚未提交的旧数据
  useEffect(() => {
    if (projectVersion && projectVersion > 0) {
      const timer = window.setTimeout(loadProject, 800)
      return () => clearTimeout(timer)
    }
  }, [projectVersion, loadProject])

  // 实体补丁消费 — shot 状态/视频 URL 的局部 patch，不做全量 reload
  // （character/location 事件无可即时 patch 字段，由 useCanvasAssetsPolling 兜底；见 applyEntityPatches）
  useEffect(() => {
    if (entityPatchCount === 0 || !projectId || !project)
      return
    const patches = consumeEntityPatches(projectId)
    if (patches.length === 0)
      return
    setProject(applyEntityPatches(project, patches))
  }, [entityPatchCount, project, projectId, consumeEntityPatches])

  // URL focus 参数 → 自动选中节点（项目加载后消费一次）
  // focus 变化时重新消费；project reload 但 focus 不变时不覆盖用户手动选择
  useEffect(() => {
    if (!project || !focusParam)
      return
    if (consumedFocusRef.current === focusParam)
      return // 已消费，跳过
    const resolved = resolveFocusNodeWithProject(focusParam, project)
    if (resolved) {
      // 选中节点时关闭任务队列和成本面板，避免和右侧节点详情重叠
      setShowTaskQueue(false)
      setShowCost(false)
      setSelectedNode(resolved)
      consumedFocusRef.current = focusParam
    }
  }, [project, focusParam])

  // 脉冲数据与项目状态差异检测 — SSE 降级（polling fallback）时仍能发现状态/资产变化
  // 防止频繁重载：5 秒内只允许一次差异触发的 reload
  useEffect(() => {
    if (!pollData || !project)
      return
    const now = Date.now()
    if (now - lastReloadRef.current < 5000)
      return

    // 比对项目状态、镜头状态、角色/场景参考图 URL：SSE 断线时图片逐个完成
    // 只能靠轮询快照的 URL 变化发现，否则要等到阶段结束才回显。
    if (hasCanvasPollDelta(project, pollData)) {
      lastReloadRef.current = now
      loadProject()
    }
  }, [pollData, project, loadProject])

  if (loading) {
    return <div className="flex items-center justify-center h-screen text-muted-foreground">加载项目...</div>
  }

  if (error || !project) {
    return (
      <div className="flex items-center justify-center h-screen text-red-600">
        {error || '项目不存在'}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-56px)]">
      {/* Status bar */}
      <CanvasStatusBar
        project={project}
        runningPhase={runningPhase}
        pollData={pollData}
        connectionMode={connectionMode}
        isPolling={isPolling}
        taskQueueOpen={showTaskQueue}
        onToggleTaskQueue={() => {
          setShowCost(false)
          setShowTaskQueue(v => !v)
        }}
        costOpen={showCost}
        onToggleCost={() => {
          setShowTaskQueue(false)
          setShowCost(v => !v)
        }}
      />

      {/* Canvas area */}
      <div className="flex-1 relative">
        <CanvasFlow
          project={project}
          runningPhase={runningPhase}
          pollData={pollData}
          onNodeClick={(nodeId, nodeType) => {
            // 选中节点时关闭右侧浮层面板，避免重叠
            setShowTaskQueue(false)
            setShowCost(false)
            setSelectedNode(selectedNode?.id === nodeId ? null : { id: nodeId, type: nodeType })
          }}
        />

        {/* Task queue panel — 活跃任务 + 最近失败原因与建议 */}
        {showTaskQueue && (
          <TaskQueuePanel
            pollData={pollData}
            project={project}
            onClose={() => setShowTaskQueue(false)}
          />
        )}

        {/* Cost panel — 项目级成本 rollup 与按阶段拆分（beta 期间暂未计费） */}
        {showCost && (
          <CostPanel
            pollData={pollData}
            onClose={() => setShowCost(false)}
          />
        )}

        {/* Side panel for selected node */}
        {selectedNode && (
          <div className="absolute right-4 top-4 bottom-4 w-90 bg-background border rounded-lg shadow-lg overflow-auto">
            <div className="sticky top-0 bg-background border-b px-4 py-2 flex items-center justify-between">
              <span className="text-sm font-medium">
                节点详情
              </span>
              <button
                onClick={() => setSelectedNode(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                关闭
              </button>
            </div>
            <NodeDetailPanel
              selectedNode={selectedNode}
              project={project}
              onUpdate={loadProject}
            />
          </div>
        )}
      </div>

      {/* Pipeline controller bar */}
      <PipelineController
        projectId={project.id}
        project={project}
        modelPreferences={project.modelPreferences}
        onPhaseComplete={loadProject}
        onPhaseChange={setRunningPhase}
        phaseDone={phaseDone}
        onPhaseDoneConsumed={consumePhaseDone}
      />
    </div>
  )
}
