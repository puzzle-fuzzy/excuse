import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { clientLogger } from '../lib/client-logger'
import { reportClientError } from '../lib/error-report'
import { handleApiError } from '../lib/utils'

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    // query 失败：组件通常自行渲染错误 UI（isError），此处仅上报 + console，
    // 不弹 toast——避免后台 refetch 抖动时刷屏。401/403 由 unwrapEden 接管。
    onError: (error, query) => {
      reportClientError(error)
      clientLogger.warn('Query error', { route: 'API', action: 'query', extra: { queryKey: String(query.queryKey), error: String(error) } })
    },
  }),
  mutationCache: new MutationCache({
    // mutation 失败：统一兜底。无本地 onError 的 mutation 在此首次获得用户反馈；
    // 有本地 onError 的 mutation 跳过 toast（由本地负责），仍上报到 server 日志。
    onError: (error, _variables, _context, mutation) => {
      reportClientError(error)
      if (mutation.options.onError)
        return // 本地 onError 已处理用户反馈，全局不重复 toast
      handleApiError(error)
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      retry: 1,
      retryDelay: attempt => Math.min(1000 * 2 ** attempt, 10_000),
    },
    mutations: {
      retry: false,
    },
  },
})

export const notificationQueryKeys = {
  all: ['notifications'] as const,
  list: ['notifications', 'list'] as const,
  unread: ['notifications', 'unread'] as const,
}

export const billingQueryKeys = {
  all: ['billing'] as const,
  statistics: ['billing', 'statistics'] as const,
  balance: ['billing', 'balance'] as const,
  transactions: (params?: { limit?: number }) => ['billing', 'transactions', params] as const,
}

export const apiKeyQueryKeys = {
  all: ['api-keys'] as const,
  list: ['api-keys', 'list'] as const,
}

export const adminQueryKeys = {
  all: ['admin'] as const,
  overview: ['admin', 'overview'] as const,
  tasks: (params: { status?: string, domain?: string, search?: string, limit?: number, offset?: number }) =>
    ['admin', 'tasks', params] as const,
  users: {
    list: ['admin', 'users', 'list'] as const,
    listWithParams: (params: Record<string, unknown>) => ['admin', 'users', 'list', params] as const,
    detail: (userId: string) => ['admin', 'users', 'detail', userId] as const,
  },
  projects: (params?: Record<string, unknown>) => ['admin', 'projects', params] as const,
  providers: (windowHours?: number) => ['admin', 'providers', windowHours] as const,
  gatewayClients: {
    list: (params?: Record<string, unknown>) => ['admin', 'gateway-clients', params] as const,
    all: ['admin', 'gateway-clients'] as const,
  },
}

export const assetQueryKeys = {
  library: ['asset-library'] as const,
  tags: ['asset-tags'] as const,
}

export const gatewayQueryKeys = {
  usage: ['gateway', 'usage'] as const,
}

export const subjectQueryKeys = {
  all: ['subjects'] as const,
  list: (params?: Record<string, unknown>) => ['subjects', params] as const,
}

export const canvasAssetsPollingQueryKeys = {
  /** 单个项目的资产轮询 query key；refetchInterval 由 hook 动态计算 */
  poll: (projectId: string) => ['canvas-assets-poll', projectId] as const,
  /** 全部项目的资产轮询（用于跨项目 invalidate 时清空所有） */
  all: ['canvas-assets-poll'] as const,
}

export const canvasPipelineRunsQueryKeys = {
  /** 单个项目的 pipeline-run 兜底轮询 query key；refetchInterval 由 hook 固定 3000ms */
  poll: (projectId: string) => ['canvas-pipeline-runs-poll', projectId] as const,
  /** 全部项目的 pipeline-run（用于全局 invalidate） */
  all: ['canvas-pipeline-runs-poll'] as const,
}
