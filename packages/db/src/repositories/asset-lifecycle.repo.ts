import type { AssetLibrarySource, AssetReferenceSummary } from '@excuse/shared'
import { and, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import { getDb } from '../db'
import { canvasAssets } from '../schema/canvas-assets'
import { canvasShots } from '../schema/canvas-shots'
import { generationRecords } from '../schema/generation-records'
import { uploadedFiles } from '../schema/uploaded-files'
import { getCanvasAssetByIdForAccount } from './canvas-assets.repo'
import { getUploadedFileByIdForAccount, getUploadedFileUsage } from './uploaded-files.repo'

/**
 * 统一资产生命周期 repository —— 软删除 / 恢复 / 取消隐藏 / 引用守卫 / retention 候选。
 *
 * 状态机：active → hidden（hiddenAt）/ deleted（deletedAt）。deleted 仍被引用时为
 * retained（派生态，GC 不物理清除）。所有写操作都按 accountId 隔离（除引用计数，
 * 引用计数跨用户安全方向：多算引用只会 retain，不会误删）。
 */

// ── 引用守卫 ───────────────────────────────────────────────

/** 统计 canvas_shots.referenceAssetsJson 中引用指定 assetId 的镜头数（JSONB @>）。 — 文件内辅助，不公开 */
async function countCanvasShotsReferencingAsset(assetId: string): Promise<number> {
  const rows = await getDb().select({ count: sql<number>`count(*)::int` }).from(canvasShots).where(sql`${canvasShots.referenceAssetsJson} @> ${JSON.stringify([{ assetId }])}::jsonb`)
  return Number(rows[0]?.count ?? 0)
}

/**
 * 删除前引用守卫 —— 判定资产是否仍被项目 / 镜头 / 生成记录引用。
 *
 * 任一引用 > 0 → retained=true，软删除后 GC 不物理清除，保证 Canvas 预览与后续
 * 生成不破裂。generation_record 是叶子产物（canvas_assets 已拷贝其 output），删除
 * 不破坏引用，故恒 retained=false。
 */
export async function getAssetReferences(
  source: AssetLibrarySource,
  accountId: string,
  id: string,
): Promise<AssetReferenceSummary> {
  if (source === 'uploaded_file') {
    const file = await getUploadedFileByIdForAccount(id, accountId)
    if (!file)
      return emptyReferences()
    const usage = await getUploadedFileUsage(accountId, id)
    const shots = await countCanvasShotsReferencingAsset(id)
    const retained = shots > 0 || usage.subtitleProjectCount > 0 || usage.generationRecordCount > 0
    return {
      shots,
      subtitleProjects: usage.subtitleProjectCount,
      generationRecords: usage.generationRecordCount,
      isActiveVersion: false,
      retained,
    }
  }

  if (source === 'canvas_asset') {
    const asset = await getCanvasAssetByIdForAccount(id, accountId)
    if (!asset)
      return emptyReferences()
    const shots = await countCanvasShotsReferencingAsset(id)
    const isActiveVersion = asset.isActive
    const retained = shots > 0 || isActiveVersion
    return {
      shots,
      subtitleProjects: 0,
      generationRecords: 0,
      isActiveVersion,
      retained,
    }
  }

  // generation_record：叶子产物，无破坏性引用
  return emptyReferences()
}

function emptyReferences(): AssetReferenceSummary {
  return { shots: 0, subtitleProjects: 0, generationRecords: 0, isActiveVersion: false, retained: false }
}

// ── 软删除 / 恢复 / 取消隐藏 ────────────────────────────────

/** 软删除 canvas_asset（置 deletedAt）。仅在归属当前用户且未删除时生效。 */
export async function softDeleteCanvasAsset(id: string, accountId: string): Promise<boolean> {
  const rows = await getDb().update(canvasAssets).set({ deletedAt: new Date(), updatedAt: new Date() }).where(and(eq(canvasAssets.id, id), eq(canvasAssets.accountId, accountId), isNull(canvasAssets.deletedAt))).returning({ id: canvasAssets.id })
  return rows.length > 0
}

/** 软删除 generation_record。 */
export async function softDeleteGenerationRecord(id: string, accountId: string): Promise<boolean> {
  const rows = await getDb().update(generationRecords).set({ deletedAt: new Date() }).where(and(eq(generationRecords.id, id), eq(generationRecords.accountId, accountId), isNull(generationRecords.deletedAt))).returning({ id: generationRecords.id })
  return rows.length > 0
}

/** 软删除 uploaded_file。 */
export async function softDeleteUploadedFile(id: string, accountId: string): Promise<boolean> {
  const rows = await getDb().update(uploadedFiles).set({ deletedAt: new Date() }).where(and(eq(uploadedFiles.id, id), eq(uploadedFiles.accountId, accountId), isNull(uploadedFiles.deletedAt))).returning({ id: uploadedFiles.id })
  return rows.length > 0
}

/** 恢复（un-delete）canvas_asset。 */
export async function restoreCanvasAsset(id: string, accountId: string): Promise<boolean> {
  const rows = await getDb().update(canvasAssets).set({ deletedAt: null, updatedAt: new Date() }).where(and(eq(canvasAssets.id, id), eq(canvasAssets.accountId, accountId))).returning({ id: canvasAssets.id })
  return rows.length > 0
}

/** 恢复（un-delete）generation_record。 */
export async function restoreGenerationRecord(id: string, accountId: string): Promise<boolean> {
  const rows = await getDb().update(generationRecords).set({ deletedAt: null }).where(and(eq(generationRecords.id, id), eq(generationRecords.accountId, accountId))).returning({ id: generationRecords.id })
  return rows.length > 0
}

/** 恢复（un-delete）uploaded_file。 */
export async function restoreUploadedFile(id: string, accountId: string): Promise<boolean> {
  const rows = await getDb().update(uploadedFiles).set({ deletedAt: null }).where(and(eq(uploadedFiles.id, id), eq(uploadedFiles.accountId, accountId))).returning({ id: uploadedFiles.id })
  return rows.length > 0
}

// ── retention GC 候选 + 物理清除 ────────────────────────────

export interface RetentionCandidate {
  id: string
  storagePath: string | null
  /** canvas_asset 是否为当前活跃版本（retained 判定用） */
  isActive: boolean
}

/** 列出软删除超过 grace 截止时间的 canvas_asset 候选（含 storagePath / isActive 供 retained 判定与物理清除）。 */
export async function listCanvasAssetRetentionCandidates(graceCutoff: Date): Promise<RetentionCandidate[]> {
  const rows = await getDb().select({ id: canvasAssets.id, storagePath: canvasAssets.storagePath, isActive: canvasAssets.isActive }).from(canvasAssets).where(and(isNotNull(canvasAssets.deletedAt), lt(canvasAssets.deletedAt, graceCutoff)))
  return rows.map(r => ({ id: r.id, storagePath: r.storagePath, isActive: r.isActive }))
}

/** 列出软删除超过 grace 的 uploaded_file 候选。 */
export async function listUploadedFileRetentionCandidates(graceCutoff: Date): Promise<RetentionCandidate[]> {
  const rows = await getDb().select({ id: uploadedFiles.id, storagePath: uploadedFiles.storagePath }).from(uploadedFiles).where(and(isNotNull(uploadedFiles.deletedAt), lt(uploadedFiles.deletedAt, graceCutoff)))
  return rows.map(r => ({ id: r.id, storagePath: r.storagePath, isActive: false }))
}

/** 列出软删除超过 grace 的 generation_record 候选（无 storagePath，仅删 DB 行）。 */
export async function listGenerationRecordRetentionCandidates(graceCutoff: Date): Promise<RetentionCandidate[]> {
  const rows = await getDb().select({ id: generationRecords.id }).from(generationRecords).where(and(isNotNull(generationRecords.deletedAt), lt(generationRecords.deletedAt, graceCutoff)))
  return rows.map(r => ({ id: r.id, storagePath: null, isActive: false }))
}

/**
 * GC 全局 retained 复核（无 accountId 上下文）。
 *
 * 与用户侧 getAssetReferences 不同：GC 跨用户扫描，引用计数不限定 owner —— retained
 * 是安全方向（多算引用只会跳过清除，不会误删）。
 */
export async function isCanvasAssetRetainedGlobal(id: string): Promise<boolean> {
  // 读取该 asset 的 isActive + 是否被任何镜头引用
  const rows = await getDb().select({ isActive: canvasAssets.isActive }).from(canvasAssets).where(eq(canvasAssets.id, id)).limit(1)
  if (rows.length === 0)
    return false // 已不存在（并发删除），不视为 retained
  if (rows[0]!.isActive)
    return true
  const shots = await countCanvasShotsReferencingAsset(id)
  return shots > 0
}

export async function isUploadedFileRetainedGlobal(fileId: string): Promise<boolean> {
  const shots = await countCanvasShotsReferencingAsset(fileId)
  if (shots > 0)
    return true
  const rows = await getDb().execute(sql`
    SELECT
      (SELECT count(*) FROM subtitle_projects WHERE video_file_id = ${fileId})::int
      + (SELECT count(*) FROM generation_records WHERE input_params @> ${JSON.stringify({ referenceFileIds: [fileId] })}::jsonb)::int
      AS total
  `)
  return Number((rows[0] as { total?: number } | undefined)?.total ?? 0) > 0
}

/** 物理删除 canvas_asset 行（GC 在已物理清除存储文件后调用）。 */
export async function hardDeleteCanvasAsset(id: string): Promise<void> {
  await getDb().delete(canvasAssets).where(eq(canvasAssets.id, id))
}

/** 物理删除 uploaded_file 行。 */
export async function hardDeleteUploadedFile(id: string): Promise<void> {
  await getDb().delete(uploadedFiles).where(eq(uploadedFiles.id, id))
}

/** 物理删除 generation_record 行。 */
export async function hardDeleteGenerationRecord(id: string): Promise<void> {
  await getDb().delete(generationRecords).where(eq(generationRecords.id, id))
}
