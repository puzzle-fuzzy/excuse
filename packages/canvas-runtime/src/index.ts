import type { CanvasAssetOutput, CanvasShotReferenceAsset, GenerationInputParams } from '@excuse/db'
import type { PromptReferenceEntry } from '@excuse/prompt-engine'
import type { AssetStorage, DashScopeClient, ValidatedModelParameters } from '@excuse/provider'
import type { CanvasVideoReference, CanvasVideoVariant, ModelConfig } from '@excuse/shared'
import { calculateCost } from '@excuse/billing'
import {
  bindCanvasAssetTaskId,
  createCanvasAsset,
  createGenerationRecord,
  markCanvasAssetFailed,
  markCanvasAssetRunning,
  markCanvasAssetSucceeded,
  setCanvasAssetActive,
  updateCanvasShot,
} from '@excuse/db'
import {
  getModelById as getProviderModelById,
  validateAndMerge as validateProviderAndMerge,
} from '@excuse/provider'
import { extractBillingParams, recommendCanvasVideoVariant } from '@excuse/shared'

type CreateCanvasAssetInput = Parameters<typeof createCanvasAsset>[0]
type CanvasVideoResolution = '720P' | '1080P'

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

export interface CanvasVideoSubmitInput {
  accountId: string
  projectId: string
  shotId: string
  assetId: string
  model: string
  videoPrompt: string
  negativePrompt?: string | null
  duration: number
  referenceUrls: string[]
  client: DashScopeClient
  estimatedCost?: boolean
  diagnostics?: {
    workerTaskId?: string
    pipelineRunId?: string
    canvasAssetId?: string
  }
}

export interface CanvasVideoSubmitResult {
  taskId: string
  model: string
}

interface CanvasVideoParameters {
  prompt: string
  resolution: CanvasVideoResolution
  duration: number
  negative_prompt?: string
}

export interface PrepareCanvasVideoParamDeps {
  getModelById: typeof getProviderModelById
  validateAndMerge: typeof validateProviderAndMerge
}

const providerParamDeps: PrepareCanvasVideoParamDeps = {
  getModelById: getProviderModelById,
  validateAndMerge: validateProviderAndMerge,
}

export async function runCanvasAssetStep<T>(args: RunCanvasAssetStepInput<T>): Promise<T> {
  const asset = await createCanvasAsset(args.asset)

  try {
    await markCanvasAssetRunning(asset.id)
    const { result, output } = await args.execute(asset.id)
    await markCanvasAssetSucceeded(asset.id, output)
    if (args.setActive ?? true)
      await setCanvasAssetActive(asset.id)
    return result
  }
  catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await markCanvasAssetFailed(asset.id, errorMessage).catch(() => {})
    throw error
  }
}

export async function generateCanvasImageAsset(
  input: GenerateCanvasImageAssetInput,
): Promise<GeneratedCanvasImageAsset | null> {
  const validation = validateProviderAndMerge(input.imageModelConfig, {
    prompt: input.prompt,
    size: '2048*2048',
    n: 1,
  })
  if (!validation.ok) {
    const detail = validation.errors.map(error => `${error.field}: ${error.message}`).join('; ')
    throw new Error(`参数校验失败：${detail}`)
  }

  const result = await input.client.generateImage(input.imageModel, validation.params)
  if (result.type === 'failed')
    throw new Error(result.error || input.errorMessage)

  const urls = result.output.urls
  if (!Array.isArray(urls) || urls.length === 0)
    return null

  const providerUrls = urls as string[]
  const savedUrls = await input.storage.downloadAndMap(providerUrls, input.subDir, input.prefix)
  const publicUrl = savedUrls[0] || providerUrls[0]!
  const outputJson: CanvasAssetOutput = { type: 'image', urls: savedUrls.length > 0 ? savedUrls : urls }
  await markCanvasAssetSucceeded(input.assetId, outputJson, publicUrl, savedUrls[0] ?? undefined, providerUrls[0], undefined)
  await setCanvasAssetActive(input.assetId)

  return {
    publicUrl,
    savedUrls,
    providerUrls,
  }
}

// ===== 视频模型推荐与引用解析 =====

/** 变体降级优先级：i2v → r2v → t2v；r2v → t2v；t2v 不降级 */
const VARIANT_FALLBACK: Record<CanvasVideoVariant, CanvasVideoVariant[]> = {
  i2v: ['i2v', 'r2v', 't2v'],
  r2v: ['r2v', 't2v'],
  t2v: ['t2v'],
}

/** recommendCanvasVideoModel 的完整输出：model id + 变体 + 中文原因 */
export interface CanvasVideoModelRecommendation {
  model: string
  variant: CanvasVideoVariant
  reason: string
}

/**
 * 带能力降级的镜头视频模型推荐。
 *
 * 1. 调用 @excuse/shared 纯规则 `recommendCanvasVideoVariant(refs)` 确定目标变体。
 * 2. 检查所选 base 模型是否真有该变体；若无，沿降级链回退。
 * 3. 返回最终 model id + 实际变体 + 原因（降级时追加说明）。
 */
export function recommendCanvasVideoModel(
  prefs: { videoModel?: string | null } | null | undefined,
  references: ReadonlyArray<CanvasVideoReference>,
): CanvasVideoModelRecommendation {
  const base = (prefs?.videoModel || 'happyhorse-1.0').replace(/-r2v$|-t2v$|-i2v$/, '')
  const desired = recommendCanvasVideoVariant(references)

  const availableVariant = VARIANT_FALLBACK[desired.variant].find(
    variant => getProviderModelById(`${base}-${variant}`),
  ) ?? 't2v'

  const downgraded = availableVariant !== desired.variant
  const reason = downgraded
    ? `${desired.reason}（当前模型无 ${desired.variant.toUpperCase()} 变体，已降级为 ${availableVariant.toUpperCase()}）`
    : desired.reason

  return {
    model: `${base}-${availableVariant}`,
    variant: availableVariant,
    reason,
  }
}

/** @deprecated 使用 recommendCanvasVideoModel 获取带原因的推荐；本函数仅按数量做 t2v/r2v 回退 */
export function getCanvasVideoModel(
  prefs: { videoModel?: string | null } | null | undefined,
  referenceUrls: string[],
): string {
  const base = (prefs?.videoModel || 'happyhorse-1.0').replace(/-r2v$|-t2v$|-i2v$/, '')
  return referenceUrls.length > 0 ? `${base}-r2v` : `${base}-t2v`
}

// ===== 镜头视频引用解析（带 role） =====

/**
 * resolveShotVideoReferences 的输入——只需 shots/characters/locations 的关键字段。
 * 结构化类型让调用方不必传入整个 CanvasProjectDetail。
 */
export interface ResolveShotVideoReferencesInput {
  shot: {
    characterIdsJson: string[]
    locationId: string | null
    referenceAssetsJson?: CanvasShotReferenceAsset[] | null
  }
  characters: ReadonlyArray<{ id: string, turnaroundSheetUrl?: string | null, referenceImageUrl?: string | null }>
  locations: ReadonlyArray<{ id: string, referenceImageUrl?: string | null }>
}

/**
 * 解析镜头视频引用为带 role 的参考列表。
 *
 * 顺序：角色自动引用 → 场景自动引用 → 用户额外引用（referenceAssetsJson）。
 * 按 URL 去重，保留首次出现。与历史 dedupe([...char, loc, ...extra]) 等价，
 * 但保留 role 供推荐函数使用。
 *
 * 角色图优先取 turnaroundSheetUrl（三视图，跨镜头一致性更好，对齐阶段二风险笔记），
 * 缺失才回退 referenceImageUrl（单张肖像）。角色/场景 ref 附 characterId/locationId，
 * 供 rebuild 阶段把 prompt 角色指代烘焙成 `[Image N]`。
 */
export function resolveShotVideoReferences(
  input: ResolveShotVideoReferencesInput,
): CanvasVideoReference[] {
  const characterMap = new Map(input.characters.map(c => [c.id, c]))
  const locationMap = new Map(input.locations.map(l => [l.id, l]))

  const refs: CanvasVideoReference[] = []

  for (const id of input.shot.characterIdsJson) {
    const character = characterMap.get(id)
    // 优先 turnaround 三视图（跨镜头角色一致性更好），回退 portrait 肖像。
    const url = character?.turnaroundSheetUrl || character?.referenceImageUrl
    if (url)
      refs.push({ url, role: 'character', characterId: id })
  }

  if (input.shot.locationId) {
    const url = locationMap.get(input.shot.locationId)?.referenceImageUrl
    if (url)
      refs.push({ url, role: 'location', locationId: input.shot.locationId })
  }

  for (const asset of input.shot.referenceAssetsJson ?? []) {
    if (asset.url)
      refs.push({ url: asset.url, role: asset.role })
  }

  // 按 URL 去重，保留首次出现
  const seen = new Set<string>()
  return refs.filter((ref) => {
    if (seen.has(ref.url))
      return false
    seen.add(ref.url)
    return true
  })
}

/**
 * 把 resolveShotVideoReferences 的结果转换为 prompt builder 用的参考图指代条目。
 *
 * imageNumber = 该 ref 在去重后数组中的 1-based 位置，**必须**与 submit 时发出的
 * referenceUrls 顺序一致（同一 resolveShotVideoReferences 纯函数保证）。仅取带
 * characterId/locationId 的角色/场景自动引用——用户额外引用（referenceAssetsJson）
 * 不指代具体角色，prompt 仍用文字描述。
 */
export function toPromptReferenceEntries(
  references: ReadonlyArray<CanvasVideoReference>,
): PromptReferenceEntry[] {
  const entries: PromptReferenceEntry[] = []
  references.forEach((ref, index) => {
    const targetId = ref.characterId ?? ref.locationId
    if (targetId)
      entries.push({ targetId, imageNumber: index + 1 })
  })
  return entries
}

export async function submitCanvasShotVideo(
  input: CanvasVideoSubmitInput,
): Promise<CanvasVideoSubmitResult> {
  // i2v 模型需要 first_frame_url 参数——取第一张参考图作为首帧。
  // prepareCanvasVideoParams 只在模型声明 first_frame_url 时注入，r2v/t2v 不声明则自动忽略。
  const firstFrameUrl = input.referenceUrls.length > 0
    ? input.referenceUrls[0]
    : undefined

  const { params: videoParams } = prepareCanvasVideoParams(input.model, {
    videoPrompt: input.videoPrompt,
    negativePrompt: input.negativePrompt,
    duration: input.duration,
    firstFrameUrl,
  })

  const submitResult = await input.client.submitVideoTaskWithFallback(
    input.model,
    videoParams,
    input.referenceUrls.length > 0 ? input.referenceUrls : undefined,
  )

  if (!submitResult.success || !submitResult.taskId)
    throw new Error(submitResult.error ?? '视频提交失败')

  await bindCanvasAssetTaskId(input.assetId, submitResult.taskId)
  await updateCanvasShot(input.shotId, {
    videoTaskId: submitResult.taskId,
    status: 'generating',
  })

  const usedModelConfig = getProviderModelById(submitResult.model)!
  const inputParams: GenerationInputParams = {
    source: 'canvas',
    projectId: input.projectId,
    shotId: input.shotId,
    workerTaskId: input.diagnostics?.workerTaskId,
    pipelineRunId: input.diagnostics?.pipelineRunId,
    canvasAssetId: input.diagnostics?.canvasAssetId ?? input.assetId,
    ...videoParams,
  }
  const cost = calculateCost(usedModelConfig, extractBillingParams(videoParams))
  await createGenerationRecord({
    accountId: input.accountId,
    taskId: submitResult.taskId,
    model: submitResult.model,
    category: 'video',
    status: 'processing',
    inputParams,
    cost: input.estimatedCost ? { ...cost, estimated: true } : cost,
  })

  return {
    taskId: submitResult.taskId,
    model: submitResult.model,
  }
}

export function prepareCanvasVideoParams(
  model: string,
  shot: { videoPrompt: string, negativePrompt?: string | null, duration: number, firstFrameUrl?: string },
  deps: PrepareCanvasVideoParamDeps = providerParamDeps,
): { modelConfig: ReturnType<typeof deps.getModelById>, params: ValidatedModelParameters } {
  const modelConfig = deps.getModelById(model)
  if (!modelConfig)
    throw new Error(`未知视频模型：${model}`)

  const declaredParams = new Set(modelConfig.parameters.map(parameter => parameter.name))
  const rawParams: Record<string, unknown> = {
    prompt: shot.videoPrompt.slice(0, 2500),
    resolution: '720P',
    duration: shot.duration,
  }

  if (declaredParams.has('negative_prompt') && shot.negativePrompt)
    rawParams.negative_prompt = shot.negativePrompt

  // i2v 模型声明 first_frame_url 参数——注入首帧 URL（applyMappings 会映射到 media[first_frame]）
  if (declaredParams.has('first_frame_url') && shot.firstFrameUrl)
    rawParams.first_frame_url = shot.firstFrameUrl

  const validationResult = deps.validateAndMerge(modelConfig, rawParams)
  if (!validationResult.ok) {
    const detail = validationResult.errors.map(error => `${error.field}: ${error.message}`).join('; ')
    throw new Error(`视频参数校验失败：${detail}`)
  }

  parseCanvasVideoParameters(validationResult.params)
  return {
    modelConfig,
    params: validationResult.params,
  }
}

function parseCanvasVideoParameters(value: ValidatedModelParameters): CanvasVideoParameters {
  const prompt = value.prompt
  if (typeof prompt !== 'string' || prompt.length === 0)
    throw new Error('视频参数校验失败：prompt 必须是非空字符串')

  const resolution = value.resolution
  if (resolution !== '720P' && resolution !== '1080P')
    throw new Error('视频参数校验失败：resolution 必须是 720P 或 1080P')

  const duration = value.duration
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0)
    throw new Error('视频参数校验失败：duration 必须是正数')

  const negativePrompt = value.negative_prompt
  if (negativePrompt !== undefined && typeof negativePrompt !== 'string')
    throw new Error('视频参数校验失败：negative_prompt 必须是字符串')

  return {
    prompt,
    resolution,
    duration,
    ...(negativePrompt !== undefined && { negative_prompt: negativePrompt }),
  }
}

export * from './llm-helpers'
export * from './normalize'
export * from './phases/analysis'
export * from './phases/character-refs'
export * from './phases/characters'
export * from './phases/continuity'
export * from './phases/location-refs'
export * from './phases/locations'
export * from './phases/rebuild'
export * from './phases/storyboard'
export * from './phases/videos'
