import type { AdminOverviewResponse } from '@excuse/shared'
import { getAdminOverview } from '@excuse/db'

export async function handleGetOverview(): Promise<AdminOverviewResponse> {
  const overview = await getAdminOverview()
  return { success: true, data: overview }
}
