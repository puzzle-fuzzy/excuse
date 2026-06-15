/**
 * 字幕任务处理器 — Worker 专用
 *
 * 两类任务：
 *   1. ASR 任务（asr_processing 状态） — 轮询 DashScope ASR 任务状态
 *   2. 导出任务（exporting 状态） — FFmpeg 烧录字幕到视频
 */

import type { SubtitleProjectRow } from '@excuse/db'
import type { ASRClient } from '@excuse/provider'
import type { WorkerConfig } from './config'
import {
  getGenerationRecordById,
  getUploadedFileById,
  markGenerationFailed,
  markGenerationSucceeded,
  notifyGenerationStatus,
  notifyNotification,
  updateSubtitleExport,
  updateSubtitleProjectStatus,
  updateSubtitleSentences,
} from '@excuse/db'
import { AssetStorage, burnSubtitlesToVideo } from '@excuse/provider'
import { createLogger } from '@excuse/shared'
import { sentencesToAss } from '@excuse/subtitle-engine'

const logger = createLogger('subtitle-processor')

/**
 * 处理 ASR 字幕任务 — 轮询 DashScope 任务状态并解析转录结果
 *
 * 流程：
 *   1. 获取关联的 generation_record（asrRecordId）
 *   2. 用 ASRClient 查询 DashScope 任务状态
 *   3. SUCCEEDED → 下载转录 JSON → 解析句子 → 更新项目 → 标记 record succeeded → SSE
 *   4. FAILED → 更新项目状态 → 标记 record failed → SSE
 *   5. PENDING/RUNNING → 跳过，下一轮继续
 */
export async function processASRTask(project: SubtitleProjectRow, asrClient: ASRClient): Promise<void> {
  if (!project.asrRecordId) {
    logger.warn({ projectId: project.id }, 'ASR task has no asrRecordId, skipping')
    return
  }

  // 获取关联的 generation_record
  const record = await getGenerationRecordById(project.asrRecordId)
  if (!record || !record.taskId) {
    logger.warn({ projectId: project.id, asrRecordId: project.asrRecordId }, 'ASR record not found or no taskId')
    return
  }

  // 查询 DashScope 任务状态
  const taskStatus = await asrClient.queryTask(record.taskId)

  switch (taskStatus.status) {
    case 'SUCCEEDED': {
      // 下载转录 JSON
      if (!taskStatus.transcriptionUrl) {
        logger.error({ projectId: project.id }, 'ASR succeeded but no transcriptionUrl')
        await updateSubtitleProjectStatus(project.id, 'failed', { errorMessage: 'ASR 完成但未返回转录结果' })
        await markGenerationFailed(record.id, 'ASR 完成但未返回转录结果')
        return
      }

      const response = await fetch(taskStatus.transcriptionUrl)
      const rawJson = await response.json()

      // 解析句子列表
      const sentences = asrClient.parseTranscription(rawJson)

      // 更新 subtitle_project
      await updateSubtitleSentences(project.id, sentences, rawJson)
      await updateSubtitleProjectStatus(project.id, 'subtitle_editing')

      // 更新 generation_record
      await markGenerationSucceeded(record.id, {
        type: 'subtitle',
        sentences,
        transcriptionUrl: taskStatus.transcriptionUrl,
      })

      // SSE 通知
      await notifyGenerationStatus({
        accountId: project.accountId,
        recordId: record.id,
        status: 'succeeded',
        category: 'subtitle',
        model: 'paraformer-v2',
        taskId: record.taskId,
        traceId: record.traceId ?? undefined,
      })

      logger.info({ projectId: project.id, sentenceCount: sentences.length }, '✅ ASR task completed')

      // 通知：字幕 ASR 完成
      await notifyNotification({
        accountId: project.accountId,
        type: 'task_completed',
        title: '字幕识别完成',
        body: `共识别 ${sentences.length} 条字幕，可前往编辑`,
        meta: { recordId: record.id, category: 'subtitle' },
      }).catch(err => logger.warn({ err, projectId: project.id }, 'Failed to push ASR completed notification'))
      break
    }

    case 'FAILED': {
      const errMsg = taskStatus.errorMessage || 'ASR 任务失败'
      await updateSubtitleProjectStatus(project.id, 'failed', { errorMessage: errMsg })
      await markGenerationFailed(record.id, errMsg)
      await notifyGenerationStatus({
        accountId: project.accountId,
        recordId: record.id,
        status: 'failed',
        category: 'subtitle',
        model: 'paraformer-v2',
        taskId: record.taskId,
        traceId: record.traceId ?? undefined,
        errorMessage: errMsg,
      })
      logger.error({ projectId: project.id, error: errMsg }, '❌ ASR task failed')

      // 通知：字幕 ASR 失败
      await notifyNotification({
        accountId: project.accountId,
        type: 'task_failed',
        title: '字幕识别失败',
        body: errMsg,
        meta: { recordId: record.id, category: 'subtitle' },
      }).catch(err => logger.warn({ err, projectId: project.id }, 'Failed to push ASR failed notification'))
      break
    }

    case 'PENDING':
    case 'RUNNING': {
      logger.info({ projectId: project.id, status: taskStatus.status }, '⏳ ASR task still processing')
      break
    }

    default: {
      logger.warn({ projectId: project.id, status: taskStatus.status }, '⚠️ Unknown ASR task status')
      break
    }
  }
}

/**
 * 处理字幕导出任务 — FFmpeg 烧录 + 上传结果 + SSE 通知
 *
 * 流程：
 *   1. 校验 exportRecordId 和 sentences
 *   2. 从项目获取 sentences + styleConfig
 *   3. 生成 ASS 内容
 *   4. 获取原始视频文件
 *   5. FFmpeg 烧录字幕到视频
 *   6. 上传导出视频到存储
 *   7. 更新 generation_record → succeeded
 *   8. 更新项目状态 → completed
 *   9. SSE 通知客户端
 */
export async function processExportTask(project: SubtitleProjectRow, config: WorkerConfig): Promise<void> {
  if (!project.exportRecordId) {
    logger.warn({ projectId: project.id }, 'Export task has no exportRecordId, skipping')
    return
  }

  if (!project.sentences || project.sentences.length === 0) {
    await updateSubtitleProjectStatus(project.id, 'failed', { errorMessage: '没有字幕内容，无法导出' })
    await markGenerationFailed(project.exportRecordId, '没有字幕内容，无法导出')
    await notifyExportFailed(project)
    return
  }

  const storage = new AssetStorage({
    storageRoot: config.storageRoot,
    oss: config.oss,
  })

  try {
    // 生成 ASS 内容
    const styleConfig = project.styleConfig ?? {
      templateId: 'cinema',
      fontSize: 24,
      fontColor: '#FFFFFF',
      outlineColor: '#000000',
      outlineWidth: 2,
      position: 'bottom',
      marginV: 30,
      bold: false,
    }
    const assContent = sentencesToAss(project.sentences, styleConfig)

    // 获取原始视频文件路径
    const file = await getUploadedFileById(project.videoFileId)
    if (!file) {
      await updateSubtitleProjectStatus(project.id, 'failed', { errorMessage: '原始视频文件不存在' })
      await markGenerationFailed(project.exportRecordId, '原始视频文件不存在')
      await notifyExportFailed(project, '原始视频文件不存在')
      return
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
      `subtitle/${project.id}/export_${project.exportRecordId}.mp4`,
      'video/mp4',
    )

    // 清理本地临时文件
    try {
      await Bun.file(outputPath).delete()
    }
    catch {}

    // 更新 generation_record → succeeded
    await markGenerationSucceeded(project.exportRecordId, {
      type: 'video',
      savedUrls: [exportedVideoUrl],
    })

    // 更新项目导出信息 + 状态 → completed
    await updateSubtitleExport(project.id, project.exportRecordId, exportedVideoUrl)
    await updateSubtitleProjectStatus(project.id, 'completed')

    // SSE 通知 — 导出成功
    const exportRecord = await getGenerationRecordById(project.exportRecordId)
    await notifyGenerationStatus({
      accountId: project.accountId,
      recordId: project.exportRecordId,
      status: 'succeeded',
      category: 'subtitle',
      model: 'ffmpeg-burn',
      taskId: exportRecord?.taskId ?? null,
      traceId: exportRecord?.traceId ?? undefined,
    })

    logger.info({ projectId: project.id }, '✅ Export task completed')

    // 通知：字幕导出完成
    await notifyNotification({
      accountId: project.accountId,
      type: 'task_completed',
      title: '字幕导出完成',
      body: '字幕已烧录到视频，可前往下载',
      meta: { recordId: project.exportRecordId, category: 'subtitle' },
    }).catch(err => logger.warn({ err, projectId: project.id }, 'Failed to push export completed notification'))
  }
  catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    await updateSubtitleProjectStatus(project.id, 'failed', { errorMessage: errorMsg })
    await markGenerationFailed(project.exportRecordId, errorMsg)
    await notifyExportFailed(project, errorMsg)

    // 通知：字幕导出失败
    await notifyNotification({
      accountId: project.accountId,
      type: 'task_failed',
      title: '字幕导出失败',
      body: errorMsg,
      meta: { recordId: project.exportRecordId, category: 'subtitle' },
    }).catch(err => logger.warn({ err, projectId: project.id }, 'Failed to push export failed notification'))

    logger.error({ err, projectId: project.id }, '❌ Export task failed')
  }
}

/** 导出失败时发送 SSE 通知 */
async function notifyExportFailed(project: SubtitleProjectRow, errorMessage?: string) {
  await notifyGenerationStatus({
    accountId: project.accountId,
    recordId: project.exportRecordId!,
    status: 'failed',
    category: 'subtitle',
    model: 'ffmpeg-burn',
    taskId: null,
    errorMessage: errorMessage ?? '导出失败',
  })
}
