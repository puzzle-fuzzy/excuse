import type { RetentionCandidate } from '@excuse/db'
import type { AssetRetentionResult } from '@excuse/shared'
import type { ServerConfig } from '../config'
import {
  hardDeleteCanvasAsset,
  hardDeleteGenerationRecord,
  hardDeleteUploadedFile,
  isCanvasAssetRetainedGlobal,
  isUploadedFileRetainedGlobal,
  listCanvasAssetRetentionCandidates,
  listGenerationRecordRetentionCandidates,
  listUploadedFileRetentionCandidates,
} from '@excuse/db'
import { AssetStorage } from '@excuse/provider'
import { createLogger } from '@excuse/shared'
import { audit } from './audit'

const logger = createLogger('asset-retention')

/** 默认软删除 grace：30 天后才进入物理清除候选 */
export const DEFAULT_ASSET_GRACE_DAYS = 30

export interface AssetRetentionOptions {
  dryRun?: boolean
  graceDays?: number
  /** 测试注入；缺省由 config 构建 */
  storage?: AssetStorage
}

/**
 * 执行资产 retention GC —— 物理清除已软删除（deletedAt）且过 grace、且无引用的资产。
 *
 * - dry-run：仅扫描与计数，不删存储文件、不删 DB 行、不写审计；返回候选清单与 retained 清单。
 * - 真实执行：对每个候选复核引用（retained 跳过），再 storage.deleteFile + hard delete 行。
 *
 * retained（仍被引用）资产永远不物理清除，保证 Canvas 预览与后续生成不破裂。
 * 引用复核走全局 SQL（GC 跨用户扫描，不限定 accountId —— retained 是安全方向）。
 */
export async function runAssetRetentionCleanup(
  config: ServerConfig,
  options: AssetRetentionOptions = {},
): Promise<AssetRetentionResult> {
  const dryRun = options.dryRun ?? false
  const graceDays = options.graceDays ?? DEFAULT_ASSET_GRACE_DAYS
  const storage = options.storage ?? new AssetStorage({ storageRoot: config.storageRoot, oss: config.oss })
  const graceCutoff = new Date(Date.now() - graceDays * 86400000)

  const result: AssetRetentionResult = {
    dryRun,
    canvasAssetsPurged: [],
    uploadedFilesPurged: [],
    generationRecordsDeleted: [],
    retainedAssets: [],
  }

  // ── canvas_assets ──
  for (const candidate of await listCanvasAssetRetentionCandidates(graceCutoff)) {
    if (await isCanvasAssetRetainedGlobal(candidate.id)) {
      result.retainedAssets.push(candidate.id)
      continue
    }
    if (dryRun) {
      result.canvasAssetsPurged.push(candidate.id)
      continue
    }
    await purgeStorage(storage, candidate)
    await hardDeleteCanvasAsset(candidate.id)
    result.canvasAssetsPurged.push(candidate.id)
  }

  // ── uploaded_files ──
  for (const candidate of await listUploadedFileRetentionCandidates(graceCutoff)) {
    if (await isUploadedFileRetainedGlobal(candidate.id)) {
      result.retainedAssets.push(candidate.id)
      continue
    }
    if (dryRun) {
      result.uploadedFilesPurged.push(candidate.id)
      continue
    }
    await purgeStorage(storage, candidate)
    await hardDeleteUploadedFile(candidate.id)
    result.uploadedFilesPurged.push(candidate.id)
  }

  // ── generation_records（无存储文件，仅删 DB 行）──
  for (const candidate of await listGenerationRecordRetentionCandidates(graceCutoff)) {
    if (dryRun) {
      result.generationRecordsDeleted.push(candidate.id)
      continue
    }
    await hardDeleteGenerationRecord(candidate.id)
    result.generationRecordsDeleted.push(candidate.id)
  }

  if (!dryRun) {
    await audit('admin_action', {
      detail: {
        type: 'asset_retention_cleanup',
        dryRun: false,
        graceDays,
        canvasAssetsPurged: result.canvasAssetsPurged.length,
        uploadedFilesPurged: result.uploadedFilesPurged.length,
        generationRecordsDeleted: result.generationRecordsDeleted.length,
        retainedAssets: result.retainedAssets.length,
      },
    })
  }

  return result
}

async function purgeStorage(storage: AssetStorage, candidate: RetentionCandidate): Promise<void> {
  if (!candidate.storagePath)
    return
  try {
    await storage.deleteFile(candidate.storagePath)
  }
  catch (err) {
    // 存储删除失败不阻塞 DB 行清除（DB 行已无引用，残留文件可由后续运维清理）
    logger.warn({ storagePath: candidate.storagePath, err }, 'asset retention: storage purge failed')
  }
}
