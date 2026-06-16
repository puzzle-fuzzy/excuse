import type { BillingBalanceResponse, BillingStatisticsResponse, BillingTransactionsResponse } from '@excuse/shared'
import type { ServerConfig } from '../config'
import { aggregateStatistics } from '@excuse/billing'
import { getCostRecords, getOrCreateCreditAccount, listCreditTransactions, serialize } from '@excuse/db'
import { Elysia, t } from 'elysia'
import { createRequireAuthPlugin } from '../plugins/auth'

/**
 * 费用统计与信用账户路由
 *
 * GET /api/billing/statistics  — 生成任务费用聚合
 * GET /api/billing/balance     — 信用账户余额（可用 + 冻结）
 * GET /api/billing/transactions — 交易流水
 */
export function createBillingRoutes(config: ServerConfig) {
  return new Elysia({ prefix: '/api/billing' })
    .use(createRequireAuthPlugin(config))
    .get('/statistics', async ({ userId }) => {
      const now = new Date()
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      from.setDate(from.getDate() - 29)
      const costRecords = await getCostRecords(userId, { from, to: now })
      const stats = aggregateStatistics(costRecords)
      return {
        success: true,
        data: stats,
      } satisfies BillingStatisticsResponse
    }, {
      detail: {
        summary: '获取费用统计',
        description: '返回当前用户所有生成任务的累计费用聚合数据，按模型和类别分组',
        tags: ['计费'],
        security: [{ bearerAuth: [] }],
      },
    })
    .get('/balance', async ({ userId }) => {
      const account = await getOrCreateCreditAccount(userId)
      return {
        success: true,
        data: {
          availableCents: account.availableCents,
          frozenCents: account.frozenCents,
          totalCents: account.availableCents + account.frozenCents,
        },
      } satisfies BillingBalanceResponse
    }, {
      detail: {
        summary: '获取信用账户余额',
        description: '返回可用余额、冻结金额和总余额（整数分）',
        tags: ['计费'],
        security: [{ bearerAuth: [] }],
      },
    })
    .get('/transactions', async ({ userId, query }) => {
      const limit = query.limit ?? 50
      const offset = query.offset ?? 0
      const transactions = await listCreditTransactions({ accountId: userId, limit, offset })
      return {
        success: true,
        items: transactions.map(serialize),
        total: transactions.length,
      } satisfies BillingTransactionsResponse
    }, {
      query: t.Object({
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
      }),
      detail: {
        summary: '获取交易流水',
        description: '查询当前用户的信用交易记录（预留/扣款/退还/充值），按时间倒序',
        tags: ['计费'],
        security: [{ bearerAuth: [] }],
      },
    })
}
