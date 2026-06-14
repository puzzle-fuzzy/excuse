import type { AdminOverview, AdminProviderStatsItem, AdminTaskItem, AdminUserDetail } from '@excuse/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  Ban,
  ClipboardList,
  Coins,
  FolderKanban,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useDebounce } from 'use-debounce'
import { fetchAdminProviderStats, fetchAdminUserDetail, fetchAdminUsers } from '@/api/admin'
import { cancelAdminTask, fetchAdminOverview, fetchAdminTasks, requeueAdminTask } from '@/api/client'
import { adminQueryKeys } from '@/api/query-client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { formatLatencyMs, formatNumber, formatPercent } from '@/lib/admin-format'
import { formatCents } from '@/lib/generation-utils'

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
  { label: '全部状态', value: '' },
  { label: '等待', value: 'queued' },
  { label: '运行', value: 'running' },
  { label: '重试', value: 'retrying' },
  { label: '失败', value: 'failed' },
  { label: '成功', value: 'succeeded' },
  { label: '取消', value: 'cancelled' },
]

const TASK_DOMAIN_OPTIONS = [
  { label: '全部领域', value: '' },
  { label: 'Canvas', value: 'canvas' },
  { label: '生成', value: 'generate' },
  { label: '字幕', value: 'subtitle' },
  { label: 'Gateway', value: 'gateway' },
]

const USER_STATUS_OPTIONS = [
  { label: '全部状态', value: '' },
  { label: '已启用', value: 'true' },
  { label: '已禁用', value: 'false' },
]

const PROVIDER_WINDOW_OPTIONS = [
  { label: '近 1 小时', value: '1' },
  { label: '近 6 小时', value: '6' },
  { label: '近 24 小时', value: '24' },
  { label: '近 7 天', value: '168' },
]

type AdminTab = 'overview' | 'users' | 'providers'

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

function TaskTable({
  tasks,
  isLoading,
  isMutating,
  onRequeue,
  onCancel,
}: {
  tasks: AdminTaskItem[]
  isLoading: boolean
  isMutating: boolean
  onRequeue: (id: string) => void
  onCancel: (id: string) => void
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
      <table className="w-full min-w-[1060px] text-sm">
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
            <Select value={taskStatus} onChange={event => setTaskStatus(event.target.value)} options={TASK_STATUS_OPTIONS} />
            <Select value={taskDomain} onChange={event => setTaskDomain(event.target.value)} options={TASK_DOMAIN_OPTIONS} />
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
    </div>
  )
}

const CATEGORY_LABELS: Record<string, string> = {
  text: '文本',
  image: '图片',
  video: '视频',
  subtitle: '字幕',
}

function AdminUsersTab() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(0)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [debouncedSearch] = useDebounce(search, 300)

  const isActive = statusFilter === '' ? undefined : statusFilter === 'true'
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
            <Select
              value={statusFilter}
              onChange={event => setStatusFilter(event.target.value)}
              options={USER_STATUS_OPTIONS}
            />
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
                    <table className="w-full min-w-[860px] text-sm">
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

function AdminUserDetailDialog({ userId, onClose }: { userId: string | null, onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', 'detail', userId],
    queryFn: () => fetchAdminUserDetail(userId!),
    enabled: !!userId,
  })

  const detail: AdminUserDetail | undefined = data?.data
  const maxDailyCost = detail?.dailyCost.reduce((max, row) => Math.max(max, row.costCents), 0) ?? 0

  return (
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
                      <p className="text-xs text-muted-foreground">余额</p>
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
                                  <td className="py-1.5 text-right font-mono text-xs">{formatCents(record.costCents)}</td>
                                  <td className="py-1.5 text-xs text-muted-foreground">{formatDate(record.createdAt)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
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
  )
}

function AdminProvidersTab() {
  const [windowHours, setWindowHours] = useState(24)

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['admin', 'providers', windowHours],
    queryFn: () => fetchAdminProviderStats({ windowHours }),
    refetchInterval: 30_000,
  })

  const items: AdminProviderStatsItem[] = data?.items ?? []

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm">Provider 错误率与模型成本</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              count / cost / tokens 来自 generation_records 聚合；avg / p50 / p95 延迟来自 server 进程内 metrics（重启归零，不含 worker）。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={String(windowHours)}
              onChange={event => setWindowHours(Number(event.target.value))}
              options={PROVIDER_WINDOW_OPTIONS}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading
          ? (
              <p className="py-8 text-center text-sm text-muted-foreground">正在读取 provider 统计...</p>
            )
          : items.length === 0
            ? (
                <p className="py-8 text-center text-sm text-muted-foreground">该窗口内暂无生成记录</p>
              )
            : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1100px] text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 font-medium">模型</th>
                        <th className="py-2 font-medium">分类</th>
                        <th className="py-2 text-right font-medium">调用</th>
                        <th className="py-2 text-right font-medium">成功</th>
                        <th className="py-2 text-right font-medium">失败</th>
                        <th className="py-2 text-right font-medium">失败率</th>
                        <th className="py-2 text-right font-medium">avg</th>
                        <th className="py-2 text-right font-medium">p50</th>
                        <th className="py-2 text-right font-medium">p95</th>
                        <th className="py-2 text-right font-medium">成本</th>
                        <th className="py-2 text-right font-medium">输入 tokens</th>
                        <th className="py-2 text-right font-medium">输出 tokens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(item => (
                        <tr key={`${item.model}:${item.category}`} className="border-b last:border-b-0">
                          <td className="py-2 font-mono text-xs">{item.model}</td>
                          <td className="py-2">
                            <Badge variant="outline">{CATEGORY_LABELS[item.category] ?? item.category}</Badge>
                          </td>
                          <td className="py-2 text-right">{formatNumber(item.totalCalls)}</td>
                          <td className="py-2 text-right">{formatNumber(item.succeededCalls)}</td>
                          <td className="py-2 text-right text-destructive">{formatNumber(item.failedCalls)}</td>
                          <td className="py-2 text-right">{formatPercent(item.failureRate)}</td>
                          <td className="py-2 text-right">{formatLatencyMs(item.avgLatencyMs)}</td>
                          <td className="py-2 text-right">{formatLatencyMs(item.p50LatencyMs)}</td>
                          <td className="py-2 text-right">{formatLatencyMs(item.p95LatencyMs)}</td>
                          <td className="py-2 text-right font-mono text-xs">{formatCents(item.totalCostCents)}</td>
                          <td className="py-2 text-right">{formatNumber(item.totalInputTokens)}</td>
                          <td className="py-2 text-right">{formatNumber(item.totalOutputTokens)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
        <p className="mt-3 text-xs text-muted-foreground">
          {isFetching ? '正在刷新...' : `当前窗口 ${windowHours} 小时；自动刷新 30 秒`}
        </p>
      </CardContent>
    </Card>
  )
}

const TABS: { id: AdminTab, label: string }[] = [
  { id: 'overview', label: '概览' },
  { id: 'users', label: '用户' },
  { id: 'providers', label: 'Provider' },
]

export default function Admin() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<AdminTab>('overview')
  const [taskStatus, setTaskStatus] = useState('')
  const [taskDomain, setTaskDomain] = useState('')
  const [taskSearch, setTaskSearch] = useState('')

  const taskParams = useMemo(() => ({
    status: taskStatus || undefined,
    domain: taskDomain || undefined,
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
    </div>
  )
}
