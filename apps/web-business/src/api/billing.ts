import type { BillingStatistics } from '@excuse/shared'
import { fetchBillingStatistics } from '@/api/client'

export async function getBillingStatistics(): Promise<BillingStatistics> {
  const response = await fetchBillingStatistics()
  if (!response.success)
    throw new Error('加载费用统计失败')
  return response.data
}
