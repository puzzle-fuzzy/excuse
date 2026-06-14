import type { ApiKeyDTO, CreatedApiKey } from '@excuse/shared'
import { api } from './client'

export async function listApiKeys(): Promise<ApiKeyDTO[]> {
  const res = await api.api.keys.get()
  const data = res.data
  if (!data?.success)
    throw new Error('加载 API 密钥列表失败')
  return data.items
}

export async function createApiKey(input: { name?: string }): Promise<CreatedApiKey> {
  const res = await api.api.keys.post(input)
  const data = res.data
  if (!data?.success)
    throw new Error('创建 API 密钥失败')
  return data.data
}

export async function revokeApiKey(id: string): Promise<void> {
  const res = await api.api.keys({ id }).delete()
  const data = res.data
  if (!data?.success)
    throw new Error('撤销 API 密钥失败')
}
