import type { TaskRow } from '@excuse/db'
/**
 * subtitle.asr task handler — 替代遗留 ASR 字幕轮询（subtitle-processor.ts）
 *
 * 由统一任务队列调度。task.input 承载：{ projectId, asrRecordId, providerTaskId }
 */
import type { GenerationStatus } from '@excuse/shared'
import type { WorkerContext } from './context'
import {
  getSubtitleProjectById,
  markGenerationFailed,
  markGenerationSucceeded,
  notifyGenerationStatus,
  notifyNotification,
  updateSubtitleProjectStatus,
  updateSubtitleSentences,
} from '@excuse/db'
import { createLogger } from '@excuse/shared'

const logger = createLogger('subtitle-asr-handler')

/** 共享失败收尾 — 标记 project failed + record failed */
async function failAsrTask(projectId: string, asrRecordId: string, accountId: string, errMsg: string) {
  await updateSubtitleProjectStatus(projectId, 'failed', { errorMessage: errMsg })
  await markGenerationFailed(asrRecordId, errMsg)
  await notifyGenerationStatus({
    accountId,
    recordId: asrRecordId,
    status: 'failed' as GenerationStatus,
    category: 'subtitle',
    model: 'asr',
    taskId: '',
    errorMessage: errMsg,
  }).catch(() => {})
  await notifyNotification({
    accountId,
    type: 'task_failed',
    title: '字幕转写失败',
    body: errMsg,
    meta: { projectId },
  }).catch((err: Error) => logger.warn({ err, projectId }, 'Failed to push ASR failure notification'))
}

export async function handleSubtitleAsr(task: TaskRow, ctx: WorkerContext): Promise<Record<string, unknown> | undefined> {
  const { config, asrClient } = ctx
  const input = task.input ?? {}
  const projectId = input.projectId as string | undefined
  const asrRecordId = input.asrRecordId as string | undefined
  const providerTaskId = input.providerTaskId as string | undefined

  if (!projectId || !asrRecordId || !providerTaskId) {
    throw Object.assign(new Error('subtitle.asr: missing projectId, asrRecordId, or providerTaskId'), { cause: { code: 'InvalidInput' } })
  }

  const project = await getSubtitleProjectById(projectId)
  if (!project) {
    throw Object.assign(new Error(`subtitle.asr: project ${projectId} not found`), { cause: { code: 'InvalidInput' } })
  }

  // ── 超时检测 ──
  const elapsed = Date.now() - new Date(project.updatedAt).getTime()
  if (elapsed > config.asrStaleTimeoutMs) {
    await failAsrTask(projectId, asrRecordId, project.accountId, 'ASR timed out')
    logger.warn({ projectId, asrRecordId }, 'ASR task timed out')
    return {}
  }

  // ── 查询 DashScope ASR 状态 ──
  const taskStatus = await asrClient.queryTask(providerTaskId)

  switch (taskStatus.status) {
    case 'SUCCEEDED': {
      const rawJson = taskStatus.transcriptionUrl
        ? await fetch(taskStatus.transcriptionUrl).then(r => r.json()).catch(() => null)
        : null
      if (!rawJson) {
        throw Object.assign(new Error('ASR succeeded but transcription download failed'), { cause: { code: 'InternalError' } })
      }

      const sentences = asrClient.parseTranscription(rawJson)
      await updateSubtitleSentences(projectId, sentences, rawJson)
      await markGenerationSucceeded(asrRecordId, { type: 'subtitle', sentences })

      await notifyGenerationStatus({
        accountId: project.accountId,
        recordId: asrRecordId,
        status: 'succeeded' as GenerationStatus,
        category: 'subtitle',
        model: 'asr',
        taskId: providerTaskId,
      })

      await notifyNotification({
        accountId: project.accountId,
        type: 'task_completed',
        title: '字幕转写完成',
        body: 'ASR 转写已完成，可在字幕编辑页面查看和调整',
        meta: { projectId },
      }).catch((err: Error) => logger.warn({ err, projectId }, 'Failed to push ASR completion notification'))

      return { projectId, sentenceCount: sentences.length }
    }

    case 'FAILED': {
      const errMsg = taskStatus.errorMessage || 'ASR task failed'
      // 透传 provider 错误码（FAILED 的业务 code 或超时/连接的 TIMEOUT/ECONNRESET），
      // 供 task-engine 分类可重试性（与 generate-video-handler 一致，TODO §1.1）
      throw Object.assign(new Error(errMsg), taskStatus.errorCode ? { cause: { code: taskStatus.errorCode } } : {})
    }

    case 'PENDING':
    case 'RUNNING':
      throw Object.assign(new Error('ASR task still running'), { cause: { code: 'Throttling' } })

    default:
      logger.warn({ taskId: providerTaskId, status: taskStatus.status, projectId }, 'subtitle.asr: unknown task status')
      return {}
  }
}
