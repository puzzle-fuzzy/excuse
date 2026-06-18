/**
 * Admin 共享组件与工具函数
 */
import type { AdminOverview, AdminTaskGenerationRecord, AdminTaskItem } from '@excuse/shared'
import type { Activity } from 'lucide-react'
import { Ban, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TASK_CATEGORY_LABELS } from '@/lib/category-labels'

export const TASK_LIMIT = 40
export const USERS_PAGE_SIZE = 20

export const STATUS_LABELS: Record<string, string> = {
  queued: '等待',
  running: '运行',
  retrying: '重试',
  succeeded: '成功',
  failed: '失败',
  cancelled: '取消',
  pending: '待处理',
  submitting: '提交中',
  processing: '处理中',
  saving_output: '保存中',
  draft: '草稿',
  completed: '完成',
  partial_failed: '部分失败',
}

export const KIND_LABELS: Record<string, string> = {
  generation: '生成',
  task: '任务',
  canvas_pipeline: 'Canvas',
}

export const TASK_STATUS_OPTIONS = [
  { label: '全部状态', value: 'all' },
  { label: '等待', value: 'queued' },
  { label: '运行', value: 'running' },
  { label: '重试', value: 'retrying' },
  { label: '失败', value: 'failed' },
  { label: '成功', value: 'succeeded' },
  { label: '取消', value: 'cancelled' },
]

export const TASK_DOMAIN_OPTIONS = [
  { label: '全部领域', value: 'all' },
  { label: 'Canvas', value: 'canvas' },
  { label: '生成', value: 'generate' },
  { label: '字幕', value: 'subtitle' },
  { label: 'Gateway', value: 'gateway' },
]

export const USER_STATUS_OPTIONS = [
  { label: '全部状态', value: 'all' },
  { label: '已启用', value: 'true' },
  { label: '已禁用', value: 'false' },
]

export const PROVIDER_WINDOW_OPTIONS = [
  { label: '近 1 小时', value: '1' },
  { label: '近 6 小时', value: '6' },
  { label: '近 24 小时', value: '24' },
  { label: '近 7 天', value: '168' },
]

/** @deprecated 使用 TASK_CATEGORY_LABELS（自 @/lib/category-labels） */
export const PROVIDER_CATEGORY_LABELS = TASK_CATEGORY_LABELS

export function statusLabel(status: string) {
  return STATUS_LABELS[status] ?? status
}

export function formatDate(value: string | null) {
  if (!value)
    return '-'
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function shortId(value: string | null) {
  if (!value)
    return '-'
  return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value
}

export function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'failed')
    return 'destructive'
  if (status === 'running' || status === 'queued' || status === 'retrying')
    return 'default'
  if (status === 'cancelled')
    return 'outline'
  return 'secondary'
}

export function StatCard({ title, value, hint, icon: Icon }: {
  title: string
  value: string | number
  hint: string
  icon: typeof Activity
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="text-xs text-muted-foreground">{title}</p>
          <div className="mt-1 text-2xl font-semibold">{value}</div>
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        </div>
        <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
          <Icon className="size-5 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  )
}

export function generationRecordMatchLabel(matchReason: AdminTaskGenerationRecord['matchReason']) {
  switch (matchReason) {
    case 'direct':
      return '直接关联'
    case 'worker-task':
      return '统一任务'
    case 'pipeline-run':
      return 'Pipeline'
    case 'time-window':
      return '候选·时间窗口'
  }
}

export function recentRecordExecutionLabel(kind: string) {
  switch (kind) {
    case 'legacy-provider-task':
      return 'Legacy provider task'
    case 'canvas-worker':
      return 'Canvas worker'
    case 'gateway':
      return 'Gateway'
    case 'inline':
      return '同步'
  }
}

export function StatusList({ title, rows }: { title: string, rows: AdminOverview['generationStatus'] }) {
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">暂无数据</p>}
        {rows.map(row => (
          <div key={row.status} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
            <span>{statusLabel(row.status)}</span>
            <Badge variant={row.status.includes('failed') ? 'destructive' : 'secondary'}>{row.count}</Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export function TaskTable({ tasks, isLoading, isMutating, onRequeue, onCancel, onOpenDetail }: {
  tasks: AdminTaskItem[]
  isLoading: boolean
  isMutating: boolean
  onRequeue: (id: string) => void
  onCancel: (id: string) => void
  onOpenDetail: (id: string) => void
}) {
  if (isLoading)
    return <div className="py-10 text-center text-sm text-muted-foreground">正在读取任务队列...</div>
  if (tasks.length === 0)
    return <div className="py-10 text-center text-sm text-muted-foreground">没有匹配的任务</div>

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-265 text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 font-medium">任务</th>
            <th className="py-2 font-medium">状态</th>
            <th className="py-2 font-medium">尝试</th>
            <th className="py-2 font-medium">关联</th>
            <th className="py-2 font-medium">锁</th>
            <th className="py-2 font-medium">下次执行</th>
            <th className="py-2 font-medium">错误</th>
            <th className="py-2 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map(task => (
            <tr key={task.id} className="border-b last:border-b-0">
              <td className="py-2">
                <div className="font-medium">{task.type}</div>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{task.domain}</span>
                  <span>{shortId(task.id)}</span>
                </div>
              </td>
              <td className="py-2"><Badge variant={statusVariant(task.status)}>{statusLabel(task.status)}</Badge></td>
              <td className="py-2 text-muted-foreground">
                {task.attempts}
                /
                {task.maxAttempts}
              </td>
              <td className="py-2 text-xs text-muted-foreground">
                <div>
                  project:
                  {shortId(task.projectId)}
                </div>
                <div>
                  record:
                  {shortId(task.generationRecordId)}
                </div>
              </td>
              <td className="py-2 text-xs text-muted-foreground">
                <div>{task.lockedBy || '-'}</div>
                <div>{formatDate(task.lockedUntil)}</div>
              </td>
              <td className="py-2 text-muted-foreground">{formatDate(task.nextRunAt)}</td>
              <td className="max-w-72 truncate py-2 text-destructive">{task.errorMessage || '-'}</td>
              <td className="py-2">
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => onOpenDetail(task.id)}>详情</Button>
                  <Button size="sm" variant="outline" disabled={!task.canRequeue || isMutating} onClick={() => onRequeue(task.id)}>
                    <RotateCcw className="size-4" />
                    重排
                  </Button>
                  <Button size="sm" variant="outline" disabled={!task.canCancel || isMutating} onClick={() => onCancel(task.id)}>
                    <Ban className="size-4" />
                    取消
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
