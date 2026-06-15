import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { getDb } from '../db'
import { apiKeys } from '../schema/api-keys'

/** 创建 API Key 记录（存储 SHA-256 hash + 短前缀） */
export async function createApiKey(values: {
  accountId: string
  prefix: string
  keyHash: string
  name?: string
}) {
  const [key] = await getDb()
    .insert(apiKeys)
    .values(values)
    .returning()
  return key!
}

/** 列出用户所有未撤销的 API Key（按创建时间倒序） */
export async function listApiKeysByAccount(accountId: string) {
  return getDb()
    .select({
      id: apiKeys.id,
      prefix: apiKeys.prefix,
      name: apiKeys.name,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.accountId, accountId), isNull(apiKeys.revokedAt)))
    .orderBy(desc(apiKeys.createdAt))
}

/** 按 hash 查找未撤销的 API Key（用于请求认证） */
export async function findApiKeyByHash(keyHash: string) {
  const [key] = await getDb()
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
    .limit(1)
  return key ?? null
}

/** 按 hash 查找已撤销的 API Key（用于触发过期通知） */
export async function findRevokedApiKeyByHash(keyHash: string) {
  const [key] = await getDb()
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, keyHash), isNotNull(apiKeys.revokedAt)))
    .limit(1)
  return key ?? null
}

/** 撤销 API Key（设置 revokedAt，需为 key 所有者且未撤销） */
export async function revokeApiKey(id: string, accountId: string) {
  const [updated] = await getDb()
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.accountId, accountId), isNull(apiKeys.revokedAt)))
    .returning()
  return updated ?? null
}

/** 更新 API Key 最后使用时间（每次成功认证后调用） */
export async function touchApiKeyLastUsed(id: string) {
  await getDb()
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, id))
}
