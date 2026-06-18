import type { ModelConfig } from '@excuse/shared'
import type { CanvasRuntimeLlmClient, CanvasRuntimeProviderAdapter, CanvasRuntimeRepoAdapter, CanvasRuntimeStorageAdapter } from '../adapter-types'
import type { CanvasProjectDetail } from '../normalize'
import { generateCanvasImageAsset } from '..'

type LocationRow = CanvasProjectDetail['locations'][number]

/**
 * 场景参考图 prompt 模板 — host 用于 createCanvasAsset.inputJson，core 内部用于生成。
 */
export function buildLocationRefPrompt(scenePrompt: string): string {
  return `${scenePrompt}, establishing shot, wide angle, cinematic lighting, no people, no characters, empty scene, uninhabited`
}

/**
 * 场景参考图生成核心（per-entity, 1-image）：ref image 生成 → persist。
 * Host 保留 per-entity 循环、skip-guards（locked/!scenePrompt/referenceImageUrl）、
 * 资产行 createCanvasAsset/markRunning/markFailed、per-entity notifyNode。
 */
export interface LocationRefAssetInput {
  location: LocationRow
  refAssetId: string
  imageModel: string
  imageModelConfig: ModelConfig
  client: CanvasRuntimeLlmClient
  storage: CanvasRuntimeStorageAdapter
  repo: CanvasRuntimeRepoAdapter
  provider: CanvasRuntimeProviderAdapter
}

export interface LocationRefAssetResult {
  refUrl?: string
}

export async function generateLocationRefAsset(input: LocationRefAssetInput): Promise<LocationRefAssetResult> {
  const prompt = buildLocationRefPrompt(input.location.scenePrompt!)

  const generated = await generateCanvasImageAsset({
    assetId: input.refAssetId,
    imageModel: input.imageModel,
    imageModelConfig: input.imageModelConfig,
    prompt,
    subDir: `canvas/${input.location.id}`,
    prefix: 'ref',
    errorMessage: '场景参考图生成失败',
    client: input.client,
    storage: input.storage,
    provider: input.provider,
    repo: input.repo,
  })

  if (!generated)
    return {}

  await input.repo.updateCanvasLocation(input.location.id, { referenceImageUrl: generated.publicUrl })
  return { refUrl: generated.publicUrl }
}
