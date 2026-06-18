import type { AdminApiKeyListResponse, AdminUserDetailResponse, AdminUserListResponse } from '@excuse/shared'
import { getAdminUserDetail, listAdminApiKeysByAccount, listAdminUsers } from '@excuse/db'
import { NotFoundError } from '../../utils/app-errors'
import { serializeApiKey } from './helpers'

export async function handleListUsers(query: {
  search?: string
  isActive?: boolean
  limit?: number
  offset?: number
}): Promise<AdminUserListResponse> {
  const result = await listAdminUsers({
    search: query.search,
    isActive: query.isActive,
    limit: query.limit,
    offset: query.offset,
  })
  return { success: true, items: result.items, total: result.total }
}

export async function handleGetUserDetail(id: string): Promise<AdminUserDetailResponse> {
  const detail = await getAdminUserDetail(id)
  if (!detail)
    throw new NotFoundError('用户不存在')
  return { success: true, data: detail }
}

export async function handleListUserApiKeys(accountId: string): Promise<AdminApiKeyListResponse> {
  const keys = await listAdminApiKeysByAccount(accountId)
  return { success: true, items: keys.map(serializeApiKey) }
}
