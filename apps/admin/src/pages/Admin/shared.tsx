/**
 * Admin 共享组件与工具函数
 */
import type { AdminApiKeyItem, AdminOverview, AdminTaskGenerationRecord, AdminTaskItem } from '@excuse/shared'
import type { Activity } from 'lucide-react'
import { Ban, Pencil, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TASK_CATEGORY_LABELS } from '@/lib/category-labels'
import { formatCents } from '@/lib/generation-utils'

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

/**
 * 共享分页底部栏 — 替代 ApiKeys / Users 中逐字复制的分页 UI。
 *
 * 显示 "第 X - Y 条 / 共 Z 条" + 上一页/下一页按钮。
 */
export function AdminPaginationFooter({
  page,
  pageSize,
  total,
  isFetching,
  onPageChange,
}: {
  page: number
  pageSize: number
  total: number
  isFetching?: boolean
  onPageChange: (page: number) => void
}) {
  return (
    <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
      <span>
        第
        {' '}
        {total === 0 ? 0 : page * pageSize + 1}
        {' '}
        -
        {' '}
        {Math.min((page + 1) * pageSize, total)}
        {' '}
        条 / 共
        {' '}
        {total}
        {' '}
        条
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 0 || isFetching}
          onClick={() => onPageChange(Math.max(0, page - 1))}
        >
          上一页
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={(page + 1) * pageSize >= total || isFetching}
          onClick={() => onPageChange(page + 1)}
        >
          下一页
        </Button>
      </div>
    </div>
  )
}

/**
 * 共享 API Key 表格 — 替代 ApiKeys.tsx AdminGatewayKeysTable 与 Users.tsx AdminUserApiKeysSection。
 *
 * 始终渲染：前缀、Scope、限流、额度消耗、状态、最近使用。
 * 可选列：名称（showName）、创建时间（showCreatedAt）、操作按钮（showActions）。
 */
export function ApiKeyTable({
  keys,
  isMutating,
  showName,
  showCreatedAt,
  showActions,
  onEdit,
  onReset,
  onRevoke,
}: {
  keys: AdminApiKeyItem[]
  isMutating?: boolean
  showName?: boolean
  showCreatedAt?: boolean
  showActions?: boolean
  onEdit?: (key: AdminApiKeyItem) => void
  onReset?: (key: AdminApiKeyItem) => void
  onRevoke?: (key: AdminApiKeyItem) => void
}) {
  if (keys.length === 0) {
    return <p className="text-xs text-muted-foreground">暂无 API Key</p>
  }

  return (
    <Table className="text-sm">
      <TableHeader>
        <TableRow className="border-b text-left text-muted-foreground">
          <TableHead className="h-auto py-1.5">前缀</TableHead>
          {showName && <TableHead className="h-auto py-1.5">名称</TableHead>}
          <TableHead className="h-auto py-1.5">Scope</TableHead>
          <TableHead className="h-auto py-1.5">限流</TableHead>
          <TableHead className="h-auto py-1.5">额度消耗</TableHead>
          <TableHead className="h-auto py-1.5">状态</TableHead>
          <TableHead className="h-auto py-1.5">最近使用</TableHead>
          {showCreatedAt && <TableHead className="h-auto py-1.5">创建时间</TableHead>}
          {showActions && <TableHead className="h-auto py-1.5 text-right">操作</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {keys.map(key => (
          <TableRow key={key.id}>
            <TableCell className="py-1.5 font-mono text-xs">
              {key.prefix}
              ...
            </TableCell>
            {showName && <TableCell className="py-1.5 text-xs">{key.name ?? '-'}</TableCell>}
            <TableCell className="py-1.5">
              <Badge variant={key.scope === 'gateway' ? 'secondary' : 'outline'} className="text-[10px]">
                {key.scope === 'gateway' ? 'Gateway' : 'All'}
              </Badge>
            </TableCell>
            <TableCell className="py-1.5 text-xs text-muted-foreground">
              {key.rateLimitPerMinute ? `${key.rateLimitPerMinute}次/分` : '-'}
            </TableCell>
            <TableCell className="py-1.5 text-xs text-muted-foreground">
              {key.quotaMaxCents
                ? (
                    <span>
                      ¥
                      {formatCents(key.totalSpendCents)}
                      /
                      ¥
                      {formatCents(key.quotaMaxCents)}
                    </span>
                  )
                : (
                    <span>
                      ¥
                      {formatCents(key.totalSpendCents)}
                    </span>
                  )}
            </TableCell>
            <TableCell className="py-1.5">
              <Badge variant={key.revokedAt ? 'outline' : 'default'}>
                {key.revokedAt ? '已撤销' : '启用'}
              </Badge>
            </TableCell>
            <TableCell className="py-1.5 text-xs text-muted-foreground">{formatDate(key.lastUsedAt)}</TableCell>
            {showCreatedAt && <TableCell className="py-1.5 text-xs text-muted-foreground">{formatDate(key.createdAt)}</TableCell>}
            {showActions && (
              <TableCell className="py-1.5 text-right">
                {key.revokedAt
                  ? <span className="text-xs text-muted-foreground">-</span>
                  : (
                      <div className="flex items-center justify-end gap-1">
                        {onEdit && (
                          <Button variant="ghost" size="sm" onClick={() => onEdit(key)}>
                            <Pencil className="size-3.5" />
                            配置
                          </Button>
                        )}
                        {onReset && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={isMutating}
                            onClick={() => onReset(key)}
                          >
                            <RotateCcw className="size-3.5" />
                            重置额度
                          </Button>
                        )}
                        {onRevoke && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            disabled={isMutating}
                            onClick={() => onRevoke(key)}
                          >
                            <Ban className="size-3.5" />
                            撤销
                          </Button>
                        )}
                      </div>
                    )}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
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
    <Table className="min-w-265 text-sm">
      <TableHeader>
        <TableRow className="border-b text-left text-muted-foreground">
          <TableHead className="h-auto py-2">任务</TableHead>
          <TableHead className="h-auto py-2">状态</TableHead>
          <TableHead className="h-auto py-2">尝试</TableHead>
          <TableHead className="h-auto py-2">关联</TableHead>
          <TableHead className="h-auto py-2">锁</TableHead>
          <TableHead className="h-auto py-2">下次执行</TableHead>
          <TableHead className="h-auto py-2">错误</TableHead>
          <TableHead className="h-auto py-2 text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.map(task => (
          <TableRow key={task.id}>
            <TableCell className="py-2">
              <div className="font-medium">{task.type}</div>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span>{task.domain}</span>
                <span>{shortId(task.id)}</span>
              </div>
            </TableCell>
            <TableCell className="py-2"><Badge variant={statusVariant(task.status)}>{statusLabel(task.status)}</Badge></TableCell>
            <TableCell className="py-2 text-muted-foreground">
              {task.attempts}
              /
              {task.maxAttempts}
            </TableCell>
            <TableCell className="py-2 text-xs text-muted-foreground">
              <div>
                project:
                {shortId(task.projectId)}
              </div>
              <div>
                record:
                {shortId(task.generationRecordId)}
              </div>
            </TableCell>
            <TableCell className="py-2 text-xs text-muted-foreground">
              <div>{task.lockedBy || '-'}</div>
              <div>{formatDate(task.lockedUntil)}</div>
            </TableCell>
            <TableCell className="py-2 text-muted-foreground">{formatDate(task.nextRunAt)}</TableCell>
            <TableCell className="max-w-72 truncate py-2 text-destructive">{task.errorMessage || '-'}</TableCell>
            <TableCell className="py-2">
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
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
