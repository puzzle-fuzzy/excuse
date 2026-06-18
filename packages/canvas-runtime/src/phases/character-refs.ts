import type { DashScopeClient } from '@excuse/provider'
import type { ModelConfig } from '@excuse/shared'
import type { AssetStorage } from '@excuse/storage'
import type { CanvasProjectDetail } from '../normalize'
import { updateCanvasCharacter } from '@excuse/db'
import { generateCanvasImageAsset } from '..'

type CharacterRow = CanvasProjectDetail['characters'][number]

/**
 * 角色肖像 prompt 模板 — host 用于 createCanvasAsset.inputJson，core 内部用于生成。
 * 单一来源，消除 server/worker 各自硬编码 prompt suffix 的漂移。
 */
export function buildCharacterPortraitPrompt(identityPrompt: string): string {
  return `${identityPrompt}, portrait photo, neutral expression, solid background, front view, high quality`
}

/**
 * 角色三视图 prompt 模板 — 同上。
 */
export function buildCharacterTurnaroundPrompt(identityPrompt: string): string {
  return `${identityPrompt}, character turnaround sheet showing front view, side view, and back view, white background, character design sheet`
}

/**
 * 角色参考图生成核心（per-entity, 2-image）：portrait + turnaround 双图生成 → persist。
 * Host 保留 per-entity 循环、skip-guards（locked/!identityPrompt/referenceImageUrl）、
 * 资产行 createCanvasAsset/markRunning/markFailed、per-entity notifyNode。
 */
export interface CharacterRefAssetsInput {
  character: CharacterRow
  portraitAssetId: string
  turnaroundAssetId: string
  imageModel: string
  imageModelConfig: ModelConfig
  client: DashScopeClient
  storage: AssetStorage
}

export interface CharacterRefAssetsResult {
  portraitUrl?: string
  turnaroundUrl?: string
}

export async function generateCharacterRefAssets(input: CharacterRefAssetsInput): Promise<CharacterRefAssetsResult> {
  const { character, portraitAssetId, turnaroundAssetId, imageModel, imageModelConfig, client, storage } = input
  const subDir = `canvas/${character.id}`

  const portraitPrompt = buildCharacterPortraitPrompt(character.identityPrompt!)
  const portrait = await generateCanvasImageAsset({
    assetId: portraitAssetId,
    imageModel,
    imageModelConfig,
    prompt: portraitPrompt,
    subDir,
    prefix: 'portrait',
    errorMessage: '角色参考图生成失败',
    client,
    storage,
  })
  if (portrait)
    await updateCanvasCharacter(character.id, { referenceImageUrl: portrait.publicUrl })

  const turnaroundPrompt = buildCharacterTurnaroundPrompt(character.identityPrompt!)
  const turnaround = await generateCanvasImageAsset({
    assetId: turnaroundAssetId,
    imageModel,
    imageModelConfig,
    prompt: turnaroundPrompt,
    subDir,
    prefix: 'turnaround',
    errorMessage: '角色参考图生成失败',
    client,
    storage,
  })
  if (turnaround)
    await updateCanvasCharacter(character.id, { turnaroundSheetUrl: turnaround.publicUrl })

  return {
    ...(portrait && { portraitUrl: portrait.publicUrl }),
    ...(turnaround && { turnaroundUrl: turnaround.publicUrl }),
  }
}
