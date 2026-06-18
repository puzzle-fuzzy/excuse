import type { AdminGatewayClientDetailResponse, AdminGatewayClientListResponse } from '@excuse/shared'
import { getAdminGatewayClientDetail, listAdminGatewayClients } from '@excuse/db'
import { NotFoundError } from '../../utils/app-errors'
import { serializeApiKey } from './helpers'

export async function handleListGatewayClients(query: {
  search?: string
  limit?: number
  offset?: number
}): Promise<AdminGatewayClientListResponse> {
  const result = await listAdminGatewayClients({ search: query.search, limit: query.limit, offset: query.offset })
  return { success: true, items: result.items, total: result.total }
}

export async function handleGetGatewayClientDetail(accountId: string): Promise<AdminGatewayClientDetailResponse> {
  const detail = await getAdminGatewayClientDetail(accountId)
  if (!detail)
    throw new NotFoundError('Gateway 客户不存在')
  return {
    success: true,
    data: { summary: detail.summary, keys: detail.keys.map(serializeApiKey), recentGatewayRecords: detail.recentGatewayRecords },
  }
}
