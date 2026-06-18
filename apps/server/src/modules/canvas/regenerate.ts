/**
 * 单个实体重新生成服务 — 创建同级节点（不删除旧实体）
 *
 * 角色重新生成: 用项目的 analysis + 角色 name 重新调用 LLM 生成新 profile，创建新角色行
 * 场景重新生成: 同上
 * 镜头视频重新生成: 复制镜头数据创建新镜头行，提交视频任务
 */
import type { CanvasAssetOutput } from '@excuse/db'
import type { DashScopeClient } from '@excuse/provider'
import { characterProfileSchema, locationProfileSchema } from '@excuse/canvas-engine'
import { runCanvasAssetStep, submitShotVideoEntity } from '@excuse/canvas-runtime'
import {
  createCanvasAsset,
  createCanvasCharacter,
  createCanvasLocation,
  createCanvasShot,
  getCanvasCharacterById,
  getCanvasLocationById,
  getCanvasProjectById,
  getCanvasProjectDetail,
  getCanvasShotById,
  markCanvasAssetFailed,
  markCanvasAssetRunning,
} from '@excuse/db'
import {
  buildCharacterPrompt,
  buildLocationPrompt,
  parseLLMJsonWithSchema,
} from '@excuse/prompt-engine'
import { getModelById as getProviderModelById, validateAndMerge } from '@excuse/provider'
import { logger } from '@excuse/shared'
import { BadRequestError, ConflictError, InternalError, NotFoundError, ValidationError } from '../../utils/app-errors'
import { createServerProviderAdapter, createServerRepoAdapter } from './adapter-factory'
import { getTextModel, getVideoModel, notifyNode } from './service-helpers'

// ── 角色重新生成 ──────────────────────────────────────

export async function regenerateCharacter(characterId: string, client: DashScopeClient) {
  const character = await getCanvasCharacterById(characterId)
  if (!character)
    throw new NotFoundError('角色不存在')

  const project = await getCanvasProjectById(character.projectId)
  if (!project)
    throw new NotFoundError('项目不存在')
  if (!project.analysisJson)
    throw new ConflictError('项目尚未分析，请先完成分析阶段')

  const analysis = project.analysisJson!
  const accountId = project.accountId
  const name = character.name
  const textModel = getTextModel(project.modelPreferencesJson)
  const repo = createServerRepoAdapter()

  notifyNode(accountId, character.projectId, 'character', characterId, 'running')

  try {
    const { newCharacter, profile } = await runCanvasAssetStep({
      repo,
      asset: {
        accountId,
        projectId: character.projectId,
        category: 'characterProfile',
        targetEntityType: 'character',
        targetEntityId: characterId,
        model: textModel,
      },
      execute: async () => {
        const { system, prompt: userPrompt } = buildCharacterPrompt(project.storyText, analysis, name)
        const modelConfig = getProviderModelById(textModel)
        if (!modelConfig)
          throw new BadRequestError(`未知文本模型：${textModel}`)

        const rawParams: Record<string, unknown> = {
          prompt: `${system}\n\n${userPrompt}`,
          max_tokens: 4096,
          temperature: 0.7,
        }
        const validationResult = validateAndMerge(modelConfig, rawParams)
        if (!validationResult.ok) {
          const detail = validationResult.errors.map(e => `${e.field}: ${e.message}`).join('; ')
          throw new ValidationError(`参数校验失败：${detail}`)
        }

        const result = await client.chatCompletion(textModel, validationResult.params)
        if (result.type === 'failed')
          throw new InternalError(result.error || '角色重新生成失败')

        const profile = parseLLMJsonWithSchema(result.output.text as string, characterProfileSchema)
        const newCharacter = await createCanvasCharacter({
          projectId: character.projectId,
          name: profile.name || name,
          role: profile.role,
          description: `${profile.age} ${profile.gender} ${profile.bodyShape}`,
          identityPrompt: profile.identityPrompt,
          negativePrompt: profile.negativePrompt,
          profileJson: profile,
        })

        const output: CanvasAssetOutput = { type: 'json', data: { ...profile } }
        return { result: { newCharacter, profile }, output }
      },
    })

    notifyNode(accountId, character.projectId, 'character', newCharacter.id, 'completed', { name: profile.name, profile })
    return newCharacter
  }
  catch (error) {
    const errorMessage = (error as Error).message
    notifyNode(accountId, character.projectId, 'character', characterId, 'failed', undefined, errorMessage)
    throw error
  }
}

// ── 场景重新生成 ──────────────────────────────────────

export async function regenerateLocation(locationId: string, client: DashScopeClient) {
  const location = await getCanvasLocationById(locationId)
  if (!location)
    throw new NotFoundError('场景不存在')

  const project = await getCanvasProjectById(location.projectId)
  if (!project)
    throw new NotFoundError('项目不存在')
  if (!project.analysisJson)
    throw new ConflictError('项目尚未分析，请先完成分析阶段')

  const analysis = project.analysisJson!
  const accountId = project.accountId
  const name = location.name
  const textModel = getTextModel(project.modelPreferencesJson)
  const repo = createServerRepoAdapter()

  notifyNode(accountId, location.projectId, 'location', locationId, 'running')

  try {
    const { newLocation, profile } = await runCanvasAssetStep({
      repo,
      asset: {
        accountId,
        projectId: location.projectId,
        category: 'locationProfile',
        targetEntityType: 'location',
        targetEntityId: locationId,
        model: textModel,
      },
      execute: async () => {
        const { system, prompt: userPrompt } = buildLocationPrompt(project.storyText, analysis, name)
        const modelConfig = getProviderModelById(textModel)
        if (!modelConfig)
          throw new BadRequestError(`未知文本模型：${textModel}`)

        const rawParams: Record<string, unknown> = {
          prompt: `${system}\n\n${userPrompt}`,
          max_tokens: 4096,
          temperature: 0.7,
        }
        const validationResult = validateAndMerge(modelConfig, rawParams)
        if (!validationResult.ok) {
          const detail = validationResult.errors.map(e => `${e.field}: ${e.message}`).join('; ')
          throw new ValidationError(`参数校验失败：${detail}`)
        }

        const result = await client.chatCompletion(textModel, validationResult.params)
        if (result.type === 'failed')
          throw new InternalError(result.error || '场景重新生成失败')

        const profile = parseLLMJsonWithSchema(result.output.text as string, locationProfileSchema)
        const newLocation = await createCanvasLocation({
          projectId: location.projectId,
          name: profile.name || name,
          type: profile.type,
          profileJson: profile,
          scenePrompt: profile.scenePrompt,
          negativePrompt: profile.negativePrompt,
        })

        const output: CanvasAssetOutput = { type: 'json', data: { ...profile } }
        return { result: { newLocation, profile }, output }
      },
    })

    notifyNode(accountId, location.projectId, 'location', newLocation.id, 'completed', { name: profile.name, profile })
    return newLocation
  }
  catch (error) {
    const errorMessage = (error as Error).message
    notifyNode(accountId, location.projectId, 'location', locationId, 'failed', undefined, errorMessage)
    throw error
  }
}

// ── 镜头视频重新生成（创建同级变体）──────────────────

export async function regenerateShotVideo(shotId: string, client: DashScopeClient) {
  const shot = await getCanvasShotById(shotId)
  if (!shot)
    throw new NotFoundError('镜头不存在')

  const project = await getCanvasProjectById(shot.projectId)
  if (!project)
    throw new NotFoundError('项目不存在')

  const accountId = project.accountId

  // 创建同级镜头 — 复制原镜头数据但用新 ID
  const newShot = await createCanvasShot({
    projectId: shot.projectId,
    shotIndex: shot.shotIndex + 0.5, // 紧接原镜头之后（后续排序会重新分配整数索引）
    duration: shot.duration,
    locationId: shot.locationId,
    characterIdsJson: shot.characterIdsJson,
    narrative: shot.narrative,
    cameraJson: shot.cameraJson,
    continuityJson: shot.continuityJson,
    timelineJson: shot.timelineJson,
    environmentJson: shot.environmentJson,
    videoPrompt: shot.videoPrompt,
    negativePrompt: shot.negativePrompt,
    referenceAssetsJson: shot.referenceAssetsJson ?? [],
    status: 'draft',
  })

  notifyNode(accountId, shot.projectId, 'shot', newShot.id, 'running')

  // ── 为镜头视频创建 canvas_asset ──────────────────
  const shotVideoAsset = await createCanvasAsset({
    accountId,
    projectId: shot.projectId,
    category: 'shotVideo',
    targetEntityType: 'shot',
    targetEntityId: newShot.id,
    model: getVideoModel(project.modelPreferencesJson, []),
  })
  await markCanvasAssetRunning(shotVideoAsset.id)

  try {
    const projectDetail = await getCanvasProjectDetail(shot.projectId)
    if (!projectDetail)
      throw new NotFoundError('项目详情不存在')

    const repo = createServerRepoAdapter()
    const provider = createServerProviderAdapter()

    await submitShotVideoEntity({
      projectId: shot.projectId,
      accountId,
      shotId: newShot.id,
      assetId: shotVideoAsset.id,
      shot: newShot,
      characters: projectDetail.characters,
      locations: projectDetail.locations,
      modelPreferences: project.modelPreferencesJson,
      client,
      repo,
      provider,
    })

    return newShot
  }
  catch (error) {
    const errorMessage = (error as Error).message
    // ── 标记视频资产失败 ──────────────────────────
    await markCanvasAssetFailed(shotVideoAsset.id, errorMessage).catch(err => logger.warn({ err, assetId: shotVideoAsset.id }, 'markCanvasAssetFailed failed in error path'))
    notifyNode(accountId, shot.projectId, 'shot', newShot.id, 'failed', undefined, errorMessage)
    throw error
  }
}
