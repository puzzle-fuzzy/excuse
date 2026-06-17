/**
 * Admin 审计日志 Tab
 */
import type { AdminAuditLogItem } from '@excuse/shared'
import { useQuery } from '@tanstack/react-query'
import { FileText, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { adminAuditLogQueryKeys, fetchAdminAuditLogs } from '@/api/admin'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatDate, shortId } from './shared'

const AUDIT_ACTION_LABELS: Record<string, string> = {
  login: '登录',
  register: '注册',
  generate: '生成',
  file_delete: '删除文件',
  file_update: '更新文件',
  billing_transaction: '计费交易',
  api_key_create: '创建 API Key',
  api_key_revoke: '撤销 API Key',
  admin_action: '管理员操作',
  canvas_project_create: '创建项目',
  canvas_project_delete: '删除项目',
  canvas_phase_run: '运行阶段',
  canvas_cancel: '取消操作',
  canvas_asset_regenerate: '重新生成资产',
  canvas_apply_reference_assets: '应用参考资产',
  asset_hide: '隐藏资产',
  gateway_call: 'Gateway 调用',
  generation_retry: '重试生成',
  generation_cancel: '取消生成',
  credit_reserve: '预留额度',
  credit_debit: '扣费',
  credit_refund: '退款',
}

function auditActionLabel(action: string) {
  return AUDIT_ACTION_LABELS[action] ?? action
}

export function AdminAuditLogsTab() {
  const [actionFilter, setActionFilter] = useState('all')
  const [accountSearch, setAccountSearch] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [page, setPage] = useState(0)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const PAGE_SIZE = 50

  const queryParams = useMemo(() => ({
    action: actionFilter === 'all' ? undefined : actionFilter,
    accountId: accountSearch.trim() || undefined,
    from: fromDate || undefined,
    to: toDate || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  }), [actionFilter, accountSearch, fromDate, toDate, page])

  const { data, isLoading } = useQuery({
    queryKey: adminAuditLogQueryKeys.list(queryParams),
    queryFn: () => fetchAdminAuditLogs(queryParams),
    refetchInterval: 30_000,
  })

  const items: AdminAuditLogItem[] = data?.items ?? []
  const total = data?.total ?? 0

  const AUDIT_ACTION_OPTIONS = [
    { label: '全部操作', value: 'all' },
    ...Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => ({ label, value })),
  ]

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">审计日志</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">仅展示关键操作的审计记录，数据保留 365 天。</p>
      </CardHeader>
      <CardContent>
        <div className="mb-3 grid gap-2 md:grid-cols-[200px_200px_180px_180px]">
          <Select
            value={actionFilter}
            onValueChange={(v) => {
              setActionFilter(v)
              setPage(0)
            }}
          >
            <SelectTrigger><SelectValue placeholder="全部操作" /></SelectTrigger>
            <SelectContent>
              {AUDIT_ACTION_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-2 size-4 text-muted-foreground" />
            <Input
              value={accountSearch}
              onChange={(e) => {
                setAccountSearch(e.target.value)
                setPage(0)
              }}
              className="pl-8"
              placeholder="搜索用户 ID"
            />
          </div>
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value)
              setPage(0)
            }}
            aria-label="开始日期"
          />
          <Input
            type="date"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value)
              setPage(0)
            }}
            aria-label="结束日期"
          />
        </div>

        {isLoading
          ? <p className="py-8 text-center text-sm text-muted-foreground">正在读取审计日志...</p>
          : items.length === 0
            ? <p className="py-8 text-center text-sm text-muted-foreground">没有匹配的审计记录</p>
            : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-250 text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 font-medium">时间</th>
                        <th className="py-2 font-medium">用户</th>
                        <th className="py-2 font-medium">操作</th>
                        <th className="py-2 font-medium">对象</th>
                        <th className="py-2 font-medium">IP</th>
                        <th className="py-2 font-medium">详情</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(item => (
                        <tr key={item.id} className="border-b last:border-b-0">
                          <td className="py-2 text-xs text-muted-foreground whitespace-nowrap">{formatDate(item.createdAt)}</td>
                          <td className="py-2"><span className="font-mono text-xs" title={item.accountId ?? undefined}>{shortId(item.accountId)}</span></td>
                          <td className="py-2"><Badge variant="outline">{auditActionLabel(item.action)}</Badge></td>
                          <td className="py-2"><span className="font-mono text-xs text-muted-foreground">{shortId(item.targetId)}</span></td>
                          <td className="py-2 text-xs text-muted-foreground">{item.ip || '-'}</td>
                          <td className="py-2">
                            {item.detail && Object.keys(item.detail).length > 0
                              ? (
                                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}>
                                    <FileText className="size-3.5 mr-1" />
                                    {expandedId === item.id ? '收起' : '查看'}
                                  </Button>
                                )
                              : <span className="text-xs text-muted-foreground">-</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {items.map(item =>
                    expandedId === item.id && item.detail && Object.keys(item.detail).length > 0
                      ? (
                          <div key={`detail-${item.id}`} className="border-b bg-muted/20 px-4 py-3">
                            <pre className="overflow-x-auto text-xs whitespace-pre-wrap break-all">{JSON.stringify(item.detail, null, 2)}</pre>
                          </div>
                        )
                      : null,
                  )}
                </div>
              )}

        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            第
            {total === 0 ? 0 : page * PAGE_SIZE + 1}
            {' '}
            -
            {Math.min((page + 1) * PAGE_SIZE, total)}
            {' '}
            条 / 共
            {total}
            {' '}
            条
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>上一页</Button>
            <Button variant="outline" size="sm" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage(p => p + 1)}>下一页</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
