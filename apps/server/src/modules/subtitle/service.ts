/**
 * 字幕生成核心业务服务
 *
 * 职责：
 *   1. 创建字幕项目 — 上传视频 → 创建 DB 记录 → 创建 media.extract-audio 任务
 *   2. 智能重试失败项目 — 根据已有进度跳过已完成的步骤
 *
 * ASR 完成和导出处理由 Worker 负责（media-handlers.ts）。
 * 服务端只做项目创建和任务调度，不做 FFmpeg 等耗时操作。
 */

import type { SubtitleProjectRow } from '@excuse/db'
import type { ASRClient } from '@excuse/provider'
import { calculateCost } from '@excuse/billing'
import {
  createGenerationRecord,
  createSubtitleProject,
  createTask,
  getSubtitleProjectForAccount,
  getUploadedFileById,
  notifyGenerationStatus,
  updateSubtitleProjectStatus,
} from '@excuse/db'
import { getDefaultStyleConfig } from '@excuse/subtitle-engine'
import { pushNotification } from '../../routes/notifications'

/** 字幕项目依赖的外部服务（仅供 retry 中快速重提交 ASR 使用） */
export interface SubtitleDependencies {
  asrClient: ASRClient
}

/**
 * 创建字幕项目 — 创建项目记录 + 调度 media.extract-audio 任务
 *
 * 流程：
 *   1. 校验视频文件归属
 *   2. 创建 subtitle_project DB 记录（draft 状态）
 *   3. 更新项目状态为 extracting_audio
 *   4. 创建 media.extract-audio 任务（Worker 异步执行）
 *   5. 返回项目（HTTP 请求不再阻塞等待音频提取）
 */
export async function createAndStartProject(
  accountId: string,
  videoFileId: string,
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

  // 3. 更新状态为 extracting_audio
  await updateSubtitleProjectStatus(project.id, 'extracting_audio')

  // 4. 创建 media.extract-audio 任务（Worker 异步执行音频提取 + ASR）
  await createTask({
    accountId,
    type: 'media.extract-audio',
    domain: 'subtitle',
    priority: 5,
    projectId: project.id,
    targetType: 'subtitle_project',
    targetId: project.id,
    input: {
      videoFileId,
      projectId: project.id,
    },
  })

  // 5. 返回项目（立即返回，不阻塞）
  const finalProject = await getSubtitleProjectForAccount(project.id, accountId)
  return finalProject!
}

/**
 * 智能重试失败项目 — 根据已有进度跳过已完成的步骤
 *
 * 判断逻辑：
 *   - sentences 存在 → ASR 已完成，只需回到 subtitle_editing 状态让用户重新导出
 *   - audioFileUrl 存在 → 音频已提取，只需重新提交 ASR
 *   - 都不存在 → 创建 media.extract-audio 任务重新开始
 */
export async function retryProject(
  project: SubtitleProjectRow,
  accountId: string,
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

    const estimatedCost = calculateCost(
      { id: 'paraformer-v2', category: 'subtitle', pricing: { inputPriceCents: 0.008, unit: 'audio' } },
      { duration: (project.videoDurationMs || 0) / 1000 },
    )

    const asrRecord = await createGenerationRecord({
      accountId,
      taskId: asrResult.taskId,
      traceId: crypto.randomUUID(),
      model: 'paraformer-v2',
      category: 'subtitle',
      status: 'processing',
      inputParams: { audioUrl: project.audioFileUrl, projectId: project.id },
      cost: { ...estimatedCost, estimated: true, billable: false, source: 'estimated' },
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

  // 没有任何进度 → 创建 media.extract-audio 任务（复用已有项目记录和 videoFileId）
  await updateSubtitleProjectStatus(project.id, 'extracting_audio', { errorMessage: null })

  await createTask({
    accountId,
    type: 'media.extract-audio',
    domain: 'subtitle',
    priority: 5,
    projectId: project.id,
    targetType: 'subtitle_project',
    targetId: project.id,
    input: {
      videoFileId: project.videoFileId,
      projectId: project.id,
    },
  })

  const finalProject = await getSubtitleProjectForAccount(project.id, accountId)
  return finalProject!
}
