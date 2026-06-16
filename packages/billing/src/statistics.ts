import type { BillingStatistics, CategoryBreakdown, CostDetail, DailyTrendItem, ModelBreakdown } from '@excuse/shared'
import currency from 'currency.js'
import { centsToYuan } from './utils'

export interface CostRecord {
  model: string
  category: string
  status: string
  cost: CostDetail | null
  createdAt: string | Date
}

/**
 * 从生成记录列表中聚合统计计费数据（整数分计费）
 *
 * 只汇总 billable 记录（cost.billable !== false），
 * 非 billable 记录（失败/取消）单独计入 auditFailedCents
 */
export function aggregateStatistics(records: CostRecord[]): BillingStatistics {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const weekStart = new Date(todayStart)
  weekStart.setDate(weekStart.getDate() - 7)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  let totalCents = 0
  let todayCents = 0
  let weekCents = 0
  let monthCents = 0
  let auditFailedCents = 0

  const categoryMap = new Map<string, number>()
  const modelMap = new Map<string, number>()
  const dailyMap = new Map<string, number>()

  for (const record of records) {
    const priceCents = record.cost?.totalPriceCents ?? 0
    const isBillable = record.cost?.billable !== false

    // 非 billable 的记录单独计入审计项
    if (!isBillable) {
      auditFailedCents = currency(auditFailedCents).add(priceCents).value
      continue
    }

    totalCents = currency(totalCents).add(priceCents).value

    const recordDate = new Date(record.createdAt)
    if (recordDate >= todayStart) {
      todayCents = currency(todayCents).add(priceCents).value
    }
    if (recordDate >= weekStart) {
      weekCents = currency(weekCents).add(priceCents).value
    }
    if (recordDate >= monthStart) {
      monthCents = currency(monthCents).add(priceCents).value
    }

    const categoryTotal = categoryMap.get(record.category) || 0
    categoryMap.set(record.category, currency(categoryTotal).add(priceCents).value)

    const modelTotal = modelMap.get(record.model) || 0
    modelMap.set(record.model, currency(modelTotal).add(priceCents).value)

    const dayKey = `${recordDate.getFullYear()}-${String(recordDate.getMonth() + 1).padStart(2, '0')}-${String(recordDate.getDate()).padStart(2, '0')}`
    const dayTotal = dailyMap.get(dayKey) || 0
    dailyMap.set(dayKey, currency(dayTotal).add(priceCents).value)
  }

  const byCategory: CategoryBreakdown[] = Array.from(categoryMap.entries())
    .map(([category, catCents]) => ({
      category,
      totalCents: catCents,
      total: centsToYuan(catCents),
      percentage: totalCents > 0 ? Math.round((currency(catCents).divide(totalCents).value) * 100) : 0,
    }))
    .sort((a, b) => b.totalCents - a.totalCents)

  const byModel: ModelBreakdown[] = Array.from(modelMap.entries())
    .map(([model, modelCents]) => ({
      model,
      totalCents: modelCents,
      total: centsToYuan(modelCents),
      percentage: totalCents > 0 ? Math.round((currency(modelCents).divide(totalCents).value) * 100) : 0,
    }))
    .sort((a, b) => b.totalCents - a.totalCents)

  const dailyTrend: DailyTrendItem[] = []
  for (let i = 29; i >= 0; i--) {
    const date = new Date(todayStart)
    date.setDate(date.getDate() - i)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const dayCents = dailyMap.get(key) || 0
    dailyTrend.push({
      date: key,
      totalCents: dayCents,
      total: centsToYuan(dayCents),
    })
  }

  return {
    totalCents,
    total: centsToYuan(totalCents),
    todayCents,
    today: centsToYuan(todayCents),
    weekCents,
    week: centsToYuan(weekCents),
    monthCents,
    month: centsToYuan(monthCents),
    auditFailedCents,
    byCategory,
    byModel,
    dailyTrend,
  }
}
