import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { handleApiError } from '../lib/utils'

/**
 * 管理端 QueryClient。
 *
 * 与用户端一致的全局错误策略，但移除了 client-logger / error-report 上报
 * （管理端是内部运营工具，不需要前端错误回传），改为 console 兜底。
 */
export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    // query 失败：组件通常自行渲染错误 UI（isError），此处仅 console，
    // 不弹 toast——避免后台 refetch 抖动时刷屏。401/403 由 unwrapEden 接管。
    onError: (error, query) => {
      console.warn('[admin] query error', { queryKey: String(query.queryKey), error: String(error) })
    },
  }),
  mutationCache: new MutationCache({
    // mutation 失败：统一兜底。无本地 onError 的 mutation 在此首次获得用户反馈；
    // 有本地 onError 的 mutation 跳过 toast（由本地负责）。
    onError: (error, _variables, _context, mutation) => {
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

/** 管理端用到的 query key 工厂（从用户端裁剪，仅保留 admin 域）。 */
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
