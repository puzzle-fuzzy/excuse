import { and, eq } from 'drizzle-orm'
import { getDb } from '../db'
import { assetTagAssignments } from '../schema/asset-tag-assignments'

/**
 * 资产来源表 — 与 @excuse/shared 的 AssetLibrarySource 对齐
 *
 * 本地声明联合类型，不反向 import @excuse/shared（shared 依赖 db，
 * 反向 import 会形成循环依赖）。schema.source 列保持 varchar，由 route
 * 在写入前保证值合法。
 */
export type AssetTagAssignmentSource = 'generation_record' | 'canvas_asset' | 'uploaded_file'

export interface AssetTagAssignmentKey {
  tagId: string
  source: AssetTagAssignmentSource
  assetId: string
}

/** 给资产打标 — 幂等（依赖复合唯一约束，ON CONFLICT DO NOTHING） */
export async function assignAssetTag(opts: {
  accountId: string
  tagId: string
  source: AssetTagAssignmentSource
  assetId: string
}): Promise<void> {
  await getDb()
    .insert(assetTagAssignments)
    .values({
      accountId: opts.accountId,
      tagId: opts.tagId,
      source: opts.source,
      assetId: opts.assetId,
    })
    .onConflictDoNothing()
}

/** 取消打标 — 幂等（不存在不抛错） */
export async function unassignAssetTag(opts: {
  accountId: string
  tagId: string
  source: AssetTagAssignmentSource
  assetId: string
}): Promise<void> {
  await getDb()
    .delete(assetTagAssignments)
    .where(and(
      eq(assetTagAssignments.accountId, opts.accountId),
      eq(assetTagAssignments.tagId, opts.tagId),
      eq(assetTagAssignments.source, opts.source),
      eq(assetTagAssignments.assetId, opts.assetId),
    ))
}

/**
 * 批量查询当前用户全部 (tagId, source, assetId) 集合
 *
 * GET /api/assets 一次性查回，在 route 内存 Map<source:assetId, Set<tagId>> 做匹配。
 */
export async function listAssetTagKeys(accountId: string): Promise<AssetTagAssignmentKey[]> {
  const rows = await getDb()
    .select({
      tagId: assetTagAssignments.tagId,
      source: assetTagAssignments.source,
      assetId: assetTagAssignments.assetId,
    })
    .from(assetTagAssignments)
    .where(eq(assetTagAssignments.accountId, accountId))
  return rows as AssetTagAssignmentKey[]
}
