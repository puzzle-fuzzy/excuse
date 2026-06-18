import type { OpenAIGatewayUsageResponse } from '@excuse/shared'
import { api, unwrapEden } from './api-core'

// ===== Gateway API =====

export async function fetchGatewayUsage(params?: { days?: number, limit?: number }): Promise<OpenAIGatewayUsageResponse> {
  return unwrapEden<OpenAIGatewayUsageResponse>(
    await api.v1.usage.get({ query: { days: params?.days, limit: params?.limit } }),
  )
}
