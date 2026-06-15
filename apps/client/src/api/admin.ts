import type {
  AdminApiKeyListResponse,
  AdminAuditLogListQuery,
  AdminAuditLogListResponse,
  AdminProjectListQuery,
  AdminProjectListResponse,
  AdminProviderStatsResponse,
  AdminTaskDetailResponse,
  AdminUserDetailResponse,
  AdminUserListQuery,
  AdminUserListResponse,
} from '@excuse/shared'
import { api } from './client'

export type {
  AdminApiKeyItem,
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

/**
 * Eden 返回值最小 unwrap —— 与 `client.ts` 的 `unwrapEden` 语义一致但不依赖其 export。
 *
 * 拆分到本文件便于 admin-page.test 中独立 mock（mock 本模块的 4 个 fetch 函数即可，
 * 不需要 mock 整个 client.ts）。
 */
function unwrap<T>(response: { data: unknown, error: unknown }): T {
  if (response.error) {
    const edenErr = response.error as { value?: { error?: string }, message?: string, statusText?: string, status?: number }
    const message = (edenErr.value && typeof edenErr.value === 'object' && 'error' in edenErr.value
      ? String((edenErr.value as { error?: string }).error || edenErr.statusText || '请求失败')
      : edenErr.message || edenErr.statusText || '请求失败')
    const error = new Error(message) as Error & { status?: number }
    error.status = edenErr.status
    throw error
  }
  return response.data as T
}

export async function fetchAdminUsers(params?: AdminUserListQuery): Promise<AdminUserListResponse> {
  return unwrap<AdminUserListResponse>(
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
  return unwrap<AdminUserDetailResponse>(
    await api.api.admin.users({ id: accountId }).get(),
  )
}

export async function fetchAdminTaskDetail(taskId: string): Promise<AdminTaskDetailResponse> {
  return unwrap<AdminTaskDetailResponse>(
    await api.api.admin.tasks({ id: taskId }).get(),
  )
}

export interface AdminProviderStatsQuery {
  windowHours?: number
}

export async function fetchAdminProviderStats(params?: AdminProviderStatsQuery): Promise<AdminProviderStatsResponse> {
  return unwrap<AdminProviderStatsResponse>(
    await api.api.admin.providers.get({
      query: {
        windowHours: params?.windowHours,
      },
    }),
  )
}

/**
 * Admin users / providers 的 react-query key。
 * 与 `adminQueryKeys`（在 query-client.ts）平级，本文件独立维护避免改 query-client.ts。
 */
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
  return unwrap<AdminProjectListResponse>(
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
  return unwrap<AdminAuditLogListResponse>(
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
  return unwrap<AdminApiKeyListResponse>(
    await api.api.admin.users({ id: accountId })['api-keys'].get(),
  )
}

export const adminUserApiKeysQueryKeys = {
  list: (accountId: string) => ['admin', 'users', accountId, 'api-keys'] as const,
}
