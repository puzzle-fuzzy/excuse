import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      retry: 1,
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
}

export const apiKeyQueryKeys = {
  all: ['api-keys'] as const,
  list: ['api-keys', 'list'] as const,
}

export const canvasAssetsPollingQueryKeys = {
  /** 单个项目的资产轮询 query key；refetchInterval 由 hook 动态计算 */
  poll: (projectId: string) => ['canvas-assets-poll', projectId] as const,
  /** 全部项目的资产轮询（用于跨项目 invalidate 时清空所有） */
  all: ['canvas-assets-poll'] as const,
}
