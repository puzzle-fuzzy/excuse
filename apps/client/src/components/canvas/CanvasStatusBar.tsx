import type { CanvasAssetsPoll, ProjectDTO } from '@excuse/shared'
import type { RunningPhaseInfo } from './PipelineController'
import { useMemo } from 'react'
import { Link } from 'react-router'

const STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  analyzed: '已分析',
  characters_ready: '角色已生成',
  locations_ready: '场景已生成',
  refs_ready: '参考图生成中',
  refs_all_ready: '参考图已就绪',
  storyboard_ready: '分镜已生成',
  continuity_checked: '连续性已检查',
  prompts_ready: 'Prompt 已重建',
  generating: '视频生成中',
  partial_failed: '部分失败',
  completed: '已完成',
  failed: '失败',
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  analyzed: 'bg-blue-100 text-blue-700',
  characters_ready: 'bg-blue-100 text-blue-700',
  locations_ready: 'bg-blue-100 text-blue-700',
  refs_ready: 'bg-yellow-100 text-yellow-700',
  refs_all_ready: 'bg-green-100 text-green-700',
  storyboard_ready: 'bg-green-100 text-green-700',
  continuity_checked: 'bg-green-100 text-green-700',
  prompts_ready: 'bg-green-100 text-green-700',
  generating: 'bg-blue-100 text-blue-700 animate-pulse',
  partial_failed: 'bg-orange-100 text-orange-700',
  completed: 'bg-green-200 text-green-800',
  failed: 'bg-red-100 text-red-700',
}

interface CanvasStatusBarProps {
  project: ProjectDTO
  runningPhase: RunningPhaseInfo | null
  pollData: CanvasAssetsPoll | null
  connectionMode: 'sse' | 'polling' | 'disconnected'
  isPolling: boolean
  /** 任务队列面板是否展开（高亮触发按钮） */
  taskQueueOpen: boolean
  /** 切换任务队列面板 */
  onToggleTaskQueue: () => void
  /** 成本面板是否展开（高亮触发按钮） */
  costOpen: boolean
  /** 切换成本面板 */
  onToggleCost: () => void
}

export default function CanvasStatusBar({
  project,
  runningPhase,
  pollData,
  connectionMode,
  isPolling,
  taskQueueOpen,
  onToggleTaskQueue,
  costOpen,
  onToggleCost,
}: CanvasStatusBarProps) {
  // 阶段进度统计
  const phaseStats = useMemo(() => {
    const phases = ['analyzed', 'characters_ready', 'locations_ready', 'refs_all_ready', 'storyboard_ready', 'continuity_checked', 'prompts_ready', 'generating']
    const statusOrder = ['draft', 'analyzed', 'characters_ready', 'locations_ready', 'refs_ready', 'refs_all_ready', 'storyboard_ready', 'continuity_checked', 'prompts_ready', 'generating', 'completed']
    const currentIndex = statusOrder.indexOf(project.status)
    if (currentIndex < 0)
      return { completed: 0, total: phases.length }
    // 已完成的阶段数（draft 不算，所以从 analyzed 开始）
    const completed = currentIndex === 0 ? 0 : currentIndex
    return { completed, total: phases.length }
  }, [project.status])

  // 活跃任务统计
  const taskStats = useMemo(() => {
    if (!pollData?.activeTasks)
      return { total: 0, text: 0, image: 0, video: 0 }
    const tasks = pollData.activeTasks
    return {
      total: tasks.length,
      text: tasks.filter(t => t.category === 'text').length,
      image: tasks.filter(t => t.category === 'image').length,
      video: tasks.filter(t => t.category === 'video').length,
    }
  }, [pollData])

  // 最近失败数（用于按钮角标提示）
  const failureCount = pollData?.recentFailures?.length ?? 0

  // 成本摘要（P2-1 成本可见；beta 期间暂未计费，仅展示）
  const costSummary = pollData?.costSummary
  const hasCost = !!costSummary && (costSummary.totalEstimatedCents + costSummary.totalFinalCents + costSummary.totalFailedCents) > 0

  const isPauseBefore = !runningPhase && (project.status === 'refs_all_ready' || project.status === 'prompts_ready')

  const statusLabel = STATUS_LABELS[project.status] || project.status
  const statusColor = STATUS_COLORS[project.status] || 'bg-gray-100 text-gray-700'

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b bg-background/80 backdrop-blur-sm flex-wrap">
      {/* 项目标题 */}
      <h1 className="font-semibold text-sm truncate max-w-40">
        {project.title || '未命名项目'}
      </h1>

      {/* 项目状态 */}
      <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor}`}>
        {statusLabel}
      </span>

      {/* 正在运行阶段 */}
      {runningPhase && (
        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 animate-pulse">
          正在
          {runningPhase.label}
          {runningPhase.modelName && ` · ${runningPhase.modelName}`}
        </span>
      )}

      {/* PAUSE_BEFORE 待确认 */}
      {isPauseBefore && (
        <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">
          ⏸ 待确认：
          {project.status === 'refs_all_ready' ? '分镜' : '生成视频'}
        </span>
      )}

      {/* 阶段进度 */}
      <span className="text-xs text-muted-foreground">
        阶段
        {phaseStats.completed}
        /
        {phaseStats.total}
      </span>

      {/* 任务队列按钮 — 点击展开活跃任务 + 最近失败详情 */}
      <button
        onClick={onToggleTaskQueue}
        className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 transition-colors ${
          taskQueueOpen
            ? 'bg-blue-100 text-blue-700'
            : failureCount > 0
              ? 'bg-red-100 text-red-700 hover:bg-red-200'
              : taskStats.total > 0
                ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                : 'text-muted-foreground hover:bg-gray-100'
        }`}
        title="查看任务队列与失败原因"
      >
        任务队列
        {taskStats.total > 0 && (
          <span className="font-semibold">{taskStats.total}</span>
        )}
        {failureCount > 0 && (
          <span className="px-1 rounded bg-red-500 text-white font-semibold">{failureCount}</span>
        )}
      </button>

      {/* 成本按钮 — 点击展开成本 rollup 面板（beta 期间暂未计费，仅展示） */}
      <button
        onClick={onToggleCost}
        className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 transition-colors ${
          costOpen
            ? 'bg-green-100 text-green-700'
            : hasCost
              ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              : 'text-muted-foreground hover:bg-gray-100'
        }`}
        title="查看成本明细（beta 期间暂未计费）"
      >
        成本
        {hasCost && costSummary && (
          <span className="font-semibold">{`预估¥${(costSummary.totalEstimatedCents / 100).toFixed(1)} · 已结算¥${(costSummary.totalFinalCents / 100).toFixed(1)}`}</span>
        )}
      </button>

      {/* 从资产库导入 */}
      <Link
        to="/subjects"
        className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1 text-muted-foreground hover:bg-gray-100 transition-colors"
        title="从资产库导入角色/场景到本项目"
      >
        资产库
      </Link>

      {/* 连接状态 */}
      {connectionMode === 'sse' && (
        <span className="text-xs text-green-600 flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
          实时同步
        </span>
      )}
      {connectionMode === 'polling' && isPolling && (
        <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 animate-pulse">
          轮询同步中...
        </span>
      )}
      {connectionMode === 'disconnected' && (
        <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">
          连接断开
        </span>
      )}

      {/* 最后更新时间 */}
      {pollData?.generatedAt && (
        <span className="text-xs text-muted-foreground">
          更新于
          {new Date(pollData.generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
    </div>
  )
}
