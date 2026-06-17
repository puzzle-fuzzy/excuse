import type { AdminApiKeyItem, AdminGatewayClientDetail, AdminGatewayClientItem, AdminOverview, AdminPipelineRun, AdminTaskDetail, AdminTaskGenerationRecord, AdminTaskItem, AdminUserDetail, AdminUserRecentRecord } from '@excuse/shared'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  Ban,
  ClipboardList,
  Coins,
  FolderKanban,
  KeyRound,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useDebounce } from 'use-debounce'
import { adminCreditAdd, adminGatewayClientsQueryKeys, adminTasksQueryKeys, adminUserApiKeysQueryKeys, fetchAdminGatewayClientDetail, fetchAdminGatewayClients, fetchAdminTaskDetail, fetchAdminUpdateApiKeyConfig, fetchAdminUserApiKeys, fetchAdminUserDetail, fetchAdminUsers, resetApiKeyQuota, revokeApiKeyAdmin } from '@/api/admin'
import { cancelAdminTask, fetchAdminOverview, fetchAdminTasks, requeueAdminTask } from '@/api/client'
import { adminQueryKeys } from '@/api/query-client'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatLatencyMs, formatNumber, pipelinePhaseLabel } from '@/lib/admin-format'
import { formatCents } from '@/lib/generation-utils'
import { AdminProvidersTab } from './Providers'
import { AdminProjectsTab } from './Projects'
import { AdminAuditLogsTab } from './Audit'

const TASK_LIMIT = 40
const USERS_PAGE_SIZE = 20

const STATUS_LABELS: Record<string, string> = {
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

const KIND_LABELS: Record<string, string> = {
  generation: '生成',
  task: '任务',
  canvas_pipeline: 'Canvas',
}

const TASK_STATUS_OPTIONS = [
  { label: '全部状态', value: 'all' },
  { label: '等待', value: 'queued' },
  { label: '运行', value: 'running' },
  { label: '重试', value: 'retrying' },
  { label: '失败', value: 'failed' },
  { label: '成功', value: 'succeeded' },
  { label: '取消', value: 'cancelled' },
]

const TASK_DOMAIN_OPTIONS = [
  { label: '全部领域', value: 'all' },
  { label: 'Canvas', value: 'canvas' },
  { label: '生成', value: 'generate' },
  { label: '字幕', value: 'subtitle' },
  { label: 'Gateway', value: 'gateway' },
]

const USER_STATUS_OPTIONS = [
  { label: '全部状态', value: 'all' },
  { label: '已启用', value: 'true' },
  { label: '已禁用', value: 'false' },
]

type AdminTab = 'overview' | 'users' | 'providers' | 'projects' | 'gateway' | 'audit'

function statusLabel(status: string) {
  return STATUS_LABELS[status] ?? status
}

function formatDate(value: string | null) {
  if (!value)
    return '-'
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function StatCard({
  title,
  value,
  hint,
  icon: Icon,
}: {
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

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'failed')
    return 'destructive'
  if (status === 'running' || status === 'queued' || status === 'retrying')
    return 'default'
  if (status === 'cancelled')
    return 'outline'
  return 'secondary'
}

function StatusList({ title, rows }: { title: string, rows: AdminOverview['generationStatus'] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
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

function shortId(value: string | null) {
  if (!value)
    return '-'
  return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value
}

function generationRecordMatchLabel(matchReason: AdminTaskGenerationRecord['matchReason']) {
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

function recentRecordExecutionLabel(kind: AdminUserRecentRecord['executionKind']) {
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

function TaskTable({
  tasks,
  isLoading,
  isMutating,
  onRequeue,
  onCancel,
  onOpenDetail,
}: {
  tasks: AdminTaskItem[]
  isLoading: boolean
  isMutating: boolean
  onRequeue: (id: string) => void
  onCancel: (id: string) => void
  onOpenDetail: (id: string) => void
}) {
  if (isLoading) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        正在读取任务队列...
      </div>
    )
  }

  if (tasks.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        没有匹配的任务
      </div>
    )
  }

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
              <td className="py-2">
                <Badge variant={statusVariant(task.status)}>{statusLabel(task.status)}</Badge>
              </td>
              <td className="py-2 text-muted-foreground">
                {task.attempts}
                /
                {task.maxAttempts}
              </td>
              <td className="py-2 text-xs text-muted-foreground">
                <div>
                  project:
                  {' '}
                  {shortId(task.projectId)}
                </div>
                <div>
                  record:
                  {' '}
                  {shortId(task.generationRecordId)}
                </div>
              </td>
              <td className="py-2 text-xs text-muted-foreground">
                <div>{task.lockedBy || '-'}</div>
                <div>{formatDate(task.lockedUntil)}</div>
              </td>
              <td className="py-2 text-muted-foreground">{formatDate(task.nextRunAt)}</td>
              <td className="max-w-72 truncate py-2 text-destructive">
                {task.errorMessage || '-'}
              </td>
              <td className="py-2">
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onOpenDetail(task.id)}
                  >
                    详情
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!task.canRequeue || isMutating}
                    onClick={() => onRequeue(task.id)}
                  >
                    <RotateCcw className="size-4" />
                    重排
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!task.canCancel || isMutating}
                    onClick={() => onCancel(task.id)}
                  >
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

function AdminOverviewTab({
  data,
  taskData,
  isTasksLoading,
  isTasksFetching,
  isFetching,
  isMutating,
  taskStatus,
  taskDomain,
  taskSearch,
  refetch,
  refetchTasks,
  setTaskStatus,
  setTaskDomain,
  setTaskSearch,
  requeue,
  cancel,
}: {
  data: AdminOverview
  taskData: { items: AdminTaskItem[], total: number } | undefined
  isTasksLoading: boolean
  isTasksFetching: boolean
  isFetching: boolean
  isMutating: boolean
  taskStatus: string
  taskDomain: string
  taskSearch: string
  refetch: () => void
  refetchTasks: () => void
  setTaskStatus: (value: string) => void
  setTaskDomain: (value: string) => void
  setTaskSearch: (value: string) => void
  requeue: (id: string) => void
  cancel: (id: string) => void
}) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const { summary } = data
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="用户" value={summary.totalUsers} hint={`活跃 ${summary.activeUsers}`} icon={Users} />
        <StatCard title="生成记录" value={summary.totalGenerationRecords} hint={`失败 ${summary.failedGenerationRecords}`} icon={Activity} />
        <StatCard title="总成本" value={formatCents(summary.totalCostCents)} hint="generation_records 聚合" icon={Coins} />
        <StatCard title="活跃任务" value={summary.activeTasks} hint={`活跃 Canvas ${summary.activeCanvasProjects}`} icon={ClipboardList} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <StatusList title="生成状态" rows={data.generationStatus} />
        <StatusList title="Canvas 项目状态" rows={data.canvasProjectStatus} />
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">任务队列</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.taskQueue.length === 0 && <p className="text-sm text-muted-foreground">暂无任务</p>}
            {data.taskQueue.map(row => (
              <div key={`${row.domain}:${row.status}`} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <FolderKanban className="size-4 text-muted-foreground" />
                  <span>{row.domain}</span>
                  <span className="text-muted-foreground">{statusLabel(row.status)}</span>
                </div>
                <Badge variant={['queued', 'running', 'retrying'].includes(row.status) ? 'default' : 'secondary'}>
                  {row.count}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">最近失败</CardTitle>
        </CardHeader>
        <CardContent>
          {data.recentFailures.length === 0
            ? (
                <p className="py-8 text-center text-sm text-muted-foreground">暂无失败记录</p>
              )
            : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 font-medium">类型</th>
                        <th className="py-2 font-medium">对象</th>
                        <th className="py-2 font-medium">账号</th>
                        <th className="py-2 font-medium">时间</th>
                        <th className="py-2 font-medium">错误</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentFailures.map(item => (
                        <tr key={`${item.kind}:${item.id}`} className="border-b last:border-b-0">
                          <td className="py-2">
                            <Badge variant="outline">{KIND_LABELS[item.kind] ?? item.kind}</Badge>
                          </td>
                          <td className="max-w-52 truncate py-2">{item.title}</td>
                          <td className="max-w-40 truncate py-2 text-muted-foreground">{item.accountId ?? '-'}</td>
                          <td className="py-2 text-muted-foreground">{formatDate(item.updatedAt ?? item.createdAt)}</td>
                          <td className="max-w-md truncate py-2 text-destructive">{item.errorMessage || '未知错误'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-sm">任务诊断</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                查询 tasks 队列并执行受控操作；重排只恢复统一任务，不级联修复 Canvas run 或生成记录状态。
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetchTasks()} disabled={isTasksFetching}>
              <RefreshCw className={`size-4 ${isTasksFetching ? 'animate-spin' : ''}`} />
              刷新任务
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-3 grid gap-2 md:grid-cols-[180px_180px_1fr]">
            <Select value={taskStatus} onValueChange={setTaskStatus}>
              <SelectTrigger>
                <SelectValue placeholder="全部状态" />
              </SelectTrigger>
              <SelectContent>
                {TASK_STATUS_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={taskDomain} onValueChange={setTaskDomain}>
              <SelectTrigger>
                <SelectValue placeholder="全部领域" />
              </SelectTrigger>
              <SelectContent>
                {TASK_DOMAIN_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-2 size-4 text-muted-foreground" />
              <Input
                value={taskSearch}
                onChange={event => setTaskSearch(event.target.value)}
                className="pl-8"
                placeholder="搜索 task id / account / project / type / error"
              />
            </div>
          </div>
          <TaskTable
            tasks={taskData?.items ?? []}
            isLoading={isTasksLoading}
            isMutating={isMutating}
            onRequeue={requeue}
            onCancel={cancel}
            onOpenDetail={setSelectedTaskId}
          />
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              当前显示
              {' '}
              {taskData?.items.length ?? 0}
              {' '}
              /
              {' '}
              {taskData?.total ?? 0}
              {' '}
              个任务
            </span>
            <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`size-4 ${isFetching ? 'animate-spin' : ''}`} />
              刷新概览
            </Button>
          </div>
        </CardContent>
      </Card>

      <AdminTaskDetailDialog
        taskId={selectedTaskId}
        onClose={() => setSelectedTaskId(null)}
        onRequeue={requeue}
        onCancel={cancel}
        isMutating={isMutating}
      />
    </div>
  )
}

function AdminUsersTab() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [debouncedSearch] = useDebounce(search, 300)

  const isActive = statusFilter === 'all' ? undefined : statusFilter === 'true'
  const queryParams = useMemo(() => ({
    search: debouncedSearch.trim() || undefined,
    isActive,
    limit: USERS_PAGE_SIZE,
    offset: page * USERS_PAGE_SIZE,
  }), [debouncedSearch, isActive, page])

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['admin', 'users', 'list', queryParams],
    queryFn: () => fetchAdminUsers(queryParams),
    refetchInterval: 30_000,
  })

  const items = data?.items ?? []
  const total = data?.total ?? 0

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">用户运营</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">按余额、成本、调用次数查看用户清单，点击行展开用户详情。</p>
        </CardHeader>
        <CardContent>
          <div className="mb-3 grid gap-2 md:grid-cols-[1fr_180px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-2 size-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={event => setSearch(event.target.value)}
                className="pl-8"
                placeholder="搜索用户名或邮箱"
                aria-label="搜索用户"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="全部状态" />
              </SelectTrigger>
              <SelectContent>
                {USER_STATUS_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isLoading
            ? (
                <p className="py-8 text-center text-sm text-muted-foreground">正在读取用户列表...</p>
              )
            : items.length === 0
              ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">没有匹配的用户</p>
                )
              : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-215 text-sm">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="py-2 font-medium">用户</th>
                          <th className="py-2 font-medium">状态</th>
                          <th className="py-2 text-right font-medium">余额</th>
                          <th className="py-2 text-right font-medium">总成本</th>
                          <th className="py-2 text-right font-medium">总调用</th>
                          <th className="py-2 font-medium">最近活动</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map(user => (
                          <tr
                            key={user.id}
                            className="cursor-pointer border-b last:border-b-0 hover:bg-muted/40"
                            onClick={() => setSelectedUserId(user.id)}
                          >
                            <td className="py-2">
                              <div className="font-medium">{user.username}</div>
                              <div className="text-xs text-muted-foreground">{user.email ?? '-'}</div>
                            </td>
                            <td className="py-2">
                              <Badge variant={user.isActive ? 'default' : 'outline'}>
                                {user.isActive ? '启用' : '禁用'}
                              </Badge>
                            </td>
                            <td className="py-2 text-right font-mono text-xs">{formatCents(user.creditBalanceCents)}</td>
                            <td className="py-2 text-right font-mono text-xs">{formatCents(user.totalCostCents)}</td>
                            <td className="py-2 text-right">{formatNumber(user.totalCalls)}</td>
                            <td className="py-2 text-xs text-muted-foreground">{formatDate(user.lastActivityAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              第
              {' '}
              {total === 0 ? 0 : page * USERS_PAGE_SIZE + 1}
              {' '}
              -
              {' '}
              {Math.min((page + 1) * USERS_PAGE_SIZE, total)}
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
                onClick={() => setPage(prev => Math.max(0, prev - 1))}
              >
                上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={(page + 1) * USERS_PAGE_SIZE >= total || isFetching}
                onClick={() => setPage(prev => prev + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <AdminUserDetailDialog userId={selectedUserId} onClose={() => setSelectedUserId(null)} />
    </div>
  )
}

function AdminTaskDetailDialog({
  taskId,
  onClose,
  onRequeue,
  onCancel,
  isMutating,
}: {
  taskId: string | null
  onClose: () => void
  onRequeue: (id: string) => void
  onCancel: (id: string) => void
  isMutating: boolean
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: adminTasksQueryKeys.detail(taskId ?? ''),
    queryFn: () => fetchAdminTaskDetail(taskId!),
    enabled: !!taskId,
  })

  const detail: AdminTaskDetail | undefined = data?.data
  const task = detail?.task
  const runs: AdminPipelineRun[] = detail?.pipelineRuns ?? []
  const genRecords: AdminTaskGenerationRecord[] = detail?.generationRecords ?? []

  return (
    <Dialog open={!!taskId} onOpenChange={open => !open && onClose()}>
      {taskId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/80" onClick={onClose} />
          <div className="relative z-50 grid w-full max-w-3xl gap-4 overflow-hidden border bg-background p-6 shadow-lg rounded-xl max-h-[90vh] overflow-y-auto">
            {isLoading
              ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    正在加载任务详情...
                  </p>
                )
              : isError
                ? (
                    <p className="py-6 text-center text-sm text-destructive">
                      加载任务详情失败
                    </p>
                  )
                : !task
                    ? (
                        <p className="py-6 text-center text-sm text-muted-foreground">
                          任务不存在
                        </p>
                      )
                    : (
                        <>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h3 className="truncate text-lg font-semibold">{task.type}</h3>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <span>{task.domain}</span>
                                <span>·</span>
                                <span className="font-mono">{shortId(task.id)}</span>
                              </div>
                            </div>
                            <Badge variant={statusVariant(task.status)}>{statusLabel(task.status)}</Badge>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
                            <div className="rounded-lg border p-3">
                              <p className="text-xs text-muted-foreground">尝试</p>
                              <p className="mt-1 font-mono">
                                {task.attempts}
                                /
                                {task.maxAttempts}
                              </p>
                            </div>
                            <div className="rounded-lg border p-3">
                              <p className="text-xs text-muted-foreground">开始</p>
                              <p className="mt-1 text-xs">{formatDate(task.startedAt)}</p>
                            </div>
                            <div className="rounded-lg border p-3">
                              <p className="text-xs text-muted-foreground">结束</p>
                              <p className="mt-1 text-xs">{formatDate(task.finishedAt)}</p>
                            </div>
                            <div className="rounded-lg border p-3">
                              <p className="text-xs text-muted-foreground">下次执行</p>
                              <p className="mt-1 text-xs">{formatDate(task.nextRunAt)}</p>
                            </div>
                            <div className="rounded-lg border p-3">
                              <p className="text-xs text-muted-foreground">项目</p>
                              <p className="mt-1 font-mono text-xs">{shortId(task.projectId)}</p>
                            </div>
                            <div className="rounded-lg border p-3">
                              <p className="text-xs text-muted-foreground">账号</p>
                              <p className="mt-1 font-mono text-xs">{shortId(task.accountId)}</p>
                            </div>
                          </div>

                          {task.errorMessage && (
                            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                              <p className="mb-1 text-xs font-medium text-destructive">错误信息</p>
                              <p className="whitespace-pre-wrap break-all text-sm text-destructive">{task.errorMessage}</p>
                            </div>
                          )}

                          <div>
                            <div className="mb-2 flex items-center justify-between">
                              <p className="text-sm font-medium">Canvas pipeline run 时间线</p>
                              <span className="text-xs text-muted-foreground">
                                {runs.length}
                                {' '}
                                条
                              </span>
                            </div>
                            {runs.length === 0
                              ? (
                                  <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                                    该任务无关联 Canvas pipeline run（可能是 generate / gateway / subtitle 域任务）。
                                  </p>
                                )
                              : (
                                  <div className="space-y-2">
                                    {runs.map(run => (
                                      <div key={run.id} className="rounded-lg border p-3 text-sm">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          <div className="flex items-center gap-2">
                                            <Badge variant="outline">{pipelinePhaseLabel(run.phase)}</Badge>
                                            <Badge variant={statusVariant(run.status)}>{statusLabel(run.status)}</Badge>
                                          </div>
                                          <span className="font-mono text-xs text-muted-foreground">
                                            {formatLatencyMs(run.durationMs)}
                                          </span>
                                        </div>
                                        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground md:grid-cols-3">
                                          <div>
                                            开始：
                                            {formatDate(run.startedAt)}
                                          </div>
                                          <div>
                                            结束：
                                            {formatDate(run.finishedAt)}
                                          </div>
                                          <div>
                                            项目：
                                            {shortId(run.projectId)}
                                          </div>
                                        </div>
                                        {run.errorMessage && (
                                          <p className="mt-2 break-all text-xs text-destructive">{run.errorMessage}</p>
                                        )}
                                        {run.outputSummary && Object.keys(run.outputSummary).length > 0 && (
                                          <details className="mt-2">
                                            <summary className="cursor-pointer text-xs text-muted-foreground">输出摘要</summary>
                                            <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs">
                                              {JSON.stringify(run.outputSummary, null, 2)}
                                            </pre>
                                          </details>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                          </div>

                          <div>
                            <div className="mb-2 flex items-center justify-between">
                              <p className="text-sm font-medium">关联生成记录</p>
                              <span className="text-xs text-muted-foreground">
                                {genRecords.length}
                                {' '}
                                条
                              </span>
                            </div>
                            {genRecords.length === 0
                              ? (
                                  <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                                    暂无关联生成记录。
                                  </p>
                                )
                              : (
                                  <div className="space-y-2">
                                    {genRecords.map(record => (
                                      <div key={record.id} className="rounded-lg border p-3 text-sm">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <Badge variant="outline" className="font-mono">{record.model}</Badge>
                                            <Badge variant={statusVariant(record.status)}>{statusLabel(record.status)}</Badge>
                                            <Badge variant={record.matchReason === 'time-window' ? 'outline' : 'secondary'}>
                                              {generationRecordMatchLabel(record.matchReason)}
                                            </Badge>
                                          </div>
                                          <span className="font-mono text-xs text-muted-foreground">
                                            {record.costCents !== null ? `¥${(record.costCents / 100).toFixed(2)}` : '—'}
                                          </span>
                                        </div>
                                        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground md:grid-cols-3">
                                          <div>
                                            分类：
                                            {record.category}
                                          </div>
                                          <div>
                                            创建：
                                            {formatDate(record.createdAt)}
                                          </div>
                                          <div className="font-mono">
                                            {shortId(record.id)}
                                          </div>
                                        </div>
                                        {record.errorMessage && (
                                          <p className="mt-2 break-all text-xs text-destructive">{record.errorMessage}</p>
                                        )}
                                      </div>
                                    ))}
                                    {genRecords.some(r => r.matchReason === 'time-window') && (
                                      <p className="text-xs text-muted-foreground">
                                        候选记录按 accountId + 任务执行时间窗口匹配，可能含并发产生的记录，请结合创建时间人工判断。
                                      </p>
                                    )}
                                  </div>
                                )}
                          </div>

                          <div className="flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!task.canRequeue || isMutating}
                              onClick={() => onRequeue(task.id)}
                            >
                              <RotateCcw className="size-4" />
                              重排
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!task.canCancel || isMutating}
                              onClick={() => onCancel(task.id)}
                            >
                              <Ban className="size-4" />
                              取消
                            </Button>
                            <Button variant="outline" size="sm" onClick={onClose}>关闭</Button>
                          </div>
                        </>
                      )}
          </div>
        </div>
      )}
    </Dialog>
  )
}

function AdminUserDetailDialog({ userId, onClose }: { userId: string | null, onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', 'detail', userId],
    queryFn: () => fetchAdminUserDetail(userId!),
    enabled: !!userId,
  })

  const queryClient = useQueryClient()
  const [rechargeOpen, setRechargeOpen] = useState(false)
  const [rechargeAmount, setRechargeAmount] = useState('')
  const [rechargeDesc, setRechargeDesc] = useState('')
  const rechargeMutation = useMutation({
    mutationFn: () => adminCreditAdd({
      accountId: userId!,
      amountCents: Math.round(Number.parseFloat(rechargeAmount) * 100),
      description: rechargeDesc || undefined,
    }),
    onSuccess: () => {
      toast.success('充值成功')
      setRechargeOpen(false)
      setRechargeAmount('')
      setRechargeDesc('')
      queryClient.invalidateQueries({ queryKey: ['admin', 'users', 'detail', userId] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'users', 'list'] })
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  const detail: AdminUserDetail | undefined = data?.data
  const maxDailyCost = detail?.dailyCost.reduce((max, row) => Math.max(max, row.costCents), 0) ?? 0

  return (
    <>
      <Dialog open={!!userId} onOpenChange={open => !open && onClose()}>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/80" onClick={onClose} />
          <div className="relative z-50 grid w-full max-w-3xl gap-4 overflow-hidden border bg-background p-6 shadow-lg rounded-xl max-h-[90vh] overflow-y-auto">
            {isLoading || !detail
              ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">正在加载用户详情...</p>
                )
              : (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold">{detail.summary.username}</h3>
                        <p className="text-xs text-muted-foreground">{detail.summary.email ?? '-'}</p>
                      </div>
                      <Badge variant={detail.summary.isActive ? 'default' : 'outline'}>
                        {detail.summary.isActive ? '启用' : '禁用'}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <div className="rounded-lg border p-3">
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-muted-foreground">余额</p>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => setRechargeOpen(true)}
                          >
                            <Coins className="mr-1 size-3" />
                            充值
                          </Button>
                        </div>
                        <p className="mt-1 font-mono">{formatCents(detail.summary.creditBalanceCents)}</p>
                      </div>
                      <div className="rounded-lg border p-3">
                        <p className="text-xs text-muted-foreground">总成本</p>
                        <p className="mt-1 font-mono">{formatCents(detail.summary.totalCostCents)}</p>
                      </div>
                      <div className="rounded-lg border p-3">
                        <p className="text-xs text-muted-foreground">总调用</p>
                        <p className="mt-1">{formatNumber(detail.summary.totalCalls)}</p>
                      </div>
                    </div>

                    <div>
                      <p className="mb-2 text-sm font-medium">最近 30 天成本趋势</p>
                      {detail.dailyCost.length === 0
                        ? <p className="text-xs text-muted-foreground">最近 30 天无活动</p>
                        : (
                            <div className="space-y-1">
                              {detail.dailyCost.map(row => (
                                <div key={row.date} className="flex items-center gap-2 text-xs">
                                  <span className="w-24 shrink-0 font-mono text-muted-foreground">{row.date}</span>
                                  <div className="relative h-4 flex-1 overflow-hidden rounded bg-muted">
                                    <div
                                      className="h-full bg-primary/60"
                                      style={{ width: maxDailyCost === 0 ? '0%' : `${(row.costCents / maxDailyCost) * 100}%` }}
                                    />
                                  </div>
                                  <span className="w-20 shrink-0 text-right font-mono">{formatCents(row.costCents)}</span>
                                  <span className="w-12 shrink-0 text-right text-muted-foreground">
                                    {row.calls}
                                    次
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                    </div>

                    <div>
                      <p className="mb-2 text-sm font-medium">模型成本分解（前 10）</p>
                      {detail.modelBreakdown.length === 0
                        ? <p className="text-xs text-muted-foreground">暂无模型调用记录</p>
                        : (
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b text-left text-muted-foreground">
                                  <th className="py-1.5 font-medium">模型</th>
                                  <th className="py-1.5 text-right font-medium">调用</th>
                                  <th className="py-1.5 text-right font-medium">成本</th>
                                </tr>
                              </thead>
                              <tbody>
                                {detail.modelBreakdown.map(row => (
                                  <tr key={row.model} className="border-b last:border-b-0">
                                    <td className="py-1.5 font-mono text-xs">{row.model}</td>
                                    <td className="py-1.5 text-right">{formatNumber(row.calls)}</td>
                                    <td className="py-1.5 text-right font-mono text-xs">{formatCents(row.costCents)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                    </div>

                    <div>
                      <p className="mb-2 text-sm font-medium">最近 10 条生成记录</p>
                      {detail.recentRecords.length === 0
                        ? <p className="text-xs text-muted-foreground">暂无生成记录</p>
                        : (
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b text-left text-muted-foreground">
                                  <th className="py-1.5 font-medium">模型</th>
                                  <th className="py-1.5 font-medium">状态</th>
                                  <th className="py-1.5 font-medium">执行</th>
                                  <th className="py-1.5 text-right font-medium">成本</th>
                                  <th className="py-1.5 font-medium">时间</th>
                                </tr>
                              </thead>
                              <tbody>
                                {detail.recentRecords.map(record => (
                                  <tr key={record.id} className="border-b last:border-b-0">
                                    <td className="py-1.5 font-mono text-xs">{record.model}</td>
                                    <td className="py-1.5">
                                      <Badge variant={statusVariant(record.status)}>{statusLabel(record.status)}</Badge>
                                    </td>
                                    <td className="py-1.5">
                                      <div className="flex flex-col gap-1">
                                        <Badge variant={record.executionKind === 'legacy-provider-task' ? 'outline' : 'secondary'} className="w-fit">
                                          {recentRecordExecutionLabel(record.executionKind)}
                                        </Badge>
                                        {record.providerTaskId && (
                                          <span className="font-mono text-[11px] text-muted-foreground">
                                            {shortId(record.providerTaskId)}
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="py-1.5 text-right font-mono text-xs">{formatCents(record.costCents)}</td>
                                    <td className="py-1.5 text-xs text-muted-foreground">{formatDate(record.createdAt)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                    </div>

                    {/* API Key 列表 */}
                    <AdminUserApiKeysSection userId={userId} />

                    <div className="flex justify-end">
                      <Button variant="outline" size="sm" onClick={onClose}>关闭</Button>
                    </div>
                  </>
                )}
          </div>
        </div>
      </Dialog>

      {/* 充值对话框 */}
      <Dialog open={rechargeOpen} onOpenChange={setRechargeOpen}>
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/80" onClick={() => setRechargeOpen(false)} />
          <div className="relative z-[60] w-full max-w-sm rounded-xl border bg-background p-6 shadow-lg">
            <h3 className="mb-4 text-base font-semibold">充值</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              用户：
              {detail?.summary.username}
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">金额（元）</label>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="例如 10.00"
                  value={rechargeAmount}
                  onChange={e => setRechargeAmount(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">备注（可选）</label>
                <Input
                  placeholder="管理后台充值"
                  value={rechargeDesc}
                  onChange={e => setRechargeDesc(e.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setRechargeOpen(false)}>取消</Button>
                <Button
                  size="sm"
                  disabled={!rechargeAmount || Number.parseFloat(rechargeAmount) <= 0 || rechargeMutation.isPending}
                  onClick={() => rechargeMutation.mutate()}
                >
                  {rechargeMutation.isPending ? '充值中...' : '确认充值'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Dialog>
    </>
  )
}

function AdminUserApiKeysSection({ userId }: { userId: string | null }) {
  const { data, isLoading } = useQuery({
    queryKey: adminUserApiKeysQueryKeys.list(userId ?? ''),
    queryFn: () => fetchAdminUserApiKeys(userId!),
    enabled: !!userId,
  })

  const keys: AdminApiKeyItem[] = data?.items ?? []

  return (
    <div>
      <p className="mb-2 text-sm font-medium">API Key 列表</p>
      {isLoading
        ? <p className="text-xs text-muted-foreground">加载中...</p>
        : keys.length === 0
          ? <p className="text-xs text-muted-foreground">该用户暂无 API Key</p>
          : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-1.5 font-medium">前缀</th>
                      <th className="py-1.5 font-medium">名称</th>
                      <th className="py-1.5 font-medium">Scope</th>
                      <th className="py-1.5 font-medium">限流</th>
                      <th className="py-1.5 font-medium">额度消耗</th>
                      <th className="py-1.5 font-medium">状态</th>
                      <th className="py-1.5 font-medium">最近使用</th>
                      <th className="py-1.5 font-medium">创建时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map(key => (
                      <tr key={key.id} className="border-b last:border-b-0">
                        <td className="py-1.5 font-mono text-xs">
                          {key.prefix}
                          ...
                        </td>
                        <td className="py-1.5 text-xs">{key.name ?? '-'}</td>
                        <td className="py-1.5">
                          <Badge variant={key.scope === 'gateway' ? 'secondary' : 'outline'} className="text-[10px]">
                            {key.scope === 'gateway' ? 'Gateway' : 'All'}
                          </Badge>
                        </td>
                        <td className="py-1.5 text-xs text-muted-foreground">
                          {key.rateLimitPerMinute
                            ? `${key.rateLimitPerMinute}次/分`
                            : '-'}
                        </td>
                        <td className="py-1.5 text-xs text-muted-foreground">
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
                            : '-'}
                        </td>
                        <td className="py-1.5">
                          <Badge variant={key.revokedAt ? 'outline' : 'default'}>
                            {key.revokedAt ? '已撤销' : '启用'}
                          </Badge>
                        </td>
                        <td className="py-1.5 text-xs text-muted-foreground">{formatDate(key.lastUsedAt)}</td>
                        <td className="py-1.5 text-xs text-muted-foreground">{formatDate(key.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
    </div>
  )
}

function AdminGatewayClientsTab() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [debouncedSearch] = useDebounce(search, 300)

  const queryParams = useMemo(() => ({
    search: debouncedSearch.trim() || undefined,
    limit: USERS_PAGE_SIZE,
    offset: page * USERS_PAGE_SIZE,
  }), [debouncedSearch, page])

  const { data, isLoading, isFetching } = useQuery({
    queryKey: adminGatewayClientsQueryKeys.list(queryParams),
    queryFn: () => fetchAdminGatewayClients(queryParams),
    refetchInterval: 30_000,
  })

  const items: AdminGatewayClientItem[] = data?.items ?? []
  const total = data?.total ?? 0

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <KeyRound className="size-4" />
            Gateway 客户
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">持有 ≥1 个 API Key 的账户聚合视图：活跃/总 key 数、Key 消耗、额度上限、最近活动。点击行展开客户详情并管理其 Key。</p>
        </CardHeader>
        <CardContent>
          <div className="mb-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-2 size-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={event => setSearch(event.target.value)}
                className="pl-8"
                placeholder="搜索用户名或邮箱"
                aria-label="搜索 Gateway 客户"
              />
            </div>
          </div>

          {isLoading
            ? (
                <p className="py-8 text-center text-sm text-muted-foreground">正在读取 Gateway 客户列表...</p>
              )
            : items.length === 0
              ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">没有匹配的客户</p>
                )
              : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-215 text-sm">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="py-2 font-medium">用户</th>
                          <th className="py-2 text-right font-medium">活跃 key</th>
                          <th className="py-2 text-right font-medium">总 key</th>
                          <th className="py-2 text-right font-medium">Key 消耗</th>
                          <th className="py-2 text-right font-medium">额度上限</th>
                          <th className="py-2 font-medium">最近活动</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map(client => (
                          <tr
                            key={client.accountId}
                            className="cursor-pointer border-b last:border-b-0 hover:bg-muted/40"
                            onClick={() => setSelectedAccountId(client.accountId)}
                          >
                            <td className="py-2">
                              <div className="font-medium">{client.username}</div>
                              <div className="text-xs text-muted-foreground">{client.email ?? '-'}</div>
                            </td>
                            <td className="py-2 text-right">{client.activeKeyCount}</td>
                            <td className="py-2 text-right">{client.totalKeyCount}</td>
                            <td className="py-2 text-right font-mono text-xs">{formatCents(client.totalSpendCents)}</td>
                            <td className="py-2 text-right font-mono text-xs text-muted-foreground">
                              {client.totalQuotaCents === null ? '无限制' : formatCents(client.totalQuotaCents)}
                            </td>
                            <td className="py-2 text-xs text-muted-foreground">{formatDate(client.lastKeyActivityAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              第
              {' '}
              {total === 0 ? 0 : page * USERS_PAGE_SIZE + 1}
              {' '}
              -
              {' '}
              {Math.min((page + 1) * USERS_PAGE_SIZE, total)}
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
                onClick={() => setPage(prev => Math.max(0, prev - 1))}
              >
                上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={(page + 1) * USERS_PAGE_SIZE >= total || isFetching}
                onClick={() => setPage(prev => prev + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <AdminGatewayClientDetailDialog accountId={selectedAccountId} onClose={() => setSelectedAccountId(null)} />
    </div>
  )
}

function AdminGatewayClientDetailDialog({ accountId, onClose }: { accountId: string | null, onClose: () => void }) {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: adminGatewayClientsQueryKeys.detail(accountId ?? ''),
    queryFn: () => fetchAdminGatewayClientDetail(accountId!),
    enabled: !!accountId,
  })

  const detail: AdminGatewayClientDetail | undefined = data?.data
  const summary = detail?.summary
  const keys: AdminApiKeyItem[] = detail?.keys ?? []
  const recentRecords = detail?.recentGatewayRecords ?? []
  const [editingKey, setEditingKey] = useState<AdminApiKeyItem | null>(null)
  const [pendingAction, setPendingAction] = useState<{ kind: 'reset' | 'revoke', key: AdminApiKeyItem } | null>(null)

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'gateway-clients'] })
  }

  const resetMutation = useMutation({
    mutationFn: (id: string) => resetApiKeyQuota(id),
    onSuccess: async () => {
      toast.success('已重置该 Key 的额度消耗')
      setPendingAction(null)
      await invalidate()
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : '重置额度失败')
    },
  })

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeApiKeyAdmin(id),
    onSuccess: async () => {
      toast.success('已撤销该 Key')
      setPendingAction(null)
      await invalidate()
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : '撤销 Key 失败')
    },
  })

  const isMutating = resetMutation.isPending || revokeMutation.isPending

  const confirmAction = () => {
    if (!pendingAction)
      return
    if (pendingAction.kind === 'revoke')
      revokeMutation.mutate(pendingAction.key.id)
    else
      resetMutation.mutate(pendingAction.key.id)
  }

  return (
    <>
      <Dialog open={!!accountId} onOpenChange={open => !open && onClose()}>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/80" onClick={onClose} />
          <div className="relative z-50 grid w-full max-w-3xl gap-4 overflow-hidden border bg-background p-6 shadow-lg rounded-xl max-h-[90vh] overflow-y-auto">
            {isLoading || !summary
              ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">正在加载客户详情...</p>
                )
              : (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold">{summary.username}</h3>
                        <p className="text-xs text-muted-foreground">{summary.email ?? '-'}</p>
                      </div>
                      <Badge variant={summary.activeKeyCount > 0 ? 'default' : 'outline'}>
                        {summary.activeKeyCount > 0 ? '活跃' : '无活跃 key'}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                      <div className="rounded-lg border p-3">
                        <p className="text-xs text-muted-foreground">账户余额</p>
                        <p className="mt-1 font-mono">{formatCents(summary.creditBalanceCents)}</p>
                      </div>
                      <div className="rounded-lg border p-3">
                        <p className="text-xs text-muted-foreground">Key 消耗</p>
                        <p className="mt-1 font-mono">{formatCents(summary.totalSpendCents)}</p>
                      </div>
                      <div className="rounded-lg border p-3">
                        <p className="text-xs text-muted-foreground">Gateway 调用</p>
                        <p className="mt-1">{formatNumber(summary.gatewayCalls)}</p>
                      </div>
                      <div className="rounded-lg border p-3">
                        <p className="text-xs text-muted-foreground">Gateway 累计</p>
                        <p className="mt-1 font-mono">{formatCents(summary.gatewaySpendCents)}</p>
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-sm font-medium">API Key 管理</p>
                        <span className="text-xs text-muted-foreground">
                          活跃
                          {' '}
                          {summary.activeKeyCount}
                          {' '}
                          /
                          {' '}
                          {summary.totalKeyCount}
                        </span>
                      </div>
                      <AdminGatewayKeysTable
                        keys={keys}
                        isMutating={isMutating}
                        onEdit={setEditingKey}
                        onReset={key => setPendingAction({ kind: 'reset', key })}
                        onRevoke={key => setPendingAction({ kind: 'revoke', key })}
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        限流（次/分）为单进程内计数，多实例部署下不互通；额度按配额周期自动重置，也可在此手动重置。
                      </p>
                    </div>

                    <div>
                      <p className="mb-2 text-sm font-medium">最近 Gateway 调用记录（前 50）</p>
                      {recentRecords.length === 0
                        ? <p className="text-xs text-muted-foreground">暂无 Gateway 调用记录</p>
                        : (
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b text-left text-muted-foreground">
                                    <th className="py-1.5 font-medium">模型</th>
                                    <th className="py-1.5 font-medium">状态</th>
                                    <th className="py-1.5 text-right font-medium">成本</th>
                                    <th className="py-1.5 font-medium">时间</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {recentRecords.map(record => (
                                    <tr key={record.id} className="border-b last:border-b-0">
                                      <td className="py-1.5 font-mono text-xs">{record.model}</td>
                                      <td className="py-1.5">
                                        <Badge variant={statusVariant(record.status)}>{statusLabel(record.status)}</Badge>
                                      </td>
                                      <td className="py-1.5 text-right font-mono text-xs">{formatCents(record.costCents)}</td>
                                      <td className="py-1.5 text-xs text-muted-foreground">{formatDate(record.createdAt)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                    </div>

                    <div className="flex justify-end">
                      <Button variant="outline" size="sm" onClick={onClose}>关闭</Button>
                    </div>
                  </>
                )}
          </div>
        </div>
      </Dialog>

      <AdminApiKeyConfigDialog
        apiKey={editingKey}
        accountId={accountId}
        onClose={() => setEditingKey(null)}
        onSaved={invalidate}
      />

      <AlertDialog open={!!pendingAction} onOpenChange={open => !open && setPendingAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction?.kind === 'revoke' ? '确认撤销该 Key？' : '确认重置该 Key 的额度？'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction?.kind === 'revoke'
                ? '撤销后该 Key 立即失效且不可恢复，所有正在使用该 Key 的请求都会被拒绝。'
                : '将 totalSpendCents 归零并清除额度重置时间，相当于手动开启一个新的配额周期。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMutating}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={isMutating}
              onClick={confirmAction}
            >
              {isMutating ? '处理中...' : '确认'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function AdminGatewayKeysTable({
  keys,
  isMutating,
  onEdit,
  onReset,
  onRevoke,
}: {
  keys: AdminApiKeyItem[]
  isMutating: boolean
  onEdit: (key: AdminApiKeyItem) => void
  onReset: (key: AdminApiKeyItem) => void
  onRevoke: (key: AdminApiKeyItem) => void
}) {
  if (keys.length === 0) {
    return <p className="text-xs text-muted-foreground">该客户暂无 API Key</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-1.5 font-medium">前缀</th>
            <th className="py-1.5 font-medium">Scope</th>
            <th className="py-1.5 font-medium">限流</th>
            <th className="py-1.5 font-medium">额度消耗</th>
            <th className="py-1.5 font-medium">状态</th>
            <th className="py-1.5 font-medium">最近使用</th>
            <th className="py-1.5 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {keys.map(key => (
            <tr key={key.id} className="border-b last:border-b-0">
              <td className="py-1.5 font-mono text-xs">
                {key.prefix}
                ...
              </td>
              <td className="py-1.5">
                <Badge variant={key.scope === 'gateway' ? 'secondary' : 'outline'} className="text-[10px]">
                  {key.scope === 'gateway' ? 'Gateway' : 'All'}
                </Badge>
              </td>
              <td className="py-1.5 text-xs text-muted-foreground">
                {key.rateLimitPerMinute ? `${key.rateLimitPerMinute}次/分` : '-'}
              </td>
              <td className="py-1.5 text-xs text-muted-foreground">
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
              </td>
              <td className="py-1.5">
                <Badge variant={key.revokedAt ? 'outline' : 'default'}>
                  {key.revokedAt ? '已撤销' : '启用'}
                </Badge>
              </td>
              <td className="py-1.5 text-xs text-muted-foreground">{formatDate(key.lastUsedAt)}</td>
              <td className="py-1.5 text-right">
                {key.revokedAt
                  ? <span className="text-xs text-muted-foreground">-</span>
                  : (
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => onEdit(key)}>
                          <Pencil className="size-3.5" />
                          配置
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isMutating}
                          onClick={() => onReset(key)}
                        >
                          <RotateCcw className="size-3.5" />
                          重置额度
                        </Button>
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
                      </div>
                    )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const KEY_SCOPE_OPTIONS = [
  { value: 'all', label: '完全访问' },
  { value: 'gateway', label: '仅 Gateway' },
]

function AdminApiKeyConfigDialog({
  apiKey,
  accountId,
  onClose,
  onSaved,
}: {
  apiKey: AdminApiKeyItem | null
  accountId: string | null
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const [scope, setScope] = useState(apiKey?.scope ?? 'all')
  const [rateLimit, setRateLimit] = useState(apiKey?.rateLimitPerMinute?.toString() ?? '')
  const [quota, setQuota] = useState(apiKey?.quotaMaxCents ? (apiKey.quotaMaxCents / 100).toString() : '')
  const [submitting, setSubmitting] = useState(false)

  // 切换编辑的 key 时同步表单初值（dialog 可能复用挂载实例）
  useEffect(() => {
    if (apiKey) {
      setScope(apiKey.scope ?? 'all')
      setRateLimit(apiKey.rateLimitPerMinute?.toString() ?? '')
      setQuota(apiKey.quotaMaxCents ? (apiKey.quotaMaxCents / 100).toString() : '')
    }
  }, [apiKey])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!apiKey || !accountId)
      return
    setSubmitting(true)
    try {
      await fetchAdminUpdateApiKeyConfig({
        id: apiKey.id,
        userId: accountId,
        scope,
        rateLimitPerMinute: rateLimit.trim() === '' ? null : Number(rateLimit),
        quotaMaxCents: quota.trim() === '' ? null : Math.round(Number(quota) * 100),
      })
      toast.success('已更新 Key 配置')
      await onSaved()
      onClose()
    }
    catch (err) {
      toast.error(err instanceof Error ? err.message : '更新配置失败')
    }
    finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={!!apiKey} onOpenChange={open => !open && onClose()}>
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
        <div className="fixed inset-0 bg-black/80" onClick={onClose} />
        <form
          onSubmit={handleSubmit}
          className="relative z-[60] grid w-full max-w-md gap-4 border bg-background p-6 shadow-lg rounded-xl"
        >
          <div>
            <h3 className="text-base font-semibold">编辑 Key 配置</h3>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {apiKey?.prefix}
              ...
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">访问范围</label>
            <Select value={scope} onValueChange={setScope} disabled={submitting}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KEY_SCOPE_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">限流（次/分，留空不限制）</label>
            <Input
              type="number"
              min={1}
              value={rateLimit}
              onChange={e => setRateLimit(e.target.value)}
              placeholder="留空表示不限流"
              disabled={submitting}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">额度上限（元，留空不限制）</label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={quota}
              onChange={e => setQuota(e.target.value)}
              placeholder="留空表示无额度限制"
              disabled={submitting}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={submitting}>取消</Button>
            <Button type="submit" size="sm" disabled={submitting}>{submitting ? '保存中...' : '保存'}</Button>
          </div>
        </form>
      </div>
    </Dialog>
  )
}

const TABS: { id: AdminTab, label: string }[] = [
  { id: 'overview', label: '概览' },
  { id: 'users', label: '用户' },
  { id: 'providers', label: 'Provider' },
  { id: 'projects', label: '项目' },
  { id: 'gateway', label: 'Gateway 客户' },
  { id: 'audit', label: '审计' },
]

export default function Admin() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<AdminTab>('overview')
  const [taskStatus, setTaskStatus] = useState('all')
  const [taskDomain, setTaskDomain] = useState('all')
  const [taskSearch, setTaskSearch] = useState('')

  const taskParams = useMemo(() => ({
    status: taskStatus === 'all' ? undefined : taskStatus,
    domain: taskDomain === 'all' ? undefined : taskDomain,
    search: taskSearch.trim() || undefined,
    limit: TASK_LIMIT,
    offset: 0,
  }), [taskDomain, taskSearch, taskStatus])

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: adminQueryKeys.overview,
    queryFn: fetchAdminOverview,
    refetchInterval: 30_000,
  })

  const {
    data: taskData,
    isLoading: isTasksLoading,
    isFetching: isTasksFetching,
    refetch: refetchTasks,
  } = useQuery({
    queryKey: adminQueryKeys.tasks(taskParams),
    queryFn: () => fetchAdminTasks(taskParams),
    refetchInterval: 15_000,
    enabled: !!data,
  })

  const refreshAdminData = async () => {
    await queryClient.invalidateQueries({ queryKey: adminQueryKeys.all })
  }

  const requeueMutation = useMutation({
    mutationFn: requeueAdminTask,
    onSuccess: async () => {
      toast.success('任务已重新排队')
      await refreshAdminData()
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : '重排任务失败')
    },
  })

  const cancelMutation = useMutation({
    mutationFn: cancelAdminTask,
    onSuccess: async () => {
      toast.success('任务已取消')
      await refreshAdminData()
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : '取消任务失败')
    },
  })

  if (isLoading) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center text-sm text-muted-foreground">
        管理后台加载中...
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Card className="border-destructive/40">
          <CardContent className="space-y-3 p-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-4" />
              <span className="font-medium">无法访问管理后台</span>
            </div>
            <p className="text-sm text-muted-foreground">
              请确认当前用户 ID 已配置到服务端
              {' '}
              <code>ADMIN_USER_IDS</code>
              。
            </p>
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="size-4" />
              重试
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl p-4">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" />
            <h1 className="text-lg font-semibold">管理后台</h1>
            <Badge variant="secondary">内部</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            运营侧只读统计：概览 / 用户用量 / Provider 错误率与成本。
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`size-4 ${isFetching ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap gap-1 rounded-lg border bg-muted/40 p-1">
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              activeTab === tab.id ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <AdminOverviewTab
          data={data}
          taskData={taskData}
          isTasksLoading={isTasksLoading}
          isTasksFetching={isTasksFetching}
          isFetching={isFetching}
          isMutating={requeueMutation.isPending || cancelMutation.isPending}
          taskStatus={taskStatus}
          taskDomain={taskDomain}
          taskSearch={taskSearch}
          refetch={refetch}
          refetchTasks={refetchTasks}
          setTaskStatus={setTaskStatus}
          setTaskDomain={setTaskDomain}
          setTaskSearch={setTaskSearch}
          requeue={id => requeueMutation.mutate(id)}
          cancel={id => cancelMutation.mutate(id)}
        />
      )}

      {activeTab === 'users' && <AdminUsersTab />}

      {activeTab === 'providers' && <AdminProvidersTab />}

      {activeTab === 'projects' && <AdminProjectsTab />}

      {activeTab === 'gateway' && <AdminGatewayClientsTab />}

      {activeTab === 'audit' && <AdminAuditLogsTab />}
    </div>
  )
}
