import type { DashScopeTaskOutput } from '@excuse/provider'
/**
 * 视频任务处理的纯工具函数 — 从 task-processor.ts 抽离
 *
 * 包含：URL/时长提取、退款、镜头/项目状态更新、项目完成检查
 */
import type { CostDetail } from '@excuse/shared'
import { listCanvasShotsByProject, updateCanvasProject, updateCanvasShot } from '@excuse/db'
import { createLogger } from '@excuse/shared'

const logger = createLogger('worker-processor')

/** 提取 DashScope 视频输出的 URL */
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

/** 提取 DashScope 视频输出的实际时长 */
export function extractVideoDuration(output: DashScopeTaskOutput | undefined): number | undefined {
  if (!output)
    return undefined
  const duration = output.video_duration ?? output.duration
  if (typeof duration === 'number')
    return duration
  return undefined
}

/** 退款：仅在已有扣款时执行 */
export async function refundReservedCredit(
  record: { id: string, accountId: string, cost: CostDetail | null },
  refund: (opts: { accountId: string, generationRecordId: string, description?: string }) => Promise<unknown>,
  description: string,
) {
  if (!record.cost || record.cost.totalPriceCents <= 0)
    return
  await refund({ accountId: record.accountId, generationRecordId: record.id, description })
}

/** 更新镜头状态 + 检查项目是否全部完成 */
export async function updateCanvasShotAndProject(
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

/** 检查项目所有镜头是否全部结束（无 generating），返回项目终态 */
export async function checkProjectCompletion(projectId: string): Promise<'completed' | 'partial_failed' | undefined> {
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
