/**
 * generate.video task handler — 替代遗留 video 轮询（task-processor.ts）
 *
 * 由统一任务队列调度。task.input 承载：
 *   { recordId, providerTaskId, model }
 *
 * 生命周期：claim → handler → succeed/fail (via handleTaskError)
 * handler 内不处理重试决策，抛异常交给 task-engine 的 classifyTaskError → retry/fail。
 */
import type { CostDetail, GenerationStatus, OutputResult, VideoOutputResult } from '@excuse/shared'
import type { TaskRow } from '@excuse/db'
import type { WorkerContext } from './context'
import { calculateCost } from '@excuse/billing'
import {
  debitCredit,
  getGenerationRecordById,
  markCanvasAssetFailedByTaskId,
  markCanvasAssetSucceededByTaskId,
  markGenerationFailed,
  markGenerationSucceeded,
  notifyGenerationStatus,
  notifyNotification,
  refundCredit,
  setCanvasAssetActive,
} from '@excuse/db'
import { getModelById } from '@excuse/provider'
import { createLogger, extractBillingParams, parseGenerationInputParamsMeta } from '@excuse/shared'
import { audit } from './services/audit'
import { extractVideoDuration, extractVideoUrl, refundReservedCredit, updateCanvasShotAndProject } from './task-processor-utils'

const logger = createLogger('generate-video-handler')

export async function handleGenerateVideo(task: TaskRow, ctx: WorkerContext): Promise<Record<string, unknown> | undefined> {
  const { config, client, storage } = ctx
  const input = task.input ?? {}
  const recordId = input.recordId as string | undefined
  const providerTaskId = input.providerTaskId as string | undefined

  if (!recordId || !providerTaskId) {
    throw new Error('generate.video: missing recordId or providerTaskId in task input')
  }

  const record = await getGenerationRecordById(recordId)
  if (!record) {
    throw new Error(`generate.video: generation record ${recordId} not found`)
  }

  const inputParams = record.inputParams ?? {}
  const inputMeta = parseGenerationInputParamsMeta(inputParams)
  const canvasMeta = inputMeta.source === 'canvas' && inputMeta.projectId
    ? { projectId: inputMeta.projectId, shotId: inputMeta.shotId ?? '' }
    : undefined

  // ── 超时检测 ──
  const elapsed = Date.now() - new Date(record.createdAt).getTime()
  if (elapsed > config.staleTimeoutMs) {
    await markGenerationFailed(record.id, 'Task timed out (>4h)')
    await refundReservedCredit({ id: record.id, accountId: record.accountId, cost: record.cost }, refundCredit, '视频任务超时退款')
    if (record.cost?.totalPriceCents && record.cost.totalPriceCents > 0) {
      await audit('credit_refund', {
        accountId: record.accountId,
        targetId: record.id,
        detail: { accountId: record.accountId, generationRecordId: record.id, amountCents: record.cost.totalPriceCents, description: '视频任务超时退款', source: 'worker_video' },
      }).catch(err => logger.warn({ err, recordId: record.id }, 'Failed to audit credit_refund on timeout'))
    }
    await markCanvasAssetFailedByTaskId(providerTaskId, 'Task timed out (>4h)').catch(err =>
      logger.warn({ err, taskId: providerTaskId }, 'Failed to mark canvas_asset as failed on timeout'),
    )
    const projectStatus = canvasMeta
      ? await updateCanvasShotAndProject(canvasMeta.projectId, canvasMeta.shotId, { status: 'failed', errorMessage: 'Task timed out (>4h)' })
      : undefined
    await notifyGenerationStatus({
      accountId: record.accountId, recordId: record.id, status: 'failed' as GenerationStatus, category: record.category, model: record.model, taskId: providerTaskId, traceId: record.traceId ?? undefined, errorMessage: 'Task timed out (>4h)',
      ...(canvasMeta && { canvasMeta: { ...canvasMeta, ...(projectStatus && { projectStatus }) } }),
    })
    await notifyNotification({
      accountId: record.accountId, type: 'task_failed', title: '视频生成超时', body: '任务超过 4 小时未完成，已自动失败并退款',
      meta: { recordId: record.id, category: record.category, ...(canvasMeta && { projectId: canvasMeta.projectId, shotId: canvasMeta.shotId }) },
    }).catch(err => logger.warn({ err, recordId: record.id }, 'Failed to push timeout notification'))
    // 超时是终态，返回空 output
    return {}
  }

  // ── 查询 DashScope ──
  const taskStatus = await client.queryTask(providerTaskId)

  switch (taskStatus.status) {
    case 'SUCCEEDED': {
      const videoUrl = extractVideoUrl(taskStatus.output)
      const savedUrls = videoUrl ? await storage.downloadAndMap([videoUrl], providerTaskId, 'video') : []

      const modelConfig = getModelById(record.model)
      const inputDuration = inputParams.duration
      const actualVideoDuration = extractVideoDuration(taskStatus.output) || (typeof inputDuration === 'number' ? inputDuration : 5)
      const calculatedCost = modelConfig
        ? calculateCost(modelConfig, extractBillingParams(inputParams), { videoDuration: actualVideoDuration })
        : record.cost
      const actualCost = calculatedCost ? { ...calculatedCost, billable: true, source: 'actual' as const } : null

      const output: VideoOutputResult = { type: 'video', savedUrls, originalUrl: videoUrl }

      await markGenerationSucceeded(record.id, output, actualCost ?? undefined)
      if (actualCost?.totalPriceCents && actualCost.totalPriceCents > 0) {
        await debitCredit({
          accountId: record.accountId, generationRecordId: record.id, actualCents: actualCost.totalPriceCents, description: `视频生成成功扣款：${record.model}`,
        })
        await audit('credit_debit', {
          accountId: record.accountId, targetId: record.id, detail: { accountId: record.accountId, generationRecordId: record.id, amountCents: actualCost.totalPriceCents, description: `视频生成成功扣款：${record.model}`, source: 'worker_video' },
        }).catch(err => logger.warn({ err, recordId: record.id }, 'Failed to audit credit_debit'))
      }

      if (canvasMeta) {
        const assetOutputJson = { type: 'video' as const, urls: savedUrls.length > 0 ? savedUrls : (videoUrl ? [videoUrl] : []) }
        const succeededAsset = await markCanvasAssetSucceededByTaskId(providerTaskId, assetOutputJson, savedUrls[0] || videoUrl || undefined, undefined, videoUrl || undefined, actualCost ?? undefined)
        if (succeededAsset) {
          await setCanvasAssetActive(succeededAsset.id)
        }
      }

      const projectStatus = canvasMeta
        ? await updateCanvasShotAndProject(canvasMeta.projectId, canvasMeta.shotId, { status: 'completed', videoUrl: savedUrls[0] || undefined })
        : undefined

      await notifyGenerationStatus({
        accountId: record.accountId, recordId: record.id, status: 'succeeded' as GenerationStatus, category: record.category, model: record.model, taskId: providerTaskId, traceId: record.traceId ?? undefined, outputResult: output, cost: actualCost ?? undefined,
        ...(canvasMeta && { canvasMeta: { ...canvasMeta, ...(projectStatus && { projectStatus }) } }),
      })

      await notifyNotification({
        accountId: record.accountId, type: 'task_completed', title: '视频生成完成', body: `${record.model} · 点击查看结果`,
        meta: { recordId: record.id, category: record.category, ...(canvasMeta && { projectId: canvasMeta.projectId, shotId: canvasMeta.shotId }) },
      }).catch(err => logger.warn({ err, recordId: record.id }, 'Failed to push notification'))

      if (canvasMeta && projectStatus === 'completed') {
        await notifyNotification({
          accountId: record.accountId, type: 'canvas_completed', title: '画布项目已全部完成', body: '所有镜头视频生成完毕，可在画布中查看', meta: { projectId: canvasMeta.projectId, category: 'video' },
        }).catch(err => logger.warn({ err, projectId: canvasMeta.projectId }, 'Failed to push canvas_completed notification'))
      }

      return { videoUrl: savedUrls[0] ?? videoUrl }
    }

    case 'FAILED': {
      const errMsg = taskStatus.errorMessage || 'DashScope task failed'
      // 让 task-engine 的 handleTaskError 处理重试决策
      throw Object.assign(new Error(errMsg), taskStatus.errorCode ? { cause: { code: taskStatus.errorCode } } : {})
    }

    case 'PENDING':
    case 'RUNNING': {
      if (record.status === 'pending') {
        // 标记为 processing（首次轮询）
        await import('@excuse/db').then(({ markGenerationProcessing }) => markGenerationProcessing(record.id))
      }
      // 仍在处理中，让调度器稍后重试
      throw Object.assign(new Error(`Task still ${taskStatus.status}`), { cause: { code: 'StillRunning' } })
    }

    default:
      logger.warn({ taskId: providerTaskId, status: taskStatus.status, recordId: record.id }, 'generate.video: unknown task status')
      return {}
  }
}
