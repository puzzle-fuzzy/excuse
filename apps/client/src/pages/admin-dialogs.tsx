import type { AdminApiKeyItem, AdminTaskDetail, AdminTaskGenerationRecord, AdminUserDetail, AdminUserRecentRecord } from '@excuse/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Coins, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { adminCreditAdd, adminTasksQueryKeys, adminUserApiKeysQueryKeys, fetchAdminTaskDetail, fetchAdminUserApiKeys, fetchAdminUserDetail } from '@/api/admin'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { formatCents } from '@/lib/generation-utils'
import { formatDate, generationRecordMatchLabel, recentRecordExecutionLabel, shortId, statusLabel, statusVariant } from './admin-utils'

// ── TaskTable（AdminOverviewTab 使用）─────────────────────────

export function TaskTable({
  items,
  isFetching,
  onRequeue,
  onCancel,
  isMutating,
  onViewDetail,
}: {
  items: Array<{ id: string, type: string, domain: string, status: string, attempts: number, maxAttempts: number, nextRunAt: string | null, createdAt: string }>
  isFetching: boolean
  onRequeue: (id: string) => void
  onCancel: (id: string) => void
  isMutating: boolean
  onViewDetail: (id: string) => void
}) {
  if (items.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">{isFetching ? '正在刷新...' : '暂无任务'}</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 font-medium">类型</th>
            <th className="py-2 font-medium">领域</th>
            <th className="py-2 font-medium">状态</th>
            <th className="py-2 text-right font-medium">尝试</th>
            <th className="py-2 font-medium">下次执行</th>
            <th className="py-2 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map(task => (
            <tr key={task.id} className="cursor-pointer border-b last:border-b-0 hover:bg-muted/40" onClick={() => onViewDetail(task.id)}>
              <td className="py-2">{task.type}</td>
              <td className="py-2">{task.domain}</td>
              <td className="py-2">
                <Badge variant={statusVariant(task.status)}>{statusLabel(task.status)}</Badge>
              </td>
              <td className="py-2 text-right font-mono text-xs">
                {task.attempts}
                /
                {task.maxAttempts}
              </td>
              <td className="py-2 text-xs text-muted-foreground">{formatDate(task.nextRunAt)}</td>
              <td className="py-2 text-right">
                <div className="flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isMutating}
                    onClick={(e) => {
                      e.stopPropagation()
                      onRequeue(task.id)
                    }}
                  >
                    <RotateCcw className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isMutating}
                    onClick={(e) => {
                      e.stopPropagation()
                      onCancel(task.id)
                    }}
                  >
                    <Ban className="size-3.5" />
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

// ── StatusList ──────────────────────────────────────────────

export function StatusList({ title, rows }: { title: string, rows: Array<{ status: string, count: number }> }) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-muted-foreground">{title}</p>
      {rows.length === 0
        ? <p className="text-xs text-muted-foreground">无</p>
        : (
            <div className="space-y-1">
              {rows.map(row => (
                <div key={row.status} className="flex items-center justify-between text-xs">
                  <Badge variant={statusVariant(row.status)}>{statusLabel(row.status)}</Badge>
                  <span className="font-mono">{row.count}</span>
                </div>
              ))}
            </div>
          )}
    </div>
  )
}

// ── StatCard ──────────────────────────────────────────────

export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string
  value: string | number
  sub?: string
  icon?: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        {Icon && <Icon className="size-3.5 text-muted-foreground" />}
      </div>
      <p className="mt-1 font-mono text-lg">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

// ── AdminTaskDetailDialog ────────────────────────────────────

export function AdminTaskDetailDialog({
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
  const runs = detail?.pipelineRuns ?? []
  const genRecords: AdminTaskGenerationRecord[] = detail?.generationRecords ?? []

  return (
    <Dialog open={!!taskId} onOpenChange={open => !open && onClose()}>
      {taskId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/80" onClick={onClose} />
          <div className="relative z-50 grid w-full max-w-3xl gap-4 overflow-hidden border bg-background p-6 shadow-lg rounded-xl max-h-[90vh] overflow-y-auto">
            {isLoading
              ? <p className="py-6 text-center text-sm text-muted-foreground">正在加载任务详情...</p>
              : isError
                ? <p className="py-6 text-center text-sm text-destructive">加载任务详情失败</p>
                : !task
                    ? <p className="py-6 text-center text-sm text-muted-foreground">任务不存在</p>
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
                              ? <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">该任务无关联 Canvas pipeline run（可能是 generate / gateway / subtitle 域任务）。</p>
                              : (
                                  <div className="space-y-2">
                                    {runs.map(run => (
                                      <div key={run.id} className="rounded-lg border p-3 text-sm">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          <div className="flex items-center gap-2">
                                            <Badge variant="outline">{run.phase}</Badge>
                                            <Badge variant={statusVariant(run.status)}>{statusLabel(run.status)}</Badge>
                                          </div>
                                          <span className="font-mono text-xs text-muted-foreground">{run.durationMs != null ? `${run.durationMs}ms` : '-'}</span>
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
                                        {run.errorMessage && <p className="mt-2 break-all text-xs text-destructive">{run.errorMessage}</p>}
                                        {run.outputSummary && Object.keys(run.outputSummary).length > 0 && (
                                          <details className="mt-2">
                                            <summary className="cursor-pointer text-xs text-muted-foreground">输出摘要</summary>
                                            <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs">{JSON.stringify(run.outputSummary, null, 2)}</pre>
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
                              ? <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">暂无关联生成记录。</p>
                              : (
                                  <div className="space-y-2">
                                    {genRecords.map(record => (
                                      <div key={record.id} className="rounded-lg border p-3 text-sm">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <Badge variant="outline" className="font-mono">{record.model}</Badge>
                                            <Badge variant={statusVariant(record.status)}>{statusLabel(record.status)}</Badge>
                                            <Badge variant={record.matchReason === 'time-window' ? 'outline' : 'secondary'}>{generationRecordMatchLabel(record.matchReason)}</Badge>
                                          </div>
                                          <span className="font-mono text-xs text-muted-foreground">{record.costCents !== null ? `¥${(record.costCents / 100).toFixed(2)}` : '—'}</span>
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
                                          <div className="font-mono">{shortId(record.id)}</div>
                                        </div>
                                        {record.errorMessage && <p className="mt-2 break-all text-xs text-destructive">{record.errorMessage}</p>}
                                      </div>
                                    ))}
                                    {genRecords.some(r => r.matchReason === 'time-window') && (
                                      <p className="text-xs text-muted-foreground">候选记录按 accountId + 任务执行时间窗口匹配，可能含并发产生的记录，请结合创建时间人工判断。</p>
                                    )}
                                  </div>
                                )}
                          </div>
                          <div className="flex items-center justify-end gap-2">
                            <Button size="sm" variant="outline" disabled={!task.canRequeue || isMutating} onClick={() => onRequeue(task.id)}>
                              <RotateCcw className="size-4" />
                              重排
                            </Button>
                            <Button size="sm" variant="outline" disabled={!task.canCancel || isMutating} onClick={() => onCancel(task.id)}>
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

// ── AdminUserApiKeysSection ─────────────────────────────────

export function AdminUserApiKeysSection({ userId }: { userId: string | null }) {
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
                          <Badge variant={key.scope === 'gateway' ? 'secondary' : 'outline'} className="text-[10px]">{key.scope === 'gateway' ? 'Gateway' : 'All'}</Badge>
                        </td>
                        <td className="py-1.5 text-xs text-muted-foreground">{key.rateLimitPerMinute ? `${key.rateLimitPerMinute}次/分` : '-'}</td>
                        <td className="py-1.5 text-xs text-muted-foreground">
                          {key.quotaMaxCents
                            ? (
                                <span>
                                  ¥
                                  {formatCents(key.totalSpendCents)}
                                  /¥
                                  {formatCents(key.quotaMaxCents)}
                                </span>
                              )
                            : '-'}
                        </td>
                        <td className="py-1.5">
                          <Badge variant={key.revokedAt ? 'outline' : 'default'}>{key.revokedAt ? '已撤销' : '启用'}</Badge>
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

// ── AdminUserDetailDialog ───────────────────────────────────

export function AdminUserDetailDialog({ userId, onClose }: { userId: string | null, onClose: () => void }) {
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
              ? <p className="py-6 text-center text-sm text-muted-foreground">正在加载用户详情...</p>
              : (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold">{detail.summary.username}</h3>
                        <p className="text-xs text-muted-foreground">{detail.summary.email ?? '-'}</p>
                      </div>
                      <Badge variant={detail.summary.isActive ? 'default' : 'outline'}>{detail.summary.isActive ? '启用' : '禁用'}</Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <div className="rounded-lg border p-3">
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-muted-foreground">余额</p>
                          <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => setRechargeOpen(true)}>
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
                        <p className="mt-1">{detail.summary.totalCalls}</p>
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
                                    <div className="h-full bg-primary/60" style={{ width: maxDailyCost === 0 ? '0%' : `${(row.costCents / maxDailyCost) * 100}%` }} />
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
                                    <td className="py-1.5 text-right">{row.calls}</td>
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
                                {detail.recentRecords.map((record: AdminUserRecentRecord) => (
                                  <tr key={record.id} className="border-b last:border-b-0">
                                    <td className="py-1.5 font-mono text-xs">{record.model}</td>
                                    <td className="py-1.5"><Badge variant={statusVariant(record.status)}>{statusLabel(record.status)}</Badge></td>
                                    <td className="py-1.5">
                                      <div className="flex flex-col gap-1">
                                        <Badge variant={record.executionKind === 'legacy-provider-task' ? 'outline' : 'secondary'} className="w-fit">{recentRecordExecutionLabel(record.executionKind)}</Badge>
                                        {record.providerTaskId && <span className="font-mono text-[11px] text-muted-foreground">{shortId(record.providerTaskId)}</span>}
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
                    <AdminUserApiKeysSection userId={userId} />
                    <div className="flex justify-end"><Button variant="outline" size="sm" onClick={onClose}>关闭</Button></div>
                  </>
                )}
          </div>
        </div>
      </Dialog>

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
                <Input type="number" min="0.01" step="0.01" placeholder="例如 10.00" value={rechargeAmount} onChange={e => setRechargeAmount(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">备注（可选）</label>
                <Input placeholder="管理后台充值" value={rechargeDesc} onChange={e => setRechargeDesc(e.target.value)} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setRechargeOpen(false)}>取消</Button>
                <Button size="sm" disabled={!rechargeAmount || Number.parseFloat(rechargeAmount) <= 0 || rechargeMutation.isPending} onClick={() => rechargeMutation.mutate()}>
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
