/**
 * Canvas 资产步骤执行（IO 层）
 *
 * runCanvasAssetStep 和 generateCanvasImageAsset 涉及 DB/Provider 调用。
 */

import type { CanvasAssetOutput } from '@excuse/db'
import type { ModelConfig } from '@excuse/shared'
import type { AssetStorage, DashScopeClient } from '@excuse/provider'
import {
  createCanvasAsset,
  markCanvasAssetFailed,
  markCanvasAssetRunning,
  markCanvasAssetSucceeded,
  setCanvasAssetActive,
} from '@excuse/db'
import { validateAndMerge } from '@excuse/provider'

type CreateCanvasAssetInput = Parameters<typeof createCanvasAsset>[0]

export interface RunCanvasAssetStepInput<T> {
  asset: CreateCanvasAssetInput
  execute: (assetId: string) => Promise<{ result: T, output: CanvasAssetOutput }>
  setActive?: boolean
}

export interface GenerateCanvasImageAssetInput {
  assetId: string
  imageModel: string
  imageModelConfig: ModelConfig
  prompt: string
  subDir: string
  prefix: string
  errorMessage: string
  client: DashScopeClient
  storage: AssetStorage
}

export interface GeneratedCanvasImageAsset {
  publicUrl: string
  savedUrls: string[]
  providerUrls: string[]
}

/**
 * 创建 canvas_asset + 执行 + 标记成功/活跃
 */
export async function runCanvasAssetStep<T>(args: RunCanvasAssetStepInput<T>): Promise<T> {
  const asset = await createCanvasAsset(args.asset)
  try {
    await markCanvasAssetRunning(asset.id)
    const { result, output } = await args.execute(asset.id)
    await markCanvasAssetSucceeded(asset.id, output)
    if (args.setActive ?? true) await setCanvasAssetActive(asset.id)
    return result
  }
  catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await markCanvasAssetFailed(asset.id, errorMessage).catch(() => {})
    throw error
  }
}

/**
 * 生成图片资产：provider 调用 → 下载 → 标记活跃
 */
export async function generateCanvasImageAsset(
  input: GenerateCanvasImageAssetInput,
): Promise<GeneratedCanvasImageAsset | null> {
  const validation = validateAndMerge(input.imageModelConfig, {
    prompt: input.prompt,
    size: '2048*2048',
    n: 1,
  })
  if (!validation.ok) {
    const detail = validation.errors.map(error => `${error.field}: ${error.message}`).join('; ')
    throw new Error(`参数校验失败：${detail}`)
  }

  const result = await input.client.generateImage(input.imageModel, validation.params)
  if (result.type === 'failed') throw new Error(result.error || input.errorMessage)

  const urls = result.output.urls
  if (!Array.isArray(urls) || urls.length === 0) return null

  const providerUrls = urls as string[]
  const savedUrls = await input.storage.downloadAndMap(providerUrls, input.subDir, input.prefix)
  const publicUrl = savedUrls[0] || providerUrls[0]!
  const outputJson: CanvasAssetOutput = { type: 'image', urls: savedUrls.length > 0 ? savedUrls : urls }
  await markCanvasAssetSucceeded(input.assetId, outputJson, publicUrl, savedUrls[0] ?? undefined, providerUrls[0], undefined)
  await setCanvasAssetActive(input.assetId)

  return { publicUrl, savedUrls, providerUrls }
}
