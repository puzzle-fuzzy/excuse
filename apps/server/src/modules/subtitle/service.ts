/**
 * 字幕生成核心业务服务
 *
 * 职责：
 *   1. 创建字幕项目 — 上传视频 → 创建 DB 记录 → 提取音频 → 提交 ASR
 *   2. 智能重试失败项目 — 根据已有进度跳过已完成的步骤
 *
 * ASR 完成和导出处理由 Worker 负责（subtitle-processor.ts）。
 * 服务端只做项目创建和状态准备，不做 FFmpeg 等耗时操作。
 */

import type { SubtitleProjectRow } from '@excuse/db'
import type {
  ASRClient,
  AssetStorage,
} from '@excuse/provider'
import type { ServerConfig } from '../../config'
import { calculateCost } from '@excuse/billing'
import {
  createGenerationRecord,
  createSubtitleProject,
  getSubtitleProjectForAccount,
  getUploadedFileById,
  notifyGenerationStatus,
  updateSubtitleProjectStatus,
} from '@excuse/db'
import {
  extractAudioFromVideo,
  getMediaDurationMs,
} from '@excuse/provider'
import { getDefaultStyleConfig } from '@excuse/shared'
import { pushNotification } from '../../routes/notifications'

/** 字幕项目依赖的外部服务 */
export interface SubtitleDependencies {
  asrClient: ASRClient
  storage: AssetStorage
}

/**
 * 创建字幕项目 — 上传视频 + 提取音频 + 创建 DB 记录
 *
 * 流程：
 *   1. 校验视频文件归属
 *   2. 创建 subtitle_project DB 记录（draft 状态）
 *   3. 用 FFmpeg 从视频提取音频
 *   4. 获取视频时长
 *   5. 更新项目状态为 extracting_audio → asr_processing
 *   6. 提交 ASR 任务
 *   7. 创建 generation_record 关联
 *   8. 更新项目 asrRecordId
 *   9. SSE 推送状态变更
 */
export async function createAndStartProject(
  accountId: string,
  videoFileId: string,
  config: ServerConfig,
  deps: SubtitleDependencies,
): Promise<SubtitleProjectRow> {
  // 1. 校验视频文件存在
  const file = await getUploadedFileById(videoFileId)
  if (!file || file.accountId !== accountId) {
    throw new Error('视频文件不存在或不属于当前用户')
  }

  // 2. 创建 subtitle_project 记录
  const project = await createSubtitleProject({
    accountId,
    videoFileId,
    videoUrl: file.publicUrl,
    status: 'draft',
    styleConfig: getDefaultStyleConfig(),
  })

  try {
    // 3. 提取音频
    await updateSubtitleProjectStatus(project.id, 'extracting_audio')

    // 下载视频到本地（如果是 OSS URL）
    const videoPath = file.publicUrl.startsWith('/') || file.publicUrl.startsWith('./')
      ? `${config.storageRoot}/${file.storagePath}`
      : file.publicUrl

    const { audioPath, durationMs: audioDurationMs } = await extractAudioFromVideo(videoPath, config.storageRoot)
    const videoDurationMs = await getMediaDurationMs(videoPath)

    // 上传音频到存储
    const audioBuffer = await Bun.file(audioPath).arrayBuffer()
    const audioFileUrl = await deps.storage.uploadGenerated(
      Buffer.from(audioBuffer),
      `subtitle/audio_${project.id}.wav`,
      'audio/wav',
    )

    // 清理本地临时文件
    try {
      await Bun.file(audioPath).delete()
    }
    catch {}

    // 4. 提交 ASR 任务
    await updateSubtitleProjectStatus(project.id, 'asr_processing', {
      audioFileUrl,
      videoDurationMs: videoDurationMs || audioDurationMs,
    })

    const asrResult = await deps.asrClient.submitTranscription(audioFileUrl)

    if (!asrResult.success) {
      await updateSubtitleProjectStatus(project.id, 'failed', { errorMessage: asrResult.error })
      await pushNotification({
        accountId,
        type: 'task_failed',
        title: '字幕识别提交失败',
        body: asrResult.error,
        meta: { recordId: project.id, category: 'subtitle' },
      }).catch(() => {})
      const failedProject = await getSubtitleProjectForAccount(project.id, accountId)
      return failedProject!
    }

    // 5. 创建 generation_record 关联
    // Paraformer-v2 定价: 0.00008元/秒 = 0.008分/秒，按音频时长计费
    const audioDurationSec = (videoDurationMs || audioDurationMs) / 1000
    const estimatedCost = calculateCost(
      { id: 'paraformer-v2', category: 'subtitle', pricing: { inputPriceCents: 0.008, unit: 'audio' } },
      { duration: audioDurationSec },
    )

    const asrRecord = await createGenerationRecord({
      accountId,
      taskId: asrResult.taskId,
      traceId: crypto.randomUUID(),
      model: 'paraformer-v2',
      category: 'subtitle',
      status: 'processing',
      inputParams: { audioUrl: audioFileUrl, projectId: project.id },
      cost: { ...estimatedCost, estimated: true, billable: false, source: 'estimated' },
    })

    // 6. 更新项目 asrRecordId
    await updateSubtitleProjectStatus(project.id, 'asr_processing', { asrRecordId: asrRecord.id })

    // 7. SSE 通知
    await notifyGenerationStatus({
      accountId,
      recordId: asrRecord.id,
      status: 'processing',
      category: 'subtitle',
      model: 'paraformer-v2',
      taskId: asrResult.taskId,
      traceId: asrRecord.traceId ?? undefined,
    })

    const finalProject = await getSubtitleProjectForAccount(project.id, accountId)
    return finalProject!
  }
  catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    await updateSubtitleProjectStatus(project.id, 'failed', { errorMessage: errorMsg })
    await pushNotification({
      accountId,
      type: 'task_failed',
      title: '字幕项目创建失败',
      body: errorMsg,
      meta: { recordId: project.id, category: 'subtitle' },
    }).catch(() => {})
    throw err
  }
}

/**
 * 智能重试失败项目 — 根据已有进度跳过已完成的步骤
 *
 * 判断逻辑：
 *   - sentences 存在 → ASR 已完成，只需回到 subtitle_editing 状态让用户重新导出
 *   - audioFileUrl 存在 → 音频已提取，只需重新提交 ASR
 *   - 都不存在 → 从头开始（提取音频 + ASR）
 */
export async function retryProject(
  project: SubtitleProjectRow,
  accountId: string,
  config: ServerConfig,
  deps: SubtitleDependencies,
): Promise<SubtitleProjectRow> {
  // 清除错误信息
  await updateSubtitleProjectStatus(project.id, 'draft', { errorMessage: null })

  // 判断已有进度
  if (project.sentences && project.sentences.length > 0) {
    // ASR 已完成，句子已提取 → 回到编辑状态，用户可以重新导出
    await updateSubtitleProjectStatus(project.id, 'subtitle_editing', { errorMessage: null })
    const updated = await getSubtitleProjectForAccount(project.id, accountId)
    return updated!
  }

  if (project.audioFileUrl) {
    // 音频已提取 → 只需重新提交 ASR
    await updateSubtitleProjectStatus(project.id, 'asr_processing', { errorMessage: null })

    const asrResult = await deps.asrClient.submitTranscription(project.audioFileUrl)

    if (!asrResult.success) {
      await updateSubtitleProjectStatus(project.id, 'failed', { errorMessage: asrResult.error })
      await pushNotification({
        accountId,
        type: 'task_failed',
        title: '字幕重试失败',
        body: asrResult.error,
        meta: { recordId: project.id, category: 'subtitle' },
      }).catch(() => {})
      const failedProject = await getSubtitleProjectForAccount(project.id, accountId)
      return failedProject!
    }

    const asrRecord = await createGenerationRecord({
      accountId,
      taskId: asrResult.taskId,
      traceId: crypto.randomUUID(),
      model: 'paraformer-v2',
      category: 'subtitle',
      status: 'processing',
      inputParams: { audioUrl: project.audioFileUrl, projectId: project.id },
      cost: { ...calculateCost(
        { id: 'paraformer-v2', category: 'subtitle', pricing: { inputPriceCents: 0.008, unit: 'audio' } },
        { duration: (project.videoDurationMs || 0) / 1000 },
      ), estimated: true, billable: false, source: 'estimated' },
    })

    await updateSubtitleProjectStatus(project.id, 'asr_processing', {
      asrRecordId: asrRecord.id,
      errorMessage: null,
    })

    await notifyGenerationStatus({
      accountId,
      recordId: asrRecord.id,
      status: 'processing',
      category: 'subtitle',
      model: 'paraformer-v2',
      taskId: asrResult.taskId,
      traceId: asrRecord.traceId ?? undefined,
    })

    const finalProject = await getSubtitleProjectForAccount(project.id, accountId)
    return finalProject!
  }

  // 没有任何进度 → 从头开始（复用已有项目记录和 videoFileId）
  const file = await getUploadedFileById(project.videoFileId)
  if (!file || file.accountId !== accountId) {
    throw new Error('视频文件不存在或不属于当前用户')
  }

  try {
    await updateSubtitleProjectStatus(project.id, 'extracting_audio', { errorMessage: null })

    const videoPath = file.publicUrl.startsWith('/') || file.publicUrl.startsWith('./')
      ? `${config.storageRoot}/${file.storagePath}`
      : file.publicUrl

    const { audioPath, durationMs: audioDurationMs } = await extractAudioFromVideo(videoPath, config.storageRoot)
    const videoDurationMs = await getMediaDurationMs(videoPath)

    const audioBuffer = await Bun.file(audioPath).arrayBuffer()
    const audioFileUrl = await deps.storage.uploadGenerated(
      Buffer.from(audioBuffer),
      `subtitle/audio_${project.id}.wav`,
      'audio/wav',
    )

    try {
      await Bun.file(audioPath).delete()
    }
    catch {}

    await updateSubtitleProjectStatus(project.id, 'asr_processing', {
      audioFileUrl,
      videoDurationMs: videoDurationMs || audioDurationMs,
    })

    const asrResult = await deps.asrClient.submitTranscription(audioFileUrl)

    if (!asrResult.success) {
      await updateSubtitleProjectStatus(project.id, 'failed', { errorMessage: asrResult.error })
      await pushNotification({
        accountId,
        type: 'task_failed',
        title: '字幕重试失败',
        body: asrResult.error,
        meta: { recordId: project.id, category: 'subtitle' },
      }).catch(() => {})
      const failedProject = await getSubtitleProjectForAccount(project.id, accountId)
      return failedProject!
    }

    const estimatedCost = calculateCost(
      { id: 'paraformer-v2', category: 'subtitle', pricing: { inputPriceCents: 0.008, unit: 'audio' } },
      { duration: (videoDurationMs || audioDurationMs) / 1000 },
    )

    const asrRecord = await createGenerationRecord({
      accountId,
      taskId: asrResult.taskId,
      traceId: crypto.randomUUID(),
      model: 'paraformer-v2',
      category: 'subtitle',
      status: 'processing',
      inputParams: { audioUrl: audioFileUrl, projectId: project.id },
      cost: { ...estimatedCost, estimated: true, billable: false, source: 'estimated' },
    })

    await updateSubtitleProjectStatus(project.id, 'asr_processing', {
      asrRecordId: asrRecord.id,
    })

    await notifyGenerationStatus({
      accountId,
      recordId: asrRecord.id,
      status: 'processing',
      category: 'subtitle',
      model: 'paraformer-v2',
      taskId: asrResult.taskId,
      traceId: asrRecord.traceId ?? undefined,
    })

    const finalProject = await getSubtitleProjectForAccount(project.id, accountId)
    return finalProject!
  }
  catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    await updateSubtitleProjectStatus(project.id, 'failed', { errorMessage: errorMsg })
    await pushNotification({
      accountId,
      type: 'task_failed',
      title: '字幕重试失败',
      body: errorMsg,
      meta: { recordId: project.id, category: 'subtitle' },
    }).catch(() => {})
    throw err
  }
}
