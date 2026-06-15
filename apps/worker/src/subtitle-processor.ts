/**
 * 字幕 ASR 任务处理器 — Worker 专用
 *
 * 轮询 DashScope ASR 任务状态，解析转录结果。
 *
 * 导出任务已迁移到 media-handlers.ts (media.burn-subtitle)。
 */

import type { SubtitleProjectRow } from '@excuse/db'
import type { ASRClient } from '@excuse/provider'
import {
  getGenerationRecordById,
  markGenerationFailed,
  markGenerationSucceeded,
  notifyGenerationStatus,
  notifyNotification,
  updateSubtitleProjectStatus,
  updateSubtitleSentences,
} from '@excuse/db'
import { createLogger } from '@excuse/shared'

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
