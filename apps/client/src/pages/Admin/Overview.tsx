/**
 * Admin 概览 Tab — 系统概览指标 + 任务诊断
 */
import type { AdminOverview, AdminPipelineRun, AdminTaskDetail, AdminTaskGenerationRecord, AdminTaskItem } from '@excuse/shared'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  Ban,
  ClipboardList,
  Coins,
  FolderKanban,
  RefreshCw,
  Search,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import { adminTasksQueryKeys, fetchAdminTaskDetail } from '@/api/admin'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatLatencyMs, pipelinePhaseLabel } from '@/lib/admin-format'
import { formatCents } from '@/lib/generation-utils'
import {
  formatDate,
  generationRecordMatchLabel,
  shortId,
  StatCard,
  statusLabel,
  StatusList,
  statusVariant,
  TASK_DOMAIN_OPTIONS,
  TASK_STATUS_OPTIONS,
  TaskTable,
} from './shared'

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
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto" showCloseButton>
          {isLoading
            ? (
                <p className="py-6 text-center text-sm text-muted-foreground">正在加载任务详情...</p>
              )
            : isError
              ? (
                  <p className="py-6 text-center text-sm text-destructive">加载任务详情失败</p>
                )
              : !task
                  ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">任务不存在</p>
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
                            <RefreshCw className="mr-1 size-3" />
                            重排
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!task.canCancel || isMutating}
                            onClick={() => onCancel(task.id)}
                          >
                            <Ban className="mr-1 size-3" />
                            取消
                          </Button>
                          <Button variant="outline" size="sm" onClick={onClose}>关闭</Button>
                        </div>
                      </>
                    )}
        </DialogContent>
      )}
    </Dialog>
  )
}

export function AdminOverviewTab({
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
                            <Badge variant="outline">{item.kind}</Badge>
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
