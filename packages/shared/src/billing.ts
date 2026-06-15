import type { EntityResponse, ListResponse } from './api-response'

// ===== 计费相关类型定义 =====

export interface BillingStatistics {
  totalCents: number
  total: number // 向后兼容
  todayCents: number
  today: number // 向后兼容
  weekCents: number
  week: number // 向后兼容
  monthCents: number
  month: number // 向后兼容
  /** 失败/取消任务的成本汇总（审计用，不计入账单） */
  auditFailedCents: number
  byCategory: CategoryBreakdown[]
  byModel: ModelBreakdown[]
  dailyTrend: DailyTrendItem[]
}

export interface CategoryBreakdown {
  category: string
  totalCents: number
  total: number // 向后兼容
  percentage: number
}

export interface ModelBreakdown {
  model: string
  totalCents: number
  total: number // 向后兼容
  percentage: number
}

export interface DailyTrendItem {
  date: string
  totalCents: number
  total: number // 向后兼容
}

export interface BillingBalance {
  availableCents: number
  frozenCents: number
  totalCents: number
}

export type CreditTransactionType = 'reserve' | 'debit' | 'refund' | 'credit' | 'admin_adjust'

export interface CreditTransactionDTO {
  id: string
  accountId: string
  type: CreditTransactionType
  amountCents: number
  balanceAfterCents: number
  frozenAfterCents: number
  generationRecordId: string | null
  description: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
}

export type BillingStatisticsResponse = EntityResponse<BillingStatistics>

export type BillingBalanceResponse = EntityResponse<BillingBalance>

export type BillingTransactionsResponse = ListResponse<CreditTransactionDTO>
