/**
 * Media task handlers — Worker 端执行
 *
 * 两类任务：
 *   1. media.extract-audio — 从视频提取音频 + 提交 ASR
 *   2. media.burn-subtitle  — FFmpeg 烧录字幕到视频
 *
 * 在 task-handler.ts 注册，由 Worker 主循环通过统一 task queue 调用。
 */

import type { TaskRow } from '@excuse/db'
import type { WorkerContext } from './context'
import { calculateCost } from '@excuse/billing'
import {
  createGenerationRecord,
  getUploadedFileById,
  markGenerationFailed,
  markGenerationSucceeded,
  notifyGenerationStatus,
  notifyNotification,
  updateSubtitleExport,
  updateSubtitleProjectStatus,
} from '@excuse/db'
import { burnSubtitlesToVideo, extractAudioFromVideo, getMediaDurationMs } from '@excuse/provider'
import { createLogger, parseMediaBurnSubtitleInput, parseMediaExtractAudioInput } from '@excuse/shared'
import { getDefaultStyleConfig, sentencesToAss } from '@excuse/subtitle-engine'
import { TaskInputError } from '@excuse/task-engine'

const logger = createLogger('media-handlers')

type WorkerTaskOutput = Record<string, unknown> | undefined

/**
 * 处理媒体提取音频任务 — 从视频中提取音频 + 上传 + 提交 ASR
 *
 * 流程：
 *   1. 解析 task input
 *   2. 获取上传文件记录
 *   3. 重置项目状态为 extracting_audio（重试时从 failed 恢复）
 *   4. FFmpeg 提取音频
 *   5. 上传音频到存储
 *   6. 清理本地临时文件
 *   7. 更新项目 audioFileUrl / videoDurationMs，状态 → asr_processing
 *   8. 提交 ASR 转录
 *   9. 创建 generation_record
 *   10. 更新项目 asrRecordId
 *   11. SSE 通知
 */
export async function handleMediaExtractAudio(task: TaskRow, ctx: WorkerContext): Promise<WorkerTaskOutput> {
  const { projectId, accountId } = task
  const { config, storage, asrClient } = ctx
  // 解析 JSONB task.input（缺字段/类型错 → 分类 validation 永久失败，不重试）
  const parsed = parseMediaExtractAudioInput(task.input)
  if (!parsed.ok)
    throw new TaskInputError(parsed.error)
  const videoFileId = parsed.input.videoFileId

  if (!projectId || !accountId) {
    throw new TaskInputError('media.extract-audio: missing projectId or accountId in task row')
  }

  try {
    // 重置状态（首次执行或重试时统一处理）
    await updateSubtitleProjectStatus(projectId, 'extracting_audio', { errorMessage: null })

    // 获取视频文件记录
    const file = await getUploadedFileById(videoFileId)
    if (!file) {
      throw new Error(`视频文件不存在: ${videoFileId}`)
    }

    // 解析视频本地路径
    const videoPath = file.publicUrl.startsWith('/') || file.publicUrl.startsWith('./')
      ? `${config.storageRoot}/${file.storagePath}`
      : file.publicUrl

    // FFmpeg 提取音频
    const { audioPath, durationMs: audioDurationMs } = await extractAudioFromVideo(videoPath, config.storageRoot)
    const videoDurationMs = await getMediaDurationMs(videoPath)

    // 上传音频到存储
    const audioBuffer = await Bun.file(audioPath).arrayBuffer()
    const audioFileUrl = await storage.uploadGenerated(
      Buffer.from(audioBuffer),
      `subtitle/audio_${projectId}.wav`,
      'audio/wav',
    )

    // 清理本地临时音频文件
    try {
      await Bun.file(audioPath).delete()
    }
    catch {}

    // 更新项目 audioFileUrl / videoDurationMs，状态 → asr_processing
    await updateSubtitleProjectStatus(projectId, 'asr_processing', {
      audioFileUrl,
      videoDurationMs: videoDurationMs || audioDurationMs,
    })

    // 提交 ASR 转录
    const asrResult = await asrClient.submitTranscription(audioFileUrl)

    if (!asrResult.success) {
      const errMsg = asrResult.error || 'ASR 提交失败'
      await updateSubtitleProjectStatus(projectId, 'failed', { errorMessage: errMsg })
      await notifyNotification({
        accountId,
        type: 'task_failed',
        title: '字幕识别提交失败',
        body: errMsg,
        meta: { recordId: projectId, category: 'subtitle' },
      }).catch(() => {})
      throw new Error(errMsg)
    }

    // 计算 ASR 费用
    const audioDurationSec = (videoDurationMs || audioDurationMs) / 1000
    const estimatedCost = calculateCost(
      { id: 'paraformer-v2', category: 'subtitle', pricing: { inputPriceCents: 0.008, unit: 'audio' } },
      { duration: audioDurationSec },
    )

    // 创建 generation_record 关联
    const asrRecord = await createGenerationRecord({
      accountId,
      taskId: asrResult.taskId,
      traceId: crypto.randomUUID(),
      model: 'paraformer-v2',
      category: 'subtitle',
      status: 'processing',
      inputParams: { audioUrl: audioFileUrl, projectId },
      cost: { ...estimatedCost, estimated: true, billable: false, source: 'estimated' },
    })

    // 更新项目 asrRecordId
    await updateSubtitleProjectStatus(projectId, 'asr_processing', { asrRecordId: asrRecord.id })

    // SSE 通知
    await notifyGenerationStatus({
      accountId,
      recordId: asrRecord.id,
      status: 'processing',
      category: 'subtitle',
      model: 'paraformer-v2',
      taskId: asrResult.taskId,
      traceId: asrRecord.traceId ?? undefined,
    })

    logger.info({ projectId, asrTaskId: asrResult.taskId }, '✅ Audio extraction + ASR submission completed')

    return {
      audioFileUrl,
      asrTaskId: asrResult.taskId,
      asrRecordId: asrRecord.id,
    }
  }
  catch (err) {
    // 标记项目为失败（仅非重试性错误；任务重试由 handleTaskError 决定）
    const errorMsg = err instanceof Error ? err.message : String(err)
    await updateSubtitleProjectStatus(projectId, 'failed', { errorMessage: errorMsg }).catch(e =>
      logger.warn({ err: e, projectId }, 'Failed to update project status on error'),
    )
    throw err
  }
}

/**
 * 处理字幕烧录任务 — FFmpeg 烧录字幕 + 上传结果 + SSE 通知
 *
 * 流程：
 *   1. 解析 task input
 *   2. 获取项目详情（sentences + styleConfig）
 *   3. 生成 ASS 字幕内容
 *   4. 获取原始视频文件
 *   5. FFmpeg 烧录字幕
 *   6. 上传导出视频到存储
 *   7. 清理本地临时文件
 *   8. 更新 generation_record → succeeded
 *   9. 更新项目导出信息 + 状态 → completed
 *   10. SSE 通知
 */
export async function handleMediaBurnSubtitle(task: TaskRow, ctx: WorkerContext): Promise<WorkerTaskOutput> {
  const { projectId, accountId } = task
  const { config, storage } = ctx
  // 解析 JSONB task.input（缺字段/类型错 → 分类 validation 永久失败，不重试）
  const parsed = parseMediaBurnSubtitleInput(task.input)
  if (!parsed.ok)
    throw new TaskInputError(parsed.error)
  const exportRecordId = parsed.input.exportRecordId

  if (!projectId || !accountId) {
    throw new TaskInputError('media.burn-subtitle: missing projectId or accountId in task row')
  }

  try {
    // 重置状态为重试准备（首次执行或重试时统一处理）
    await updateSubtitleProjectStatus(projectId, 'exporting', { errorMessage: null })

    // 获取项目（需要 sentences, styleConfig, videoFileId）
    const { getSubtitleProjectById } = await import('@excuse/db')
    const project = await getSubtitleProjectById(projectId)
    if (!project) {
      throw new Error(`字幕项目不存在: ${projectId}`)
    }

    if (!project.sentences || project.sentences.length === 0) {
      const errMsg = '没有字幕内容，无法导出'
      await updateSubtitleProjectStatus(projectId, 'failed', { errorMessage: errMsg })
      await markGenerationFailed(exportRecordId, errMsg)
      throw new Error(errMsg)
    }

    // 生成 ASS 字幕内容
    const styleConfig = project.styleConfig ?? getDefaultStyleConfig()
    const assContent = sentencesToAss(project.sentences, styleConfig)

    // 获取原始视频文件
    const file = await getUploadedFileById(project.videoFileId)
    if (!file) {
      const errMsg = '原始视频文件不存在'
      await updateSubtitleProjectStatus(projectId, 'failed', { errorMessage: errMsg })
      await markGenerationFailed(exportRecordId, errMsg)
      throw new Error(errMsg)
    }

    const videoPath = file.publicUrl.startsWith('/') || file.publicUrl.startsWith('./')
      ? `${config.storageRoot}/${file.storagePath}`
      : file.publicUrl

    // FFmpeg 烧录字幕
    const { outputPath } = await burnSubtitlesToVideo(videoPath, assContent, config.storageRoot)

    // 上传导出视频到存储
    const videoBuffer = await Bun.file(outputPath).arrayBuffer()
    const exportedVideoUrl = await storage.uploadGenerated(
      Buffer.from(videoBuffer),
      `subtitle/${projectId}/export_${exportRecordId}.mp4`,
      'video/mp4',
    )

    // 清理本地临时文件
    try {
      await Bun.file(outputPath).delete()
    }
    catch {}

    // 更新 generation_record → succeeded
    await markGenerationSucceeded(exportRecordId, {
      type: 'video',
      savedUrls: [exportedVideoUrl],
    })

    // 更新项目导出信息 + 状态 → completed
    await updateSubtitleExport(projectId, exportRecordId, exportedVideoUrl)
    await updateSubtitleProjectStatus(projectId, 'completed')

    // SSE 通知 — 导出成功
    await notifyGenerationStatus({
      accountId,
      recordId: exportRecordId,
      status: 'succeeded',
      category: 'subtitle',
      model: 'ffmpeg-burn',
      taskId: null,
    })

    logger.info({ projectId }, '✅ Subtitle burn completed')

    // 通知用户
    await notifyNotification({
      accountId,
      type: 'task_completed',
      title: '字幕导出完成',
      body: '字幕已烧录到视频，可前往下载',
      meta: { recordId: exportRecordId, category: 'subtitle' },
    }).catch(err => logger.warn({ err, projectId }, 'Failed to push export completed notification'))

    return { exportedVideoUrl }
  }
  catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    // 只在项目状态未变时标记失败（避免覆盖已处理的状态）
    await updateSubtitleProjectStatus(projectId, 'failed', { errorMessage: errorMsg }).catch(e =>
      logger.warn({ err: e, projectId }, 'Failed to update project status on error'),
    )
    throw err
  }
}
