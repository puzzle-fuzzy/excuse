import type { CanvasAssetsPoll, CanvasFailureKind, ProjectDTO } from '@excuse/shared'
import { Activity, AlertTriangle, CheckCircle2, Lightbulb, X } from 'lucide-react'
import { TASK_CATEGORY_LABELS } from '@/lib/category-labels'
import { FAILURE_KIND_TONES, statusBadgeClass, statusTextClass, statusToneClass, TASK_STATUS_TONES } from '@/lib/status-tokens'

/**
 * 任务队列面板 — 展示活跃任务 + 最近失败（含失败原因分类与下一步建议）
 *
 * P0-4 目标：用户不用打开控制台，也能知道当前卡在哪里；
 * 失败不只显示「失败」，还要说明是 provider/网络/存储/余额/取消/系统哪一类错误。
 */

const CATEGORY_LABELS = TASK_CATEGORY_LABELS

const STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  running: '执行中',
  pending: '等待中',
  submitting: '提交中',
  processing: '生成中',
  saving_output: '保存中',
}

interface TaskQueuePanelProps {
  pollData: CanvasAssetsPoll | null
  project: ProjectDTO
  onClose: () => void
}

/** 将 targetId 解析为可读的目标对象名称 */
function resolveTargetName(
  project: ProjectDTO,
  targetType: 'character' | 'location' | 'shot' | 'project',
  targetId: string,
): string {
  if (targetType === 'character') {
    const c = project.characters.find(ch => ch.id === targetId)
    return c ? `角色 · ${c.name}` : '角色 · (已删除)'
  }
  if (targetType === 'location') {
    const l = project.locations.find(loc => loc.id === targetId)
    return l ? `场景 · ${l.name}` : '场景 · (已删除)'
  }
  if (targetType === 'shot') {
    const s = project.shots.find(sh => sh.id === targetId)
    return s ? `镜头 ${s.shotIndex}` : '镜头 · (已删除)'
  }
  return '项目'
}

function formatTime(ms: number | null | undefined): string {
  if (!ms)
    return ''
  return new Date(ms).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function TaskQueuePanel({ pollData, project, onClose }: TaskQueuePanelProps) {
  const activeTasks = pollData?.activeTasks ?? []
  const recentFailures = pollData?.recentFailures ?? []

  return (
    <aside className="floating-product-panel absolute bottom-4 right-4 top-4 z-20 flex w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden">
      {/* 头部 */}
      <div className="border-b bg-background/95 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
              <Activity className="size-4" />
            </span>
            <div>
              <div className="text-sm font-semibold">任务队列</div>
              <div className="text-xs text-muted-foreground">
                {activeTasks.length}
                {' '}
                个进行中，
                {recentFailures.length}
                {' '}
                个最近失败
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭任务队列"
            className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        {activeTasks.length === 0 && recentFailures.length === 0 && (
          <div className="rounded-xl border border-dashed bg-muted/25 p-5 text-center">
            <CheckCircle2 className="mx-auto size-8 text-[color:var(--status-success-fg)]" />
            <h4 className="mt-3 text-sm font-semibold">队列当前稳定</h4>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">启动 Canvas 阶段后，提交中、生成中和保存中的任务会集中显示在这里。</p>
          </div>
        )}
        {/* ── 活跃任务 ── */}
        <section className="space-y-2">
          <h4 className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            进行中的任务
            <span className={statusBadgeClass('info', 'px-1.5')}>{activeTasks.length}</span>
          </h4>

          {activeTasks.length === 0
            ? (
                <p className="text-xs text-muted-foreground py-2">暂无进行中的任务</p>
              )
            : (
                <div className="space-y-1.5">
                  {activeTasks.map((task) => {
                    const statusTone = TASK_STATUS_TONES[task.status] ?? 'neutral'
                    return (
                      <div key={`${task.category}-${task.id}`} className="space-y-1 rounded-lg border bg-background p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium">
                            {CATEGORY_LABELS[task.category] ?? task.category}
                          </span>
                          <span className={statusBadgeClass(statusTone, task.status === 'running' || task.status === 'processing' || task.status === 'saving_output' ? 'px-1.5 animate-pulse' : 'px-1.5')}>
                            {STATUS_LABELS[task.status] ?? task.status}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {resolveTargetName(project, task.targetType, task.targetId)}
                        </div>
                        {(task.retryCount && task.retryCount > 0) && (
                          <div className={statusTextClass('warning', 'text-xs')}>
                            已重试
                            {' '}
                            {task.retryCount}
                            {' '}
                            次
                          </div>
                        )}
                        {task.errorMessage && (
                          <div className={statusToneClass('danger', 'rounded border px-1.5 py-0.5 text-xs')}>
                            {task.errorMessage}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
        </section>

        {/* ── 最近失败 ── */}
        <section className="space-y-2">
          <h4 className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <AlertTriangle className="size-3.5" />
            最近失败
            <span className={statusBadgeClass('danger', 'px-1.5')}>{recentFailures.length}</span>
          </h4>

          {recentFailures.length === 0
            ? (
                <p className="text-xs text-muted-foreground py-2">暂无失败记录</p>
              )
            : (
                <div className="space-y-2">
                  {recentFailures.map(f => (
                    <div key={`${f.category}-${f.id}`} className="space-y-1.5 rounded-lg border border-[color:var(--status-danger-border)] bg-[color:var(--status-danger-bg)]/20 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium">
                          {CATEGORY_LABELS[f.category] ?? f.category}
                        </span>
                        <span className={statusBadgeClass(FAILURE_KIND_TONES[f.failureKind as CanvasFailureKind] ?? 'neutral', 'px-1.5')}>
                          {f.failureKind === 'cancel' ? '已取消' : f.failureKind}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {resolveTargetName(project, f.targetType, f.targetId)}
                      </div>

                      {/* 错误摘要 */}
                      {f.errorMessage && (
                        <div className={statusToneClass('danger', 'rounded border px-1.5 py-1 text-xs break-words')}>
                          {f.errorMessage}
                        </div>
                      )}

                      {/* 下一步建议 */}
                      <div className={statusToneClass('info', 'rounded border px-1.5 py-1 text-xs')}>
                        <Lightbulb className="mr-1 inline size-3.5" />
                        {f.suggestion}
                      </div>

                      {/* 元信息：重试次数 + 时间 */}
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        {f.retryCount > 0
                          ? (
                              <span>
                                已重试
                                {f.retryCount}
                                {' '}
                                次
                              </span>
                            )
                          : <span>未重试</span>}
                        <span>{formatTime(f.failedAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
        </section>
      </div>
    </aside>
  )
}
