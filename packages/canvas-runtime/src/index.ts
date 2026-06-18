/**
 * Canvas 运行时 — barrel
 *
 * 拆分为 pure/（纯逻辑，无 IO）和 io/（DB / Provider 调用），
 * 见 docs/TODO.md §一、2。
 *
 * 所有 IO 通过 adapter 接口注入（adapter-types.ts），phase 函数不直接 import @excuse/db / @excuse/provider。
 */

// Adapter 接口
export type {
  CanvasRuntimeAdapters,
  CanvasRuntimeFfmpegAdapter,
  CanvasRuntimeLlmClient,
  CanvasRuntimeProviderAdapter,
  CanvasRuntimeRepoAdapter,
  CanvasRuntimeStorageAdapter,
} from './adapter-types'

// IO 层
export { generateCanvasImageAsset, runCanvasAssetStep } from './io/asset'
export type { GenerateCanvasImageAssetInput, GeneratedCanvasImageAsset, RunCanvasAssetStepInput } from './io/asset'

export type { CanvasVideoSubmitInput, CanvasVideoSubmitResult } from './io/types'
export { prepareCanvasVideoParams, submitCanvasShotVideo } from './io/video'
export type { CanvasVideoSubmitFullInput } from './io/video'

// 阶段实现
export * from './llm-helpers'
export * from './normalize'

export * from './phases/analysis'
export * from './phases/assemble'
export * from './phases/bgm'

export * from './phases/character-refs'
export * from './phases/characters'
export * from './phases/continuity'
export * from './phases/dialogue'
export * from './phases/location-refs'
export * from './phases/locations'
export * from './phases/rebuild'
export * from './phases/storyboard'
export * from './phases/videos'
export { getCanvasVideoModel, recommendCanvasVideoModel, VARIANT_FALLBACK } from './pure/model'
export type { CanvasVideoModelRecommendation } from './pure/model'
export { buildR2VRequest, extractSpeakingCharacterIds, R2V_MAX_REFERENCES } from './pure/r2v'
export type { BuildR2VRequestInput } from './pure/r2v'
// 纯逻辑
export { resolveShotVideoReferences, toPromptReferenceEntries } from './pure/references'
export type { ResolveShotVideoReferencesInput } from './pure/references'
