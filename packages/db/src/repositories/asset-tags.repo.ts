import { and, desc, eq } from 'drizzle-orm'
import { getDb } from '../db'
import { assetTags } from '../schema/asset-tags'

export interface AssetTagRow {
  id: string
  accountId: string
  name: string
  createdAt: Date
}

/**
 * 创建标签
 *
 * 不做 trim/限长（route 层做）。同账号重名时由 PG 的 UNIQUE 约束抛错，
 * route 层 try/catch 把 DrizzleQueryError.cause.code === '23505' 翻译成 409 conflict。
 */
export async function createAssetTag(opts: {
  accountId: string
  name: string
}): Promise<AssetTagRow> {
  const [row] = await getDb()
    .insert(assetTags)
    .values({
      accountId: opts.accountId,
      name: opts.name,
    })
    .returning()
  return row as AssetTagRow
}

/** 列出当前用户全部标签，按 createdAt desc */
export async function listAssetTags(accountId: string): Promise<AssetTagRow[]> {
  return getDb()
    .select()
    .from(assetTags)
    .where(eq(assetTags.accountId, accountId))
    .orderBy(desc(assetTags.createdAt))
}

/** 按 id 查询单条标签（route 用于校验所有权） */
export async function findAssetTagById(opts: {
  accountId: string
  tagId: string
}): Promise<AssetTagRow | null> {
  const [row] = await getDb()
    .select()
    .from(assetTags)
    .where(and(eq(assetTags.accountId, opts.accountId), eq(assetTags.id, opts.tagId)))
    .limit(1)
  return (row as AssetTagRow | undefined) ?? null
}

/**
 * 删除标签 — ON DELETE CASCADE 自动级联删除分配
 *
 * 双重过滤 (accountId + id) 避免跨账号删除。
 * 不存在的 id 静默忽略（route 层幂等返回 200）。
 */
export async function deleteAssetTag(opts: {
  accountId: string
  tagId: string
}): Promise<void> {
  await getDb()
    .delete(assetTags)
    .where(and(eq(assetTags.accountId, opts.accountId), eq(assetTags.id, opts.tagId)))
}
