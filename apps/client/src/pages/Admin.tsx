import type { AdminOverview, AdminTaskItem } from '@/api/client'
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
import { cancelAdminTask, fetchAdminOverview, fetchAdminTasks, requeueAdminTask } from '@/api/client'
import { adminQueryKeys } from '@/api/query-client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { formatCents } from '@/lib/generation-utils'

const TASK_LIMIT = 40

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

export default function Admin() {
  const queryClient = useQueryClient()
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

  const { summary } = data

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
            运营侧只读概览：用户、生成、任务队列、Canvas 状态和最近失败。
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`size-4 ${isFetching ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="用户" value={summary.totalUsers} hint={`活跃 ${summary.activeUsers}`} icon={Users} />
        <StatCard title="生成记录" value={summary.totalGenerationRecords} hint={`失败 ${summary.failedGenerationRecords}`} icon={Activity} />
        <StatCard title="总成本" value={formatCents(summary.totalCostCents)} hint="generation_records 聚合" icon={Coins} />
        <StatCard title="活跃任务" value={summary.activeTasks} hint={`活跃 Canvas ${summary.activeCanvasProjects}`} icon={ClipboardList} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
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

      <Card className="mt-4">
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

      <Card className="mt-4">
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
            isMutating={requeueMutation.isPending || cancelMutation.isPending}
            onRequeue={id => requeueMutation.mutate(id)}
            onCancel={id => cancelMutation.mutate(id)}
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
            <span>自动刷新 15 秒</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
