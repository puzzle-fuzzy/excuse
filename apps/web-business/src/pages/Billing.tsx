import type { BillingBalance, CreditTransactionDTO } from '@excuse/shared'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Calendar, CalendarDays, CreditCard, DollarSign, ReceiptText, RefreshCw, ShieldCheck, TrendingUp, Wallet } from 'lucide-react'
import { getBillingStatistics } from '@/api/billing'
import { fetchBillingBalance, fetchBillingTransactions } from '@/api/client'
import { billingQueryKeys } from '@/api/query-client'
import EmptyState from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { BILLING_CATEGORY_LABELS } from '@/lib/category-labels'
import { formatCents } from '@/lib/generation-utils'
import { CATEGORY_TOKENS, statusTextClass } from '@/lib/status-tokens'

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

const TX_TYPE_LABELS: Record<string, string> = {
  reserve: '冻结',
  debit: '扣款',
  refund: '退还',
  credit: '充值',
  admin_adjust: '管理员调整',
}

const TX_TYPE_TONES: Record<string, 'neutral' | 'success' | 'warning' | 'danger'> = {
  reserve: 'warning',
  debit: 'danger',
  refund: 'success',
  credit: 'success',
  admin_adjust: 'neutral',
}

function TxTypeIcon({ type }: { type: string }) {
  const iconClass = statusTextClass(TX_TYPE_TONES[type] ?? 'neutral')
  if (type === 'credit' || type === 'admin_adjust')
    return <ArrowDownLeft className={`size-4 ${iconClass}`} />
  if (type === 'refund')
    return <ArrowDownLeft className={`size-4 ${iconClass}`} />
  return <ArrowUpRight className={`size-4 ${iconClass}`} />
}

export default function Billing() {
  const { data: stats, isLoading: statsLoading, isError: statsError, refetch: refetchStats, isFetching: statsFetching } = useQuery({
    queryKey: billingQueryKeys.statistics,
    queryFn: () => getBillingStatistics(),
  })

  const { data: balance, isLoading: balanceLoading } = useQuery({
    queryKey: billingQueryKeys.balance,
    queryFn: fetchBillingBalance,
    refetchInterval: () => document.hidden ? false : 30_000,
  })

  const { data: txData, isLoading: txLoading, refetch: refetchTx, isFetching: txFetching } = useQuery({
    queryKey: billingQueryKeys.transactions(),
    queryFn: () => fetchBillingTransactions({ limit: 50 }),
  })

  const balanceData: BillingBalance | undefined = balance?.data
  const transactions: CreditTransactionDTO[] = txData?.items ?? []
  const lowBalance = !!balanceData && balanceData.availableCents < 500

  // 加载态 — 骨架屏
  if (statsLoading) {
    return (
      <div className="product-page flex flex-col gap-6">
        <div className="rounded-2xl border bg-card p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-xl" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-80 max-w-full" />
            </div>
          </div>
        </div>
        <Skeleton className="h-32 w-full rounded-xl" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
        <Skeleton className="h-44 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  // 错误态
  if (statsError || !stats) {
    return (
      <div className="product-page">
        <div className="mx-auto flex max-w-lg flex-col items-center rounded-xl border bg-card p-8 text-center">
          <span className="grid size-11 place-items-center rounded-xl bg-[color:var(--status-danger-bg)] text-[color:var(--status-danger-fg)]">
            <AlertTriangle className="size-5" />
          </span>
          <h1 className="mt-4 text-lg font-semibold">加载费用统计失败</h1>
          <p className="mt-2 text-sm text-muted-foreground">暂时无法读取账户成本和交易数据，请稍后重试。</p>
          <Button variant="outline" size="sm" className="mt-5" onClick={() => refetchStats()}>
            <RefreshCw className="size-3.5" />
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
    <div className="product-page flex flex-col gap-6">
      <section className="rounded-2xl border bg-card p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border bg-muted/45 px-3 py-1 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5 text-primary" />
              beta 阶段免费，成本仅作预估展示
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">费用统计</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              查看账户余额、冻结金额、模型消耗和交易流水。这里应该帮助你放心提交任务，而不是让预算状态藏在角落。
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refetchStats()
              refetchTx()
            }}
            disabled={statsFetching || txFetching}
          >
            <RefreshCw className={`size-3.5 ${statsFetching || txFetching ? 'animate-spin' : ''}`} />
            刷新数据
          </Button>
        </div>
      </section>

      {/* 余额卡片 */}
      <section className="rounded-xl border bg-card p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <Wallet className="size-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold">账户余额</h2>
              <p className="mt-1 text-sm text-muted-foreground">用于生成任务的可用额度和当前冻结金额。</p>
            </div>
          </div>
          {balanceLoading || !balanceData
            ? (
                <div className="space-y-2 lg:min-w-96">
                  <Skeleton className="h-9 w-32" />
                  <Skeleton className="h-4 w-20" />
                </div>
              )
            : (
                <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[520px]">
                  <div className="rounded-lg border bg-background p-3">
                    <p className="text-xs text-muted-foreground">可用余额</p>
                    <p className="mt-1 text-2xl font-semibold tracking-tight">
                      ¥
                      {formatCents(balanceData.availableCents)}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-background p-3">
                    <p className="text-xs text-muted-foreground">冻结金额</p>
                    <p className="mt-1 text-lg font-semibold">
                      ¥
                      {formatCents(balanceData.frozenCents)}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-background p-3">
                    <p className="text-xs text-muted-foreground">账户总计</p>
                    <p className="mt-1 text-lg font-semibold">
                      ¥
                      {formatCents(balanceData.totalCents)}
                    </p>
                  </div>
                </div>
              )}
        </div>
        {lowBalance && balanceData && (
          <div className="mt-4 rounded-lg border border-[color:var(--status-warning-border)] bg-[color:var(--status-warning-bg)] px-3 py-2 text-sm text-[color:var(--status-warning-fg)]">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <p>
                当前可用余额 ¥
                {formatCents(balanceData.availableCents)}
                ，提交视频或 Canvas 阶段前建议先确认预算。
              </p>
            </div>
          </div>
        )}
      </section>

      {/* 概览卡片 */}
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {overviewCards.map(({ label, valueCents, icon: Icon }) => (
          <Card key={label} className="bg-card">
            <CardContent className="flex items-center gap-3 p-4">
              <span className="grid size-9 place-items-center rounded-lg bg-muted text-muted-foreground">
                <Icon className="size-4" />
              </span>
              <div>
                <p className="text-xl font-semibold tracking-tight">
                  ¥
                  {formatCents(valueCents)}
                </p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 类别分布 */}
        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-sm">
              <span>类别分布</span>
              <span className="text-xs font-normal text-muted-foreground">按生成类型</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {stats.byCategory.length === 0
              ? (
                  <EmptyState title="暂无数据" />
                )
              : (
                  stats.byCategory.map(item => (
                    <div key={item.category} className="rounded-lg border bg-background p-3">
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
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full ${CATEGORY_TOKENS[item.category]?.bar ?? 'bg-muted-foreground'}`}
                          style={{ width: `${item.percentage}%` }}
                        />
                      </div>
                    </div>
                  ))
                )}
          </CardContent>
        </Card>

        {/* 模型分布 */}
        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-sm">
              <span>模型分布</span>
              <span className="text-xs font-normal text-muted-foreground">按模型消耗</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {stats.byModel.length === 0
              ? (
                  <EmptyState title="暂无数据" />
                )
              : (
                  stats.byModel.map(item => (
                    <div key={item.model} className="rounded-lg border bg-background p-3">
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
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
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
      <Card className="bg-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm">30 天趋势</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">观察近期成本是否集中在某几天，方便判断批量生成节奏。</p>
          </div>
          <CalendarDays className="size-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {stats.dailyTrend.every(d => d.totalCents === 0)
            ? (
                <EmptyState title="暂无数据" />
              )
            : (
                <div className="flex h-36 items-end gap-1 rounded-xl border bg-background p-3">
                  {stats.dailyTrend.map((item) => {
                    const maxCents = Math.max(...stats.dailyTrend.map(d => d.totalCents), 1)
                    const height = Math.max((item.totalCents / maxCents) * 100, 1)
                    return (
                      <div
                        key={item.date}
                        className="group relative flex-1 rounded-t bg-primary/20 transition-colors hover:bg-primary/45"
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
      <Card className="bg-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <CreditCard className="size-4 text-muted-foreground" />
              交易流水
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">查看每次冻结、扣款、退还和充值后的余额变化。</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => refetchTx()}
            title="刷新"
          >
            <RefreshCw className={`size-3.5 ${txFetching ? 'animate-spin' : ''}`} />
          </Button>
        </CardHeader>
        <CardContent>
          {txLoading
            ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }, (_, i) => (
                    <Skeleton key={i} className="h-16 w-full rounded-lg" />
                  ))}
                </div>
              )
            : transactions.length === 0
              ? (
                  <div className="rounded-xl border border-dashed bg-muted/25 p-8 text-center">
                    <ReceiptText className="mx-auto size-8 text-muted-foreground" />
                    <p className="mt-3 text-sm font-medium">暂无交易记录</p>
                    <p className="mt-1 text-xs text-muted-foreground">提交生成任务后，冻结和扣款记录会显示在这里。</p>
                  </div>
                )
              : (
                  <div className="space-y-2">
                    {transactions.map(tx => (
                      <div key={tx.id} className="flex items-center justify-between gap-4 rounded-lg border bg-background p-3 text-sm transition-colors hover:bg-muted/35">
                        <div className="flex items-center gap-3">
                          <span className="grid size-9 place-items-center rounded-lg bg-muted">
                            <TxTypeIcon type={tx.type} />
                          </span>
                          <div>
                            <p className={`font-medium ${statusTextClass(TX_TYPE_TONES[tx.type] ?? 'neutral')}`}>
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
                          <p className={`font-mono font-medium ${tx.type === 'credit' || tx.type === 'admin_adjust' || tx.type === 'refund' ? statusTextClass('success') : ''}`}>
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
