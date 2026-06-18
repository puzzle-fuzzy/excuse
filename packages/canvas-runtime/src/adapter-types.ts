/**
 * Canvas Runtime Adapter 接口
 *
 * 本文件是 canvas-runtime 与外部 IO（DB / Provider / Storage / FFmpeg）的边界。
 * phase 函数只依赖这里的接口，不直接 import @excuse/db / @excuse/provider 等。
 *
 * 本文件本身允许 import IO 包（作为翻译层），但 phase 文件禁止。
 * 未来可进一步把本文件的类型定义内联，彻底移除 IO 包依赖。
 */

import type {
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
import type { concatVideos, mixBgmTrack } from '@excuse/ffmpeg'
import type { getModelById as _getModelById, validateAndMerge as _validateAndMerge, DashScopeClient } from '@excuse/provider'
import type { AssetStorage } from '@excuse/storage'

// ─── LLM Client（DashScopeClient 满足此接口） ───

/** canvas-runtime 需要的 LLM 客户端接口。DashScopeClient 满足此接口（鸭子类型）。 */
export type CanvasRuntimeLlmClient = DashScopeClient

// ─── Provider 适配器 ───

export type { ParameterValidationError, ValidatedModelParameters, ValidationResult } from '@excuse/provider'

export interface CanvasRuntimeProviderAdapter {
  getModelById: typeof _getModelById
  validateAndMerge: typeof _validateAndMerge
}

// ─── Repository 适配器 ───

export interface CanvasRuntimeRepoAdapter {
  // Canvas project
  getCanvasProjectById: typeof getCanvasProjectById
  getCanvasProjectDetail: typeof getCanvasProjectDetail
  updateCanvasProject: typeof updateCanvasProject

  // Characters
  createCanvasCharacter: typeof createCanvasCharacter
  updateCanvasCharacter: typeof updateCanvasCharacter
  deleteCanvasCharactersByProject: typeof deleteCanvasCharactersByProject

  // Locations
  createCanvasLocation: typeof createCanvasLocation
  updateCanvasLocation: typeof updateCanvasLocation
  deleteCanvasLocationsByProject: typeof deleteCanvasLocationsByProject

  // Shots
  batchCreateCanvasShots: typeof batchCreateCanvasShots
  deleteCanvasShotsByProject: typeof deleteCanvasShotsByProject
  updateCanvasShot: typeof updateCanvasShot

  // Continuity
  createContinuityReport: typeof createContinuityReport

  // Assets
  createCanvasAsset: typeof createCanvasAsset
  markCanvasAssetRunning: typeof markCanvasAssetRunning
  markCanvasAssetSucceeded: typeof markCanvasAssetSucceeded
  markCanvasAssetFailed: typeof markCanvasAssetFailed
  setCanvasAssetActive: typeof setCanvasAssetActive
  bindCanvasAssetTaskId: typeof bindCanvasAssetTaskId

  // Generation records
  createGenerationRecord: typeof createGenerationRecord
}

// ─── Storage 适配器 ───

export type CanvasRuntimeStorageAdapter = AssetStorage

// ─── FFmpeg 适配器 ───

export interface CanvasRuntimeFfmpegAdapter {
  concatVideos: typeof concatVideos
  mixBgmTrack: typeof mixBgmTrack
}

// ─── 组合适配器 ───

export interface CanvasRuntimeAdapters {
  llm: CanvasRuntimeLlmClient
  provider: CanvasRuntimeProviderAdapter
  repo: CanvasRuntimeRepoAdapter
  storage: CanvasRuntimeStorageAdapter
  ffmpeg: CanvasRuntimeFfmpegAdapter
}
