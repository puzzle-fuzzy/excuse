import type { CanvasAssetsPoll, ProjectDTO } from '@excuse/shared'
import type { RunningPhaseInfo } from './PipelineController'
import { Box, CircleDollarSign, Database, Radio, WifiOff } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router'
import { CANVAS_PROJECT_STATUS_TONES, statusBadgeClass, statusDotClass, statusTextClass, statusToneClass } from '@/lib/status-tokens'
import { cn } from '@/lib/utils'

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
  const statusTone = CANVAS_PROJECT_STATUS_TONES[project.status] ?? 'neutral'

  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-background/90 px-4 py-3 backdrop-blur-sm">
      {/* 项目标题 */}
      <div className="mr-2 flex min-w-0 items-center gap-2">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Box className="size-4" />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">
            {project.title || '未命名项目'}
          </h1>
          <div className="mt-0.5 text-xs text-muted-foreground">
            阶段
            {' '}
            {phaseStats.completed}
            /
            {phaseStats.total}
          </div>
        </div>
      </div>

      {/* 项目状态 */}
      <span className={statusBadgeClass(statusTone)}>
        {statusLabel}
      </span>

      {/* 正在运行阶段 */}
      {runningPhase && (
        <span className={statusBadgeClass('info', 'animate-pulse')}>
          正在
          {runningPhase.label}
          {runningPhase.modelName && ` · ${runningPhase.modelName}`}
        </span>
      )}

      {/* PAUSE_BEFORE 待确认 */}
      {isPauseBefore && (
        <span className={statusBadgeClass('warning')}>
          待确认：
          {project.status === 'refs_all_ready' ? '分镜' : '生成视频'}
        </span>
      )}

      {/* 阶段进度 */}
      <div className="hidden h-1.5 w-28 overflow-hidden rounded-full bg-muted md:block">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${Math.min(100, Math.round((phaseStats.completed / phaseStats.total) * 100))}%` }}
        />
      </div>

      {/* 任务队列按钮 — 点击展开活跃任务 + 最近失败详情 */}
      <button
        onClick={onToggleTaskQueue}
        className={cn(`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors ${
          taskQueueOpen
            ? statusToneClass('info')
            : failureCount > 0
              ? statusToneClass('danger', 'hover:opacity-90')
              : taskStats.total > 0
                ? statusToneClass('neutral', 'hover:opacity-90')
                : 'text-muted-foreground hover:bg-muted'
        }`)}
        title="查看任务队列与失败原因"
      >
        <Radio className="size-3.5" />
        任务队列
        {taskStats.total > 0 && (
          <span className="font-semibold">{taskStats.total}</span>
        )}
        {failureCount > 0 && (
          <span className={statusToneClass('danger', 'rounded px-1 font-semibold')}>{failureCount}</span>
        )}
      </button>

      {/* 成本按钮 — 点击展开成本 rollup 面板（beta 期间暂未计费，仅展示） */}
      <button
        onClick={onToggleCost}
        className={cn(`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors ${
          costOpen
            ? statusToneClass('success')
            : hasCost
              ? statusToneClass('neutral', 'hover:opacity-90')
              : 'text-muted-foreground hover:bg-muted'
        }`)}
        title="查看成本明细（beta 期间暂未计费）"
      >
        <CircleDollarSign className="size-3.5" />
        成本
        {hasCost && costSummary && (
          <span className="font-semibold">{`预估¥${(costSummary.totalEstimatedCents / 100).toFixed(1)} · 已结算¥${(costSummary.totalFinalCents / 100).toFixed(1)}`}</span>
        )}
      </button>

      {/* 从资产库导入 */}
      <Link
        to="/subjects"
        className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title="从资产库导入角色/场景到本项目"
      >
        <Database className="size-3.5" />
        资产库
      </Link>

      {/* 连接状态 */}
      <div className="ml-auto flex items-center gap-2">
        {connectionMode === 'sse' && (
          <span className={statusTextClass('success', 'flex items-center gap-1 text-xs')}>
            <span className={statusDotClass('success', 'w-1.5 h-1.5 rounded-full')} />
            实时同步
          </span>
        )}
        {connectionMode === 'polling' && isPolling && (
          <span className={statusBadgeClass('warning', 'animate-pulse')}>
            轮询同步中...
          </span>
        )}
        {connectionMode === 'disconnected' && (
          <span className={statusBadgeClass('danger', 'inline-flex items-center gap-1')}>
            <WifiOff className="size-3.5" />
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
    </div>
  )
}
