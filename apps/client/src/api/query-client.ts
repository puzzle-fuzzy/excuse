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
