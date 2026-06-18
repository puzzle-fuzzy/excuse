/**
 * Canvas 资产步骤执行（IO 层）
 *
 * runCanvasAssetStep 和 generateCanvasImageAsset 涉及 DB/Provider 调用。
 */

import type { CanvasAssetOutput, ModelConfig } from '@excuse/shared'
import type { CanvasRuntimeLlmClient, CanvasRuntimeProviderAdapter, CanvasRuntimeRepoAdapter, CanvasRuntimeStorageAdapter } from '../adapter-types'

type CreateCanvasAssetInput = Parameters<CanvasRuntimeRepoAdapter['createCanvasAsset']>[0]

export interface RunCanvasAssetStepInput<T> {
  asset: CreateCanvasAssetInput
  execute: (assetId: string) => Promise<{ result: T, output: CanvasAssetOutput }>
  setActive?: boolean
  repo: CanvasRuntimeRepoAdapter
}

export interface GenerateCanvasImageAssetInput {
  assetId: string
  imageModel: string
  imageModelConfig: ModelConfig
  prompt: string
  subDir: string
  prefix: string
  errorMessage: string
  client: CanvasRuntimeLlmClient
  storage: CanvasRuntimeStorageAdapter
  provider: CanvasRuntimeProviderAdapter
  repo: CanvasRuntimeRepoAdapter
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
  const asset = await args.repo.createCanvasAsset(args.asset)
  try {
    await args.repo.markCanvasAssetRunning(asset.id)
    const { result, output } = await args.execute(asset.id)
    await args.repo.markCanvasAssetSucceeded(asset.id, output)
    if (args.setActive ?? true)
      await args.repo.setCanvasAssetActive(asset.id)
    return result
  }
  catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await args.repo.markCanvasAssetFailed(asset.id, errorMessage).catch(() => {})
    throw error
  }
}

/**
 * 生成图片资产：provider 调用 → 下载 → 标记活跃
 */
export async function generateCanvasImageAsset(
  input: GenerateCanvasImageAssetInput,
): Promise<GeneratedCanvasImageAsset | null> {
  const validation = input.provider.validateAndMerge(input.imageModelConfig, {
    prompt: input.prompt,
    size: '2048*2048',
    n: 1,
  })
  if (!validation.ok) {
    const detail = validation.errors.map(error => `${error.field}: ${error.message}`).join('; ')
    throw new Error(`参数校验失败：${detail}`)
  }

  const result = await input.client.generateImage(input.imageModel, validation.params)
  if (result.type === 'failed') {
    // 透传 provider 传输层错误码（TIMEOUT/ECONNRESET）给 task-engine，进入可重试分类
    const err = new Error(result.error || input.errorMessage)
    if (result.code)
      (err as Error & { cause?: { code?: string } }).cause = { code: result.code }
    throw err
  }

  const urls = result.output.urls
  if (!Array.isArray(urls) || urls.length === 0)
    return null

  const providerUrls = urls as string[]
  const savedUrls = await input.storage.downloadAndMap(providerUrls, input.subDir, input.prefix)
  const publicUrl = savedUrls[0] || providerUrls[0]!
  const outputJson: CanvasAssetOutput = { type: 'image', urls: savedUrls.length > 0 ? savedUrls : urls }
  await input.repo.markCanvasAssetSucceeded(input.assetId, outputJson, publicUrl, savedUrls[0] ?? undefined, providerUrls[0], undefined)
  await input.repo.setCanvasAssetActive(input.assetId)

  return { publicUrl, savedUrls, providerUrls }
}
