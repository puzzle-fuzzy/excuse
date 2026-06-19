/**
 * Admin 用户管理 Tab — 用户列表 + 详情对话框
 */
import type { AdminApiKeyItem, AdminUserDetail } from '@excuse/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Coins, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useDebounce } from 'use-debounce'
import { adminCreditAdd, adminUserApiKeysQueryKeys, fetchAdminUserApiKeys, fetchAdminUserDetail, fetchAdminUsers } from '@/api/admin'
import { adminQueryKeys } from '@/api/query-client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatNumber } from '@/lib/admin-format'
import { formatCents } from '@/lib/generation-utils'
import {
  AdminPaginationFooter,
  ApiKeyTable,
  formatDate,
  recentRecordExecutionLabel,
  shortId,
  statusLabel,
  statusVariant,
  USER_STATUS_OPTIONS,
  USERS_PAGE_SIZE,
} from './shared'

function AdminUserDetailDialog({ userId, onClose }: { userId: string | null, onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: adminQueryKeys.users.detail(userId!),
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
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.users.detail(userId!) })
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.users.list })
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
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto" showCloseButton>
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

                  <AdminUserApiKeysSection userId={userId} />

                  <div className="flex justify-end">
                    <Button variant="outline" size="sm" onClick={onClose}>关闭</Button>
                  </div>
                </>
              )}
        </DialogContent>
      </Dialog>

      <Dialog open={rechargeOpen} onOpenChange={setRechargeOpen}>
        <DialogContent className="max-w-sm" showCloseButton>
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
        </DialogContent>
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
        : (
            <ApiKeyTable
              keys={keys}
              showName
              showCreatedAt
            />
          )}
    </div>
  )
}

export function AdminUsersTab() {
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
    queryKey: adminQueryKeys.users.listWithParams(queryParams),
    queryFn: () => fetchAdminUsers(queryParams),
    refetchInterval: () => document.hidden ? false : 30_000,
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

          <AdminPaginationFooter
            page={page}
            pageSize={USERS_PAGE_SIZE}
            total={total}
            isFetching={isFetching}
            onPageChange={setPage}
          />
        </CardContent>
      </Card>

      <AdminUserDetailDialog userId={selectedUserId} onClose={() => setSelectedUserId(null)} />
    </div>
  )
}
