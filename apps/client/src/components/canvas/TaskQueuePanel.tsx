import type { CanvasAssetsPoll, CanvasFailureKind, ProjectDTO } from '@excuse/shared'
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
    <div className="absolute right-4 top-4 bottom-4 w-96 bg-background border rounded-lg shadow-lg overflow-auto z-20">
      {/* 头部 */}
      <div className="sticky top-0 bg-background border-b px-4 py-2 flex items-center justify-between z-10">
        <span className="text-sm font-medium">任务队列</span>
        <button
          onClick={onClose}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          关闭
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* ── 活跃任务 ── */}
        <section className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground flex items-center gap-2">
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
                      <div key={`${task.category}-${task.id}`} className="border rounded p-2 space-y-1">
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
          <h4 className="text-xs font-semibold text-muted-foreground flex items-center gap-2">
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
                    <div key={`${f.category}-${f.id}`} className="border border-[color:var(--status-danger-border)] rounded p-2 space-y-1.5">
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
                        💡
                        {' '}
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
    </div>
  )
}
