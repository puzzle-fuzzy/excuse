/**
 * Canvas Runtime Adapter 工厂 — Worker 端
 *
 * 从真实的 @excuse/db / @excuse/provider / @excuse/storage / @excuse/ffmpeg 实现
 * 组装 CanvasRuntimeAdapters，供 phase 函数注入使用。
 */

import type { CanvasRuntimeFfmpegAdapter, CanvasRuntimeProviderAdapter, CanvasRuntimeRepoAdapter } from '@excuse/canvas-runtime'
import type { AssetStorage } from '@excuse/storage'
import {
  batchCreateCanvasShots,
  bindCanvasAssetTaskId,
  createCanvasAsset,
  createCanvasCharacter,
  createCanvasLocation,
  createContinuityReport,
  createGenerationRecord,
  deleteCanvasCharactersByProject,
  deleteCanvasLocationsByProject,
  deleteCanvasShotsByProject,
  getCanvasProjectById,
  getCanvasProjectDetail,
  markCanvasAssetFailed,
  markCanvasAssetRunning,
  markCanvasAssetSucceeded,
  setCanvasAssetActive,
  updateCanvasCharacter,
  updateCanvasLocation,
  updateCanvasProject,
  updateCanvasShot,
} from '@excuse/db'
import { concatVideos, mixBgmTrack } from '@excuse/ffmpeg'
import {
  getModelById,
  validateAndMerge,
} from '@excuse/provider'

/** 创建真实 Repo Adapter（Worker 端 DB 实现） */
export function createWorkerRepoAdapter(): CanvasRuntimeRepoAdapter {
  return {
    getCanvasProjectById,
    getCanvasProjectDetail,
    updateCanvasProject,
    createCanvasCharacter,
    updateCanvasCharacter,
    deleteCanvasCharactersByProject,
    createCanvasLocation,
    updateCanvasLocation,
    deleteCanvasLocationsByProject,
    batchCreateCanvasShots,
    deleteCanvasShotsByProject,
    updateCanvasShot,
    createContinuityReport,
    createCanvasAsset,
    markCanvasAssetRunning,
    markCanvasAssetSucceeded,
    markCanvasAssetFailed,
    setCanvasAssetActive,
    bindCanvasAssetTaskId,
    createGenerationRecord,
  }
}

/** 创建真实 Provider Adapter（Worker 端 provider 实现） */
export function createWorkerProviderAdapter(): CanvasRuntimeProviderAdapter {
  return { getModelById, validateAndMerge }
}

/** 创建真实 FFmpeg Adapter（Worker 端实现） */
export function createWorkerFfmpegAdapter(): CanvasRuntimeFfmpegAdapter {
  return { concatVideos, mixBgmTrack }
}

/** 创建完整 CanvasRuntimeAdapters（不含 llm client 和 storage，这些由 caller 按请求注入） */
export function createWorkerCanvasAdapters(storage: AssetStorage) {
  return {
    repo: createWorkerRepoAdapter(),
    provider: createWorkerProviderAdapter(),
    ffmpeg: createWorkerFfmpegAdapter(),
    storage,
  }
}
