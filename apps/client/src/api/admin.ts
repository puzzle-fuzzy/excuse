import type {
  AdminApiKeyListResponse,
  AdminAuditLogListQuery,
  AdminAuditLogListResponse,
  AdminGatewayClientDetailResponse,
  AdminGatewayClientListQuery,
  AdminGatewayClientListResponse,
  AdminProjectListQuery,
  AdminProjectListResponse,
  AdminProviderStatsResponse,
  AdminTaskDetailResponse,
  AdminUserDetailResponse,
  AdminUserListQuery,
  AdminUserListResponse,
} from '@excuse/shared'
import { api, unwrapEden } from './client'

export type {
  AdminApiKeyItem,
  AdminGatewayClientDetail,
  AdminGatewayClientDetailResponse,
  AdminGatewayClientItem,
  AdminGatewayClientListQuery,
  AdminGatewayClientListResponse,
  AdminPipelineRun,
  AdminProviderStatsItem,
  AdminProviderStatsResponse,
  AdminTaskDetail,
  AdminTaskDetailResponse,
  AdminUserDetail,
  AdminUserDetailResponse,
  AdminUserListQuery,
  AdminUserListResponse,
  AdminUserSummary,
} from '@excuse/shared'

export async function fetchAdminUsers(params?: AdminUserListQuery): Promise<AdminUserListResponse> {
  return unwrapEden<AdminUserListResponse>(
    await api.api.admin.users.get({
      query: {
        search: params?.search,
        isActive: params?.isActive,
        limit: params?.limit,
        offset: params?.offset,
      },
    }),
  )
}

export async function fetchAdminUserDetail(accountId: string): Promise<AdminUserDetailResponse> {
  return unwrapEden<AdminUserDetailResponse>(
    await api.api.admin.users({ id: accountId }).get(),
  )
}

export async function fetchAdminTaskDetail(taskId: string): Promise<AdminTaskDetailResponse> {
  return unwrapEden<AdminTaskDetailResponse>(
    await api.api.admin.tasks({ id: taskId }).get(),
  )
}

export interface AdminProviderStatsQuery {
  windowHours?: number
}

export async function fetchAdminProviderStats(params?: AdminProviderStatsQuery): Promise<AdminProviderStatsResponse> {
  return unwrapEden<AdminProviderStatsResponse>(
    await api.api.admin.providers.get({
      query: {
        windowHours: params?.windowHours,
      },
    }),
  )
}

export const adminUsersQueryKeys = {
  list: (params: AdminUserListQuery) => ['admin', 'users', 'list', params] as const,
  detail: (accountId: string) => ['admin', 'users', 'detail', accountId] as const,
}

export const adminProvidersQueryKeys = {
  list: (windowHours: number) => ['admin', 'providers', windowHours] as const,
}

export const adminTasksQueryKeys = {
  detail: (taskId: string) => ['admin', 'tasks', 'detail', taskId] as const,
}

export async function fetchAdminProjects(params?: AdminProjectListQuery): Promise<AdminProjectListResponse> {
  return unwrapEden<AdminProjectListResponse>(
    await api.api.admin.projects.get({
      query: {
        search: params?.search,
        status: params?.status,
        isDeleted: params?.isDeleted,
        limit: params?.limit,
        offset: params?.offset,
      },
    }),
  )
}

export const adminProjectsQueryKeys = {
  list: (params: AdminProjectListQuery) => ['admin', 'projects', params] as const,
}

export async function fetchAdminAuditLogs(params?: AdminAuditLogListQuery): Promise<AdminAuditLogListResponse> {
  return unwrapEden<AdminAuditLogListResponse>(
    await api.api.admin['audit-logs'].get({
      query: {
        accountId: params?.accountId,
        action: params?.action,
        from: params?.from,
        to: params?.to,
        limit: params?.limit,
        offset: params?.offset,
      },
    }),
  )
}

export const adminAuditLogQueryKeys = {
  list: (params: AdminAuditLogListQuery) => ['admin', 'audit-logs', params] as const,
}

export async function fetchAdminUserApiKeys(accountId: string): Promise<AdminApiKeyListResponse> {
  return unwrapEden<AdminApiKeyListResponse>(
    await api.api.admin.users({ id: accountId })['api-keys'].get(),
  )
}

export const adminUserApiKeysQueryKeys = {
  list: (accountId: string) => ['admin', 'users', accountId, 'api-keys'] as const,
}

export async function fetchAdminUpdateApiKeyConfig(params: {
  id: string
  userId: string
  scope?: string
  rateLimitPerMinute?: number | null
  quotaMaxCents?: number | null
}): Promise<void> {
  unwrapEden<{ success: true }>(await api.api.admin['api-keys']({ id: params.id }).config.patch({
    userId: params.userId,
    scope: params.scope,
    rateLimitPerMinute: params.rateLimitPerMinute,
    quotaMaxCents: params.quotaMaxCents,
  }))
}

export async function fetchAdminGatewayClients(params?: AdminGatewayClientListQuery): Promise<AdminGatewayClientListResponse> {
  return unwrapEden<AdminGatewayClientListResponse>(
    await api.api.admin['gateway-clients'].get({
      query: {
        search: params?.search,
        limit: params?.limit,
        offset: params?.offset,
      },
    }),
  )
}

export async function fetchAdminGatewayClientDetail(accountId: string): Promise<AdminGatewayClientDetailResponse> {
  return unwrapEden<AdminGatewayClientDetailResponse>(
    await api.api.admin['gateway-clients']({ accountId }).get(),
  )
}

export async function resetApiKeyQuota(id: string): Promise<void> {
  unwrapEden<{ success: true }>(await api.api.admin['api-keys']({ id })['reset-quota'].post())
}

export async function revokeApiKeyAdmin(id: string): Promise<void> {
  unwrapEden<{ success: true }>(await api.api.admin['api-keys']({ id }).revoke.post())
}

export async function adminCreditAdd(params: { accountId: string, amountCents: number, description?: string }): Promise<{ success: true }> {
  return unwrapEden<{ success: true }>(await api.api.admin.credit.add.post({
    accountId: params.accountId,
    amountCents: params.amountCents,
    description: params.description,
  }))
}

export const adminGatewayClientsQueryKeys = {
  list: (params: AdminGatewayClientListQuery) => ['admin', 'gateway-clients', 'list', params] as const,
  detail: (accountId: string) => ['admin', 'gateway-clients', 'detail', accountId] as const,
}
