import type { ProjectDTO } from '@excuse/shared'
import type { RunningPhaseInfo } from '../components/canvas/PipelineController'
import { AlertTriangle, ArrowLeft, Layers3, Loader2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { getCanvasProject } from '../api/client'
import CanvasFlow from '../components/canvas/CanvasFlow'
import CanvasStatusBar from '../components/canvas/CanvasStatusBar'
import CostPanel from '../components/canvas/CostPanel'
import NodeDetailPanel from '../components/canvas/NodeDetailPanel'
import PipelineController from '../components/canvas/PipelineController'
import TaskQueuePanel from '../components/canvas/TaskQueuePanel'
import { Button } from '../components/ui/button'
import { Skeleton } from '../components/ui/skeleton'
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
  // mount 时的 projectVersion 快照 —— 区分「初次挂载（mount effect 已加载最新）」与「真实 phase 增长」
  const versionAtMountRef = useRef<number | null>(null)
  // debounce reload 计时器 —— 合并连续的 version bump / phase 完成信号，避免每个 SSE 事件一次请求
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  /**
   * 合并连续重载请求 —— 把 version bump、phase 完成等多路信号汇成一次 getCanvasProject。
   * 每个 phase 完成（SSE bump + onPhaseComplete 回调）原先各触发一次 reload（间隔 800ms），
   * 现统一经此入口，trailing 合并到一次请求。
   */
  const scheduleReload = useCallback((delayMs = 500) => {
    if (reloadTimerRef.current)
      clearTimeout(reloadTimerRef.current)
    reloadTimerRef.current = setTimeout(() => {
      reloadTimerRef.current = null
      loadProject()
    }, delayMs)
  }, [loadProject])

  useEffect(() => {
    loadProject()
  }, [loadProject])

  // 项目版本号变化时重新加载（由 pipeline_node_update SSE 事件中的 phase 级别事件驱动）
  // 与 onPhaseComplete（见 PipelineController）共享 scheduleReload，trailing 合并成一次请求。
  useEffect(() => {
    if (versionAtMountRef.current === null) {
      versionAtMountRef.current = projectVersion // 初次挂载：mount effect 已加载最新，跳过
      return
    }
    if (projectVersion === versionAtMountRef.current)
      return // 版本未变
    // 版本确实增长（phase 完成）：debounce 合并连续 bump
    scheduleReload(500)
  }, [projectVersion, scheduleReload])

  // 卸载时清理 pending reload，避免对已卸载组件 setState
  useEffect(() => () => {
    if (reloadTimerRef.current)
      clearTimeout(reloadTimerRef.current)
  }, [])

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
    return (
      <div className="canvas-stage-shell flex h-[calc(100vh-56px)] min-h-[640px] flex-col">
        <div className="border-b bg-background/90 px-4 py-3">
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-72" />
            </div>
          </div>
        </div>
        <div className="grid flex-1 place-items-center p-6">
          <div className="floating-product-panel w-full max-w-md p-6 text-center">
            <span className="mx-auto grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
              <Loader2 className="size-5 animate-spin" />
            </span>
            <h2 className="mt-4 text-base font-semibold">正在读取 Canvas 项目</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              正在同步故事、镜头、资产和任务状态。长项目首次打开可能需要几秒。
            </p>
          </div>
        </div>
        <div className="border-t bg-background/90 px-4 py-3">
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="canvas-stage-shell grid h-[calc(100vh-56px)] min-h-[640px] place-items-center p-6">
        <div className="floating-product-panel w-full max-w-lg p-6">
          <span className="grid size-11 place-items-center rounded-xl bg-[color:var(--status-danger-bg)] text-[color:var(--status-danger-fg)]">
            <AlertTriangle className="size-5" />
          </span>
          <h1 className="mt-4 text-lg font-semibold">无法打开 Canvas 项目</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{error || '项目不存在，可能已被删除或当前账号没有访问权限。'}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/canvas">
                <ArrowLeft className="size-4" />
                返回项目库
              </Link>
            </Button>
            <Button onClick={loadProject}>重新加载</Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="canvas-stage-shell flex h-[calc(100vh-56px)] min-h-[640px] flex-col overflow-hidden">
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
      <div className="relative flex-1 overflow-hidden">
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
          <aside className="floating-product-panel absolute bottom-4 right-4 top-4 z-30 flex w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden">
            <div className="border-b bg-background/95 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Layers3 className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">节点详情</div>
                    <div className="truncate text-xs text-muted-foreground">{selectedNode.type}</div>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="关闭节点详情"
                  title="关闭节点详情"
                  onClick={() => setSelectedNode(null)}
                  className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <NodeDetailPanel
                selectedNode={selectedNode}
                project={project}
                onUpdate={loadProject}
              />
            </div>
          </aside>
        )}
      </div>

      {/* Pipeline controller bar */}
      <PipelineController
        projectId={project.id}
        project={project}
        modelPreferences={project.modelPreferences}
        onPhaseComplete={() => scheduleReload()}
        onPhaseChange={setRunningPhase}
        phaseDone={phaseDone}
        onPhaseDoneConsumed={consumePhaseDone}
      />
    </div>
  )
}
