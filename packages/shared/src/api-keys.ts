import type { EntityResponse, ListResponse } from './api-response'

export type ApiKeyScope = 'all' | 'gateway'

export interface ApiKeyDTO {
  id: string
  prefix: string
  name: string | null
  scope: string
  rateLimitPerMinute: number | null
  quotaMaxCents: number | null
  totalSpendCents: number
  quotaResetAt: string | null
  lastUsedAt: string | null
  createdAt: string
  revokedAt: string | null
}

export interface CreatedApiKey {
  key: string
  prefix: string
}

export type ApiKeyCreateResponse = EntityResponse<CreatedApiKey>

export type ApiKeyListResponse = ListResponse<ApiKeyDTO>
