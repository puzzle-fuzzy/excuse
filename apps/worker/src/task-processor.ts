import type { GenerationInputParams, NotifyNotificationOpts } from '@excuse/db'
import type { DashScopeTaskOutput } from '@excuse/provider'
import type { CostDetail, GenerationCategory, GenerationNotifyPayload, GenerationStatus, OutputResult, VideoOutputResult } from '@excuse/shared'
import type { WorkerConfig } from './config'
import { calculateCost } from '@excuse/billing'
import {
  debitCredit,
  listCanvasShotsByProject,
  markCanvasAssetFailedByTaskId,
  markCanvasAssetSucceededByTaskId,
  markGenerationFailed,
  markGenerationProcessing,
  markGenerationSucceeded,
  notifyGenerationStatus,
  notifyNotification,
  refundCredit,
  setCanvasAssetActive,
  updateCanvasProject,
  updateCanvasShot,
} from '@excuse/db'
import { AssetStorage, DashScopeClient, getModelById } from '@excuse/provider'
import { createLogger, extractBillingParams, parseGenerationInputParamsMeta } from '@excuse/shared'
import { audit } from './services/audit'

const logger = createLogger('worker-processor')

/**
 * 单条 generation record 的处理结果
 */
export type TaskResult
  = | { action: 'completed', taskId: string }
    | { action: 'skipped', taskId: string, reason: string }
    | { action: 'ignored', taskId: string, status: string }

/**
 * 可注入的外部依赖（测试时替换）
 */
export interface TaskProcessorDeps {
  queryTask: (taskId: string) => Promise<{
    status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN'
    output?: DashScopeTaskOutput
    errorMessage?: string
  }>
  downloadAndMap: (urls: string[], subDir: string, prefix: string) => Promise<string[]>
  markGenerationFailed: (id: string, message: string) => Promise<void>
  markGenerationSucceeded: (id: string, output: OutputResult, cost?: CostDetail) => Promise<void>
  markGenerationProcessing: (id: string) => Promise<void>
  notifyGenerationStatus: (payload: GenerationNotifyPayload) => Promise<void>
  notifyNotification: (opts: NotifyNotificationOpts) => Promise<unknown>
  debitCredit: (opts: { accountId: string, generationRecordId: string, actualCents: number, description?: string }) => Promise<unknown>
  refundCredit: (opts: { accountId: string, generationRecordId: string, description?: string }) => Promise<unknown>
}

/**
 * 创建任务处理器
 *
 * @param config Worker 配置
 * @param deps 可选的外部依赖注入（测试时使用）
 */
export function createTaskProcessor(config: WorkerConfig, deps?: Partial<TaskProcessorDeps>) {
  // 生产环境：用真实依赖
  const client = new DashScopeClient({
    apiKey: config.dashscopeApiKey,
    baseUrl: config.dashscopeBaseUrl,
  })
  const storage = new AssetStorage({
    storageRoot: config.storageRoot,
    oss: config.oss,
  })

  const queryTask = deps?.queryTask ?? ((id: string) => client.queryTask(id))
  const downloadAndMap = deps?.downloadAndMap ?? ((urls, subDir, prefix) => storage.downloadAndMap(urls, subDir, prefix))
  const fail = deps?.markGenerationFailed ?? markGenerationFailed
  const succeed = deps?.markGenerationSucceeded ?? markGenerationSucceeded
  const processing = deps?.markGenerationProcessing ?? markGenerationProcessing
  const notify = deps?.notifyGenerationStatus ?? notifyGenerationStatus
  const notifyUser = deps?.notifyNotification ?? notifyNotification
  const debit = deps?.debitCredit ?? debitCredit
  const refund = deps?.refundCredit ?? refundCredit

  return { processTask }

  /**
   * 处理单条待轮询的任务
   */
  async function processTask(record: {
    id: string
    accountId: string
    taskId: string | null
    traceId: string | null
    model: string
    status: string
    category: GenerationCategory
    createdAt: Date
    inputParams: GenerationInputParams | null
    cost: CostDetail | null
  }): Promise<TaskResult> {
    const inputParams = record.inputParams ?? {}
    // 安全提取 inputParams 元字段（source/projectId/shotId），避免 String(undefined)
    const inputMeta = parseGenerationInputParamsMeta(inputParams)
    const canvasMeta = inputMeta.source === 'canvas' && inputMeta.projectId
      ? { projectId: inputMeta.projectId, shotId: inputMeta.shotId ?? '' }
      : undefined
    const taskId = record.taskId
    if (!taskId) {
      return { action: 'skipped', taskId: record.id, reason: 'no taskId' }
    }

    // ── 超时检测 ──────────────────────────────────────
    const elapsed = Date.now() - new Date(record.createdAt).getTime()
    if (elapsed > config.staleTimeoutMs) {
      await fail(record.id, 'Task timed out (>4h)')
      await refundReservedCredit(record, refund, '视频任务超时退款')
      if (record.cost?.totalPriceCents && record.cost.totalPriceCents > 0) {
        await audit('credit_refund', {
          accountId: record.accountId,
          targetId: record.id,
          detail: {
            accountId: record.accountId,
            generationRecordId: record.id,
            amountCents: record.cost.totalPriceCents,
            description: '视频任务超时退款',
            source: 'worker_video',
          },
        }).catch(err => logger.warn({ err, recordId: record.id }, 'Failed to audit credit_refund on timeout'))
      }
      // ── 标记 shotVideo canvas_asset 为失败 ──
      await markCanvasAssetFailedByTaskId(taskId, 'Task timed out (>4h)').catch(err =>
        logger.warn({ err, taskId }, 'Failed to mark canvas_asset as failed on timeout'),
      )
      const projectStatus = canvasMeta
        ? await updateCanvasShotAndProject(canvasMeta.projectId, canvasMeta.shotId, {
            status: 'failed',
            errorMessage: 'Task timed out (>4h)',
          })
        : undefined
      await notify({
        accountId: record.accountId,
        recordId: record.id,
        status: 'failed' as GenerationStatus,
        category: record.category,
        model: record.model,
        taskId,
        traceId: record.traceId ?? undefined,
        errorMessage: 'Task timed out (>4h)',
        ...(canvasMeta && { canvasMeta: { ...canvasMeta, ...(projectStatus && { projectStatus }) } }),
      })

      // ── 通知：视频任务超时失败（P2-2） ──
      await notifyUser({
        accountId: record.accountId,
        type: 'task_failed',
        title: '视频生成超时',
        body: '任务超过 4 小时未完成，已自动失败并退款',
        meta: {
          recordId: record.id,
          category: record.category,
          ...(canvasMeta && { projectId: canvasMeta.projectId, shotId: canvasMeta.shotId }),
        },
      }).catch(err => logger.warn({ err, recordId: record.id }, 'Failed to push timeout task_failed notification'))
      return { action: 'completed', taskId }
    }

    // ── 查询 DashScope 任务状态 ───────────────────────
    const taskStatus = await queryTask(taskId)

    switch (taskStatus.status) {
      // ── 成功：下载 + 计费 + 更新 ────────────────────
      case 'SUCCEEDED': {
        const videoUrl = extractVideoUrl(taskStatus.output)
        const savedUrls = videoUrl
          ? await downloadAndMap([videoUrl], taskId, 'video')
          : []

        const modelConfig = getModelById(record.model)
        // 从 DashScope 返回结果中提取实际视频时长
        const inputDuration = inputParams.duration
        const actualVideoDuration = extractVideoDuration(taskStatus.output) || (typeof inputDuration === 'number' ? inputDuration : 5)
        const calculatedCost = modelConfig
          ? calculateCost(modelConfig, extractBillingParams(inputParams), {
              videoDuration: actualVideoDuration,
            })
          : record.cost
        // 标记为 billable + actual（视频异步任务由 worker 完成扣费标记）
        const actualCost = calculatedCost
          ? { ...calculatedCost, billable: true, source: 'actual' as const }
          : null

        // 构造类型安全的 VideoOutputResult — 不展开 raw output，只提取必要字段
        const output: VideoOutputResult = {
          type: 'video',
          savedUrls,
          originalUrl: videoUrl,
        }

        await succeed(record.id, output, actualCost ?? undefined)
        if (actualCost?.totalPriceCents && actualCost.totalPriceCents > 0) {
          await debit({
            accountId: record.accountId,
            generationRecordId: record.id,
            actualCents: actualCost.totalPriceCents,
            description: `视频生成成功扣款：${record.model}`,
          })
          await audit('credit_debit', {
            accountId: record.accountId,
            targetId: record.id,
            detail: {
              accountId: record.accountId,
              generationRecordId: record.id,
              amountCents: actualCost.totalPriceCents,
              description: `视频生成成功扣款：${record.model}`,
              source: 'worker_video',
            },
          }).catch(err => logger.warn({ err, recordId: record.id }, 'Failed to audit credit_debit'))
        }

        // ── 标记 shotVideo canvas_asset 为 succeeded + 设为活跃 ──
        if (canvasMeta) {
          const assetOutputJson = { type: 'video' as const, urls: savedUrls.length > 0 ? savedUrls : (videoUrl ? [videoUrl] : []) }
          const succeededAsset = await markCanvasAssetSucceededByTaskId(
            taskId,
            assetOutputJson,
            savedUrls[0] || videoUrl || undefined,
            undefined,
            videoUrl || undefined,
            actualCost ?? undefined,
          )
          if (succeededAsset) {
            await setCanvasAssetActive(succeededAsset.id)
          }
        }

        const projectStatus = canvasMeta
          ? await updateCanvasShotAndProject(canvasMeta.projectId, canvasMeta.shotId, {
              status: 'completed',
              videoUrl: savedUrls[0] || undefined,
            })
          : undefined

        await notify({
          accountId: record.accountId,
          recordId: record.id,
          status: 'succeeded' as GenerationStatus,
          category: record.category,
          model: record.model,
          taskId,
          traceId: record.traceId ?? undefined,
          outputResult: output,
          cost: actualCost ?? undefined,
          ...(canvasMeta && { canvasMeta: { ...canvasMeta, ...(projectStatus && { projectStatus }) } }),
        })

        // ── 通知：视频生成成功（P2-2） ──
        await notifyUser({
          accountId: record.accountId,
          type: 'task_completed',
          title: '视频生成完成',
          body: `${record.model} · 点击查看结果`,
          meta: {
            recordId: record.id,
            category: record.category,
            ...(canvasMeta && { projectId: canvasMeta.projectId, shotId: canvasMeta.shotId }),
          },
        }).catch(err => logger.warn({ err, recordId: record.id }, 'Failed to push task_completed notification'))

        // ── 通知：Canvas 项目视频阶段全部完成（P2-2） ──
        if (canvasMeta && projectStatus === 'completed') {
          await notifyUser({
            accountId: record.accountId,
            type: 'canvas_completed',
            title: '画布项目已全部完成',
            body: '所有镜头视频生成完毕，可在画布中查看',
            meta: { projectId: canvasMeta.projectId, category: 'video' },
          }).catch(err => logger.warn({ err, projectId: canvasMeta.projectId }, 'Failed to push canvas_completed notification'))
        }

        return { action: 'completed', taskId }
      }

      // ── 失败 ────────────────────────────────────────
      case 'FAILED': {
        const errMsg = taskStatus.errorMessage || 'DashScope task failed'
        await fail(record.id, errMsg)
        await refundReservedCredit(record, refund, `视频生成失败退款：${record.model}`)
        if (record.cost?.totalPriceCents && record.cost.totalPriceCents > 0) {
          await audit('credit_refund', {
            accountId: record.accountId,
            targetId: record.id,
            detail: {
              accountId: record.accountId,
              generationRecordId: record.id,
              amountCents: record.cost.totalPriceCents,
              description: `视频生成失败退款：${record.model}`,
              source: 'worker_video',
            },
          }).catch(err => logger.warn({ err, recordId: record.id }, 'Failed to audit credit_refund'))
        }
        const projectStatus = canvasMeta
          ? await updateCanvasShotAndProject(canvasMeta.projectId, canvasMeta.shotId, {
              status: 'failed',
              errorMessage: errMsg,
            })
          : undefined

        // ── 标记 shotVideo canvas_asset 为失败 ──
        await markCanvasAssetFailedByTaskId(taskId, errMsg).catch(err =>
          logger.warn({ err, taskId }, 'Failed to mark canvas_asset as failed'),
        )

        await notify({
          accountId: record.accountId,
          recordId: record.id,
          status: 'failed' as GenerationStatus,
          category: record.category,
          model: record.model,
          taskId,
          traceId: record.traceId ?? undefined,
          errorMessage: errMsg,
          ...(canvasMeta && { canvasMeta: { ...canvasMeta, ...(projectStatus && { projectStatus }) } }),
        })

        // ── 通知：视频生成失败（P2-2） ──
        await notifyUser({
          accountId: record.accountId,
          type: 'task_failed',
          title: '视频生成失败',
          body: errMsg,
          meta: {
            recordId: record.id,
            category: record.category,
            ...(canvasMeta && { projectId: canvasMeta.projectId, shotId: canvasMeta.shotId }),
          },
        }).catch(err => logger.warn({ err, recordId: record.id }, 'Failed to push task_failed notification'))

        return { action: 'completed', taskId }
      }

      // ── 仍在处理中 ──────────────────────────────────
      case 'PENDING':
      case 'RUNNING': {
        if (record.status === 'pending') {
          await processing(record.id)
        }
        return { action: 'skipped', taskId, reason: `still ${taskStatus.status}` }
      }

      default:
        return { action: 'ignored', taskId, status: taskStatus.status }
    }
  }
}

async function refundReservedCredit(
  record: { id: string, accountId: string, cost: CostDetail | null },
  refund: TaskProcessorDeps['refundCredit'],
  description: string,
) {
  if (!record.cost || record.cost.totalPriceCents <= 0)
    return
  await refund({
    accountId: record.accountId,
    generationRecordId: record.id,
    description,
  })
}

async function updateCanvasShotAndProject(
  projectId: string,
  shotId: string,
  patch: Parameters<typeof updateCanvasShot>[1],
): Promise<'completed' | 'partial_failed' | undefined> {
  await updateCanvasShot(shotId, patch).catch(err =>
    logger.error({ err, shotId }, 'Failed to update canvas shot'),
  )
  return checkProjectCompletion(projectId).catch((err) => {
    logger.error({ err, projectId }, 'Failed to check project completion')
    return undefined
  })
}

// ── 工具函数 ────────────────────────────────────────────

export function extractVideoUrl(output: DashScopeTaskOutput | undefined): string | undefined {
  if (!output)
    return undefined
  const videoUrl = output.video_url
  if (typeof videoUrl === 'string')
    return videoUrl
  const results = output.results
  if (Array.isArray(results) && results.length > 0) {
    const first = results[0]!
    const url = first.url || first.b64_image
    if (typeof url === 'string')
      return url
  }
  return undefined
}

export function extractVideoDuration(output: DashScopeTaskOutput | undefined): number | undefined {
  if (!output)
    return undefined
  const duration = output.video_duration ?? output.duration
  if (typeof duration === 'number')
    return duration
  return undefined
}

/**
 * Check if all canvas shots for a project have finished (no 'generating' shots left).
 * If so, update the project status to 'completed'.
 */
async function checkProjectCompletion(projectId: string): Promise<'completed' | 'partial_failed' | undefined> {
  const shots = await listCanvasShotsByProject(projectId)
  const stillGenerating = shots.some(s => s.status === 'generating')
  if (!stillGenerating && shots.length > 0) {
    const allSucceeded = shots.every(s => s.status === 'completed')
    const projectStatus = allSucceeded ? 'completed' : 'partial_failed'
    await updateCanvasProject(projectId, { status: projectStatus })
    return projectStatus
  }
  return undefined
}
