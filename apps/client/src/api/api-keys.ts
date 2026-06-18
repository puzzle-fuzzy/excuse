import type { ApiKeyCreateResponse, ApiKeyDTO, ApiKeyListResponse, CreatedApiKey, MutationOkResponse } from '@excuse/shared'
import { api, unwrapEden } from './client'

export async function listApiKeys(): Promise<ApiKeyDTO[]> {
  return unwrapEden<ApiKeyListResponse>(await api.api.keys.get()).items
}

export async function createApiKey(input: { name?: string, scope?: string }): Promise<CreatedApiKey> {
  return unwrapEden<ApiKeyCreateResponse>(await api.api.keys.post(input)).data
}

export async function revokeApiKey(id: string): Promise<void> {
  unwrapEden<MutationOkResponse>(await api.api.keys({ id }).delete())
}
