/**
 * Canvas 视频提交（IO 层）
 *
 * submitCanvasShotVideo 涉及 DashScope + DB 调用。
 * prepareCanvasVideoParams 涉及 provider 参数校验。
 */

import type { GenerationInputParams } from '@excuse/shared'
import type { CanvasRuntimeProviderAdapter, CanvasRuntimeRepoAdapter, ValidatedModelParameters } from '../adapter-types'
import type { CanvasVideoSubmitInput, CanvasVideoSubmitResult } from './types'
import { calculateCost } from '@excuse/billing'
import { extractBillingParams } from '@excuse/shared'

type CanvasVideoResolution = '720P' | '1080P'

interface CanvasVideoParameters {
  prompt: string
  resolution: CanvasVideoResolution
  duration: number
  negative_prompt?: string
}

export interface CanvasVideoSubmitFullInput extends CanvasVideoSubmitInput {
  repo: CanvasRuntimeRepoAdapter
  provider: CanvasRuntimeProviderAdapter
}

export async function submitCanvasShotVideo(
  input: CanvasVideoSubmitFullInput,
): Promise<CanvasVideoSubmitResult> {
  const firstFrameUrl = input.referenceUrls.length > 0
    ? input.referenceUrls[0]
    : undefined

  const { params: videoParams } = prepareCanvasVideoParams(input.model, {
    videoPrompt: input.videoPrompt,
    negativePrompt: input.negativePrompt,
    duration: input.duration,
    firstFrameUrl,
  }, input.provider)

  const submitResult = await input.client.submitVideoTaskWithFallback(
    input.model,
    videoParams,
    input.referenceUrls.length > 0 ? input.referenceUrls : undefined,
  )

  if (!submitResult.success || !submitResult.taskId) {
    // 透传 provider 传输层错误码（TIMEOUT/ECONNRESET）给 task-engine，进入可重试分类
    const err = new Error(submitResult.error ?? '视频提交失败')
    if (submitResult.code)
      (err as Error & { cause?: { code?: string } }).cause = { code: submitResult.code }
    throw err
  }

  await input.repo.bindCanvasAssetTaskId(input.assetId, submitResult.taskId)
  await input.repo.updateCanvasShot(input.shotId, {
    videoTaskId: submitResult.taskId,
    status: 'generating',
  })

  const usedModelConfig = input.provider.getModelById(submitResult.model)!
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
  await input.repo.createGenerationRecord({
    accountId: input.accountId,
    taskId: submitResult.taskId,
    model: submitResult.model,
    category: 'video',
    status: 'processing',
    inputParams,
    cost: input.estimatedCost ? { ...cost, estimated: true } : cost,
  })

  return { taskId: submitResult.taskId, model: submitResult.model }
}

export function prepareCanvasVideoParams(
  model: string,
  shot: { videoPrompt: string, negativePrompt?: string | null, duration: number, firstFrameUrl?: string },
  provider: CanvasRuntimeProviderAdapter,
): { modelConfig: ReturnType<CanvasRuntimeProviderAdapter['getModelById']>, params: ValidatedModelParameters } {
  const modelConfig = provider.getModelById(model)
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
  if (declaredParams.has('first_frame_url') && shot.firstFrameUrl)
    rawParams.first_frame_url = shot.firstFrameUrl

  const validationResult = provider.validateAndMerge(modelConfig, rawParams)
  if (!validationResult.ok) {
    const detail = validationResult.errors.map(error => `${error.field}: ${error.message}`).join('; ')
    throw new Error(`视频参数校验失败：${detail}`)
  }

  parseCanvasVideoParameters(validationResult.params)
  return { modelConfig, params: validationResult.params }
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
