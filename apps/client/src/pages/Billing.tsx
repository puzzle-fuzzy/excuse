import type { BillingBalance, CreditTransactionDTO } from '@excuse/shared'
import { useQuery } from '@tanstack/react-query'
import { ArrowDownLeft, ArrowUpRight, Calendar, CalendarDays, DollarSign, RefreshCw, TrendingUp, Wallet } from 'lucide-react'
import { getBillingStatistics } from '@/api/billing'
import { fetchBillingBalance, fetchBillingTransactions } from '@/api/client'
import { billingQueryKeys } from '@/api/query-client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BILLING_CATEGORY_LABELS } from '@/lib/category-labels'
import { formatCents } from '@/lib/generation-utils'

const CATEGORY_LABELS = BILLING_CATEGORY_LABELS

function formatDate(value: string | null) {
  if (!value)
    return '-'
  try {
    const d = new Date(value)
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hours = String(d.getHours()).padStart(2, '0')
    const minutes = String(d.getMinutes()).padStart(2, '0')
    return `${month}-${day} ${hours}:${minutes}`
  }
  catch {
    return value
  }
}

const CATEGORY_COLORS: Record<string, string> = {
  text: 'bg-blue-500',
  image: 'bg-purple-500',
  video: 'bg-pink-500',
  audio: 'bg-green-500',
}

const TX_TYPE_LABELS: Record<string, string> = {
  reserve: '冻结',
  debit: '扣款',
  refund: '退还',
  credit: '充值',
  admin_adjust: '管理员调整',
}

const TX_TYPE_COLORS: Record<string, string> = {
  reserve: 'text-amber-500',
  debit: 'text-red-500',
  refund: 'text-green-500',
  credit: 'text-emerald-500',
  admin_adjust: 'text-gray-500',
}

function TxTypeIcon({ type }: { type: string }) {
  if (type === 'credit' || type === 'admin_adjust')
    return <ArrowDownLeft className="size-4 text-emerald-500" />
  if (type === 'refund')
    return <ArrowDownLeft className="size-4 text-green-500" />
  return <ArrowUpRight className="size-4 text-red-500" />
}

export default function Billing() {
  const { data: stats, isLoading: statsLoading, isError: statsError, refetch: refetchStats, isFetching: statsFetching } = useQuery({
    queryKey: billingQueryKeys.statistics,
    queryFn: () => getBillingStatistics(),
  })

  const { data: balance, isLoading: balanceLoading } = useQuery({
    queryKey: ['billing', 'balance'],
    queryFn: fetchBillingBalance,
    refetchInterval: 30_000,
  })

  const { data: txData, isLoading: txLoading } = useQuery({
    queryKey: ['billing', 'transactions'],
    queryFn: () => fetchBillingTransactions({ limit: 50 }),
  })

  const balanceData: BillingBalance | undefined = balance?.data
  const transactions: CreditTransactionDTO[] = txData?.items ?? []

  // 加载态
  if (statsLoading) {
    return (
      <div className="mx-auto max-w-7xl p-4">
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          加载中...
        </div>
      </div>
    )
  }

  // 错误态
  if (statsError || !stats) {
    return (
      <div className="mx-auto max-w-7xl p-4">
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <DollarSign className="mb-2 size-10" />
          <p>加载费用统计失败</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => refetchStats()}>
            <RefreshCw className="size-3" />
            重试
          </Button>
        </div>
      </div>
    )
  }

  const overviewCards = [
    { label: '总额', valueCents: stats.totalCents, icon: DollarSign },
    { label: '今日', valueCents: stats.todayCents, icon: TrendingUp },
    { label: '本周', valueCents: stats.weekCents, icon: CalendarDays },
    { label: '本月', valueCents: stats.monthCents, icon: Calendar },
  ]

  return (
    <div className="mx-auto max-w-7xl p-4 space-y-6">
      {/* 标题 + 刷新 */}
      <div className="flex items-center gap-2">
        <DollarSign className="size-5" />
        <h1 className="text-lg font-semibold">费用统计</h1>
        <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">beta 阶段免费</span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-7"
          onClick={() => {
            refetchStats()
          }}
          disabled={statsFetching}
          title="刷新"
        >
          <RefreshCw className={`size-3.5 ${statsFetching ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* 余额卡片 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Wallet className="size-4" />
            账户余额
          </CardTitle>
        </CardHeader>
        <CardContent>
          {balanceLoading || !balanceData
            ? (
                <p className="text-sm text-muted-foreground">加载中...</p>
              )
            : (
                <div className="flex items-baseline gap-6">
                  <div>
                    <p className="text-3xl font-bold">
                      ¥
                      {formatCents(balanceData.availableCents)}
                    </p>
                    <p className="text-xs text-muted-foreground">可用余额</p>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    <p>
                      冻结：
                      ¥
                      {formatCents(balanceData.frozenCents)}
                    </p>
                    <p>
                      总计：
                      ¥
                      {formatCents(balanceData.totalCents)}
                    </p>
                  </div>
                </div>
              )}
        </CardContent>
      </Card>

      {/* 概览卡片 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {overviewCards.map(({ label, valueCents, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="flex items-center gap-3 p-4">
              <Icon className="size-5 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">
                  ¥
                  {formatCents(valueCents)}
                </p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 类别分布 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">类别分布</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {stats.byCategory.length === 0
              ? (
                  <p className="text-sm text-muted-foreground">暂无数据</p>
                )
              : (
                  stats.byCategory.map(item => (
                    <div key={item.category} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span>{CATEGORY_LABELS[item.category] || item.category}</span>
                        <span className="text-muted-foreground">
                          ¥
                          {formatCents(item.totalCents, 4)}
                          {' '}
                          (
                          {item.percentage}
                          %)
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full ${CATEGORY_COLORS[item.category] || 'bg-gray-500'}`}
                          style={{ width: `${item.percentage}%` }}
                        />
                      </div>
                    </div>
                  ))
                )}
          </CardContent>
        </Card>

        {/* 模型分布 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">模型分布</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {stats.byModel.length === 0
              ? (
                  <p className="text-sm text-muted-foreground">暂无数据</p>
                )
              : (
                  stats.byModel.map(item => (
                    <div key={item.model} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="truncate">{item.model}</span>
                        <span className="text-muted-foreground">
                          ¥
                          {formatCents(item.totalCents, 4)}
                          {' '}
                          (
                          {item.percentage}
                          %)
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${item.percentage}%` }}
                        />
                      </div>
                    </div>
                  ))
                )}
          </CardContent>
        </Card>
      </div>

      {/* 30天趋势 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">30 天趋势</CardTitle>
        </CardHeader>
        <CardContent>
          {stats.dailyTrend.every(d => d.totalCents === 0)
            ? (
                <p className="text-sm text-muted-foreground">暂无数据</p>
              )
            : (
                <div className="flex items-end gap-1 h-32">
                  {stats.dailyTrend.map((item) => {
                    const maxCents = Math.max(...stats.dailyTrend.map(d => d.totalCents), 1)
                    const height = Math.max((item.totalCents / maxCents) * 100, 1)
                    return (
                      <div
                        key={item.date}
                        className="group relative flex-1 rounded-t bg-primary/20 hover:bg-primary/40 transition-colors"
                        style={{ height: `${height}%` }}
                        title={`${item.date}: ¥${formatCents(item.totalCents, 4)}`}
                      >
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 hidden group-hover:block whitespace-nowrap rounded bg-black/80 px-1.5 py-0.5 text-[10px] text-white">
                          ¥
                          {formatCents(item.totalCents)}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
        </CardContent>
      </Card>

      {/* 交易流水 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm">交易流水</CardTitle>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => {
              // invalidate and refetch
            }}
            title="刷新"
          >
            <RefreshCw className={`size-3.5 ${txLoading ? 'animate-spin' : ''}`} />
          </Button>
        </CardHeader>
        <CardContent>
          {txLoading
            ? (
                <p className="text-sm text-muted-foreground">加载中...</p>
              )
            : transactions.length === 0
              ? (
                  <p className="text-sm text-muted-foreground">暂无交易记录</p>
                )
              : (
                  <div className="space-y-2">
                    {transactions.map(tx => (
                      <div key={tx.id} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                        <div className="flex items-center gap-3">
                          <TxTypeIcon type={tx.type} />
                          <div>
                            <p className={`font-medium ${TX_TYPE_COLORS[tx.type] || ''}`}>
                              {TX_TYPE_LABELS[tx.type] || tx.type}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {tx.description ?? '-'}
                              {' · '}
                              {formatDate(tx.createdAt)}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`font-mono font-medium ${tx.type === 'credit' || tx.type === 'admin_adjust' || tx.type === 'refund' ? 'text-green-600' : ''}`}>
                            {tx.type === 'credit' || tx.type === 'admin_adjust' || tx.type === 'refund' ? '+' : '-'}
                            ¥
                            {formatCents(tx.amountCents)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            余额 ¥
                            {formatCents(tx.balanceAfterCents)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
        </CardContent>
      </Card>
    </div>
  )
}
