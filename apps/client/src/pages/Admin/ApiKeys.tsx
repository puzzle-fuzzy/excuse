/**
 * Admin Gateway / API Key 管理 Tab — 客户列表 + Key 管理对话框
 */
import type { AdminApiKeyItem, AdminGatewayClientDetail, AdminGatewayClientItem } from '@excuse/shared'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, KeyRound, Pencil, RotateCcw, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useDebounce } from 'use-debounce'
import {
  adminGatewayClientsQueryKeys,
  fetchAdminGatewayClientDetail,
  fetchAdminGatewayClients,
  fetchAdminUpdateApiKeyConfig,
  resetApiKeyQuota,
  revokeApiKeyAdmin,
} from '@/api/admin'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatNumber } from '@/lib/admin-format'
import { formatCents } from '@/lib/generation-utils'
import {
  formatDate,
  statusLabel,
  statusVariant,
  USERS_PAGE_SIZE,
} from './shared'

const KEY_SCOPE_OPTIONS = [
  { value: 'all', label: '完全访问' },
  { value: 'gateway', label: '仅 Gateway' },
]

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
      <DialogContent className="max-w-md" showCloseButton>
        <form onSubmit={handleSubmit}>
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
      </DialogContent>
    </Dialog>
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
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto" showCloseButton>
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
        </DialogContent>
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

export function AdminGatewayClientsTab() {
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
    refetchInterval: () => document.hidden ? false : 30_000,
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
