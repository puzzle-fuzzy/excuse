/**
 * Canvas 运行时 — barrel
 *
 * 拆分为 pure/（纯逻辑，无 IO）和 io/（DB / Provider 调用），
 * 见 docs/TODO.md §一、2。
 */

// 纯逻辑
export { resolveShotVideoReferences, toPromptReferenceEntries } from './pure/references'
export type { ResolveShotVideoReferencesInput } from './pure/references'

export { VARIANT_FALLBACK, recommendCanvasVideoModel, getCanvasVideoModel } from './pure/model'
export type { CanvasVideoModelRecommendation } from './pure/model'

// IO 层
export { runCanvasAssetStep, generateCanvasImageAsset } from './io/asset'
export type { RunCanvasAssetStepInput, GenerateCanvasImageAssetInput, GeneratedCanvasImageAsset } from './io/asset'

export { submitCanvasShotVideo, prepareCanvasVideoParams } from './io/video'
export type { CanvasVideoSubmitInput, CanvasVideoSubmitResult } from './io/types'

// 阶段实现
export * from './llm-helpers'
export * from './normalize'
export * from './phases/analysis'
export * from './phases/character-refs'
export * from './phases/characters'
export * from './phases/continuity'
export * from './phases/dialogue'
export * from './phases/location-refs'
export * from './phases/locations'
export * from './phases/rebuild'
export * from './phases/storyboard'
export * from './phases/videos'
