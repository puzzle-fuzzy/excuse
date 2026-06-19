/**
 * Admin Provider 统计 Tab
 */
import type { AdminProviderStatsItem } from '@excuse/shared'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { fetchAdminProviderStats } from '@/api/admin'
import { adminQueryKeys } from '@/api/query-client'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatLatencyMs, formatNumber, formatPercent } from '@/lib/admin-format'
import { formatCents } from '@/lib/generation-utils'
import { PROVIDER_CATEGORY_LABELS, PROVIDER_WINDOW_OPTIONS } from './shared'

export function AdminProvidersTab() {
  const [windowHours, setWindowHours] = useState(24)

  const { data, isLoading, isFetching } = useQuery({
    queryKey: adminQueryKeys.providers(windowHours),
    queryFn: () => fetchAdminProviderStats({ windowHours }),
    refetchInterval: () => document.hidden ? false : 30_000,
  })

  const items: AdminProviderStatsItem[] = data?.items ?? []

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm">Provider 错误率与模型成本</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              count / cost / tokens 来自 generation_records 聚合；avg / p50 / p95 延迟聚合 server + worker 进程内 metrics。
            </p>
          </div>
          <Select value={String(windowHours)} onValueChange={v => setWindowHours(Number(v))}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PROVIDER_WINDOW_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading
          ? <p className="py-8 text-center text-sm text-muted-foreground">正在读取 provider 统计...</p>
          : items.length === 0
            ? <p className="py-8 text-center text-sm text-muted-foreground">该窗口内暂无生成记录</p>
            : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-275 text-sm">
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
                          <td className="py-2"><Badge variant="outline">{PROVIDER_CATEGORY_LABELS[item.category] ?? item.category}</Badge></td>
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
