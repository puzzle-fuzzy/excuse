import type { BillingBalanceResponse, BillingStatisticsResponse, BillingTransactionsResponse } from '@excuse/shared'
import { api, unwrapEden } from './api-core'

// ===== 计费 API =====

export async function fetchBillingStatistics(): Promise<BillingStatisticsResponse> {
  return unwrapEden<BillingStatisticsResponse>(
    await api.api.billing.statistics.get(),
  )
}

export async function fetchBillingBalance(): Promise<BillingBalanceResponse> {
  return unwrapEden<BillingBalanceResponse>(
    await api.api.billing.balance.get(),
  )
}

export async function fetchBillingTransactions(params?: { limit?: number, offset?: number }): Promise<BillingTransactionsResponse> {
  return unwrapEden<BillingTransactionsResponse>(
    await api.api.billing.transactions.get({
      query: {
        limit: params?.limit,
        offset: params?.offset,
      },
    }),
  )
}
