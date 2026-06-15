import { and, desc, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import { getDb } from '../db'
import { apiKeys } from '../schema/api-keys'

/** API Key scope 类型（应用层联合类型，DB 存 varchar） */
export type ApiKeyScope = 'all' | 'gateway'
export const VALID_API_KEY_SCOPES: ApiKeyScope[] = ['all', 'gateway']

/** 创建 API Key 记录（存储 SHA-256 hash + 短前缀） */
export async function createApiKey(values: {
  accountId: string
  prefix: string
  keyHash: string
  name?: string
  scope?: ApiKeyScope
  rateLimitPerMinute?: number | null
  quotaMaxCents?: number | null
}) {
  const [key] = await getDb()
    .insert(apiKeys)
    .values({
      accountId: values.accountId,
      prefix: values.prefix,
      keyHash: values.keyHash,
      name: values.name,
      scope: values.scope ?? 'all',
      rateLimitPerMinute: values.rateLimitPerMinute ?? null,
      quotaMaxCents: values.quotaMaxCents ?? null,
    })
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
      scope: apiKeys.scope,
      rateLimitPerMinute: apiKeys.rateLimitPerMinute,
      quotaMaxCents: apiKeys.quotaMaxCents,
      totalSpendCents: apiKeys.totalSpendCents,
      quotaResetAt: apiKeys.quotaResetAt,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.accountId, accountId), isNull(apiKeys.revokedAt)))
    .orderBy(desc(apiKeys.createdAt))
}

/** 按 hash 查找未撤销的 API Key（用于请求认证）—— 返回所有列 */
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

/**
 * 递增 API Key 已消耗额度（分）。
 * 如果超过 quotaMaxCents 会触发错误，由调用方决定是否拒绝请求。
 */
export async function incrementApiKeySpend(id: string, cents: number) {
  await getDb()
    .update(apiKeys)
    .set({
      totalSpendCents: sql`${apiKeys.totalSpendCents} + ${cents}`,
    })
    .where(eq(apiKeys.id, id))
}

/**
 * 重置 API Key 已消耗额度（用于配额周期重置）
 */
export async function resetApiKeySpend(id: string) {
  await getDb()
    .update(apiKeys)
    .set({
      totalSpendCents: 0,
      quotaResetAt: null,
    })
    .where(eq(apiKeys.id, id))
}

/**
 * 检查并重置到期额度。
 * 如果 quotaResetAt 已过期，将 totalSpendCents 归零并清除 resetAt。
 * 返回 true 表示已重置，false 表示无需重置。
 */
export async function checkAndResetApiKeyQuota(id: string): Promise<boolean> {
  const now = new Date()
  const [key] = await getDb()
    .select({ id: apiKeys.id, quotaResetAt: apiKeys.quotaResetAt })
    .from(apiKeys)
    .where(and(
      eq(apiKeys.id, id),
      isNotNull(apiKeys.quotaResetAt),
      lt(apiKeys.quotaResetAt, now),
    ))
    .limit(1)
  if (key) {
    await resetApiKeySpend(id)
    return true
  }
  return false
}

/**
 * 检查 API Key 是否超出额度。
 * quotaMaxCents 为 null 表示不限制；totalSpendCents < quotaMaxCents 视为有剩余额度。
 * 调用前应先执行 checkAndResetApiKeyQuota。
 */
export async function isApiKeyQuotaExceeded(id: string): Promise<boolean> {
  const [key] = await getDb()
    .select({
      id: apiKeys.id,
      totalSpendCents: apiKeys.totalSpendCents,
      quotaMaxCents: apiKeys.quotaMaxCents,
    })
    .from(apiKeys)
    .where(eq(apiKeys.id, id))
    .limit(1)
  if (!key || key.quotaMaxCents === null)
    return false
  return key.totalSpendCents >= key.quotaMaxCents
}

/** 更新 API Key 的 scope 和限流/额度配置（管理员） */
export async function updateApiKeyConfig(
  id: string,
  accountId: string,
  values: {
    scope?: ApiKeyScope
    rateLimitPerMinute?: number | null
    quotaMaxCents?: number | null
    quotaResetAt?: Date | null
  },
) {
  const [updated] = await getDb()
    .update(apiKeys)
    .set({
      ...(values.scope !== undefined ? { scope: values.scope } : {}),
      ...(values.rateLimitPerMinute !== undefined ? { rateLimitPerMinute: values.rateLimitPerMinute } : {}),
      ...(values.quotaMaxCents !== undefined ? { quotaMaxCents: values.quotaMaxCents } : {}),
      ...(values.quotaResetAt !== undefined ? { quotaResetAt: values.quotaResetAt } : {}),
    })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.accountId, accountId)))
    .returning()
  return updated ?? null
}

/** 管理员查询指定用户的所有 API Key（含已撤销的），按创建时间倒序 */
export async function listAdminApiKeysByAccount(accountId: string) {
  return getDb()
    .select({
      id: apiKeys.id,
      prefix: apiKeys.prefix,
      name: apiKeys.name,
      scope: apiKeys.scope,
      rateLimitPerMinute: apiKeys.rateLimitPerMinute,
      quotaMaxCents: apiKeys.quotaMaxCents,
      totalSpendCents: apiKeys.totalSpendCents,
      quotaResetAt: apiKeys.quotaResetAt,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.accountId, accountId))
    .orderBy(desc(apiKeys.createdAt))
}
