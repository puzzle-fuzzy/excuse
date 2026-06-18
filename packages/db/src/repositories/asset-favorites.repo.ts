import { and, eq } from 'drizzle-orm'
import { getDb } from '../db'
import { assetFavorites } from '../schema/asset-favorites'

/**
 * 资产来源表 — 与 @excuse/shared 的 AssetLibrarySource 对齐
 *
 * 这里本地声明联合类型，不反向 import @excuse/shared（shared 依赖 db，
 * 反向 import 会形成循环依赖）。schema.source 列保持 varchar，由 route
 * 在写入前保证值合法。
 */
export type AssetFavoriteSource = 'generation_record' | 'canvas_asset' | 'uploaded_file'

export interface AssetFavoriteRow {
  id: string
  accountId: string
  source: AssetFavoriteSource
  assetId: string
  createdAt: Date
}

export interface AssetFavoriteKey {
  source: AssetFavoriteSource
  assetId: string
}

/**
 * 标记收藏（已存在则幂等返回）
 *
 * 依赖 `idx_asset_favorites_unique` 复合唯一约束：同 (account, source, asset)
 * 第二次插入触发 ON CONFLICT DO NOTHING，行数不变。
 */
export async function addAssetFavorite(opts: {
  accountId: string
  source: AssetFavoriteSource
  assetId: string
}): Promise<AssetFavoriteRow> {
  const db = getDb()
  const [row] = await db
    .insert(assetFavorites)
    .values({
      accountId: opts.accountId,
      source: opts.source,
      assetId: opts.assetId,
    })
    .onConflictDoNothing()
    .returning()

  // onConflictDoNothing 命中时 returning() 为空数组 — 回查一次以拿到既有行
  if (row)
    return row as AssetFavoriteRow

  const [existing] = await db
    .select()
    .from(assetFavorites)
    .where(and(
      eq(assetFavorites.accountId, opts.accountId),
      eq(assetFavorites.source, opts.source),
      eq(assetFavorites.assetId, opts.assetId),
    ))
    .limit(1)
  return existing as AssetFavoriteRow
}

/** 取消收藏（不存在则幂等返回） */
export async function removeAssetFavorite(opts: {
  accountId: string
  source: AssetFavoriteSource
  assetId: string
}): Promise<void> {
  await getDb()
    .delete(assetFavorites)
    .where(and(
      eq(assetFavorites.accountId, opts.accountId),
      eq(assetFavorites.source, opts.source),
      eq(assetFavorites.assetId, opts.assetId),
    ))
}

/**
 * 列出当前用户全部收藏的 (source, assetId) 集合
 *
 * 用于 GET /api/assets 一次性查回全部收藏 key，在 route 内存 Set 做匹配，
 * 避免对每条资产发一次 SQL。
 */
export async function listAssetFavoriteKeys(accountId: string): Promise<AssetFavoriteKey[]> {
  const rows = await getDb()
    .select({
      source: assetFavorites.source,
      assetId: assetFavorites.assetId,
    })
    .from(assetFavorites)
    .where(eq(assetFavorites.accountId, accountId))
  return rows as AssetFavoriteKey[]
}
