/**
 * Pipeline Stepper — Canvas 自动执行阶段推进器
 *
 * Worker 完成当前 phase task 后，如果项目的 autoProgress=true，
 * 自动创建下一个 phase 的 pipeline_run + task。
 *
 * 暂停阶段（storyboard、videos、assemble）不自动推进，需要用户确认。
 *
 * PHASE_ORDER 定义了 12 个阶段的严格顺序。
 * PAUSE_BEFORE 定义了需要用户确认才能继续的阶段。
 */

import type { CanvasPipelinePhase } from '@excuse/workflow-engine'
import type { WorkerConfig } from './config'
import {
  createPipelineRun,
  createTask,
  findActiveRunForPhase,
  getCanvasProjectById,
  linkPipelineRunToTask,
} from '@excuse/db'
import { createLogger } from '@excuse/shared'
import {
  canAdvanceToPhase,
  CANVAS_PAUSE_BEFORE,
  CANVAS_PHASE_ORDER,
  createNextCanvasPipelineTask,
  decideCanvasAutoAdvance,
} from '@excuse/workflow-engine'

const logger = createLogger('pipeline-stepper')

/** 12 个阶段的严格顺序 */
export const PHASE_ORDER: readonly CanvasPipelinePhase[] = CANVAS_PHASE_ORDER

/** 需要用户确认才能继续的阶段 — 自动执行到此暂停 */
export const PAUSE_BEFORE: ReadonlySet<CanvasPipelinePhase> = CANVAS_PAUSE_BEFORE

/**
 * Worker task 完成后，检查是否应自动推进到下一个 pipeline phase
 *
 * 推进条件：
 *   1. task.domain === 'canvas'
 *   2. task.projectId 存在
 *   3. 项目的 modelPreferencesJson.autoProgress === true
 *   4. 下一个 phase 不在 PAUSE_BEFORE 中
 *   5. 下一个 phase 没有 active run（并发守卫）
 *
 * @returns 创建的 task ID（如果推进成功），null（如果不推进）
 */
export async function advancePipelineAfterTaskSuccess(
  task: { id: string, type: string, domain: string, projectId: string | null, accountId: string | null, traceId?: string | null },
  _workerConfig: WorkerConfig,
): Promise<string | null> {
  const preflight = decideCanvasAutoAdvance(task, true)
  if (!preflight.currentPhase || !preflight.nextPhase)
    return null

  const { projectId, accountId } = task
  if (!projectId || !accountId)
    return null

  const project = await getCanvasProjectById(projectId)
  if (!project)
    return null

  const decision = decideCanvasAutoAdvance(task, Boolean(project.modelPreferencesJson?.autoProgress))
  if (!decision.shouldAdvance) {
    if (decision.reason === 'auto_progress_disabled') {
      logger.info({ projectId, nextPhase: decision.nextPhase }, 'autoProgress=false, skipping auto-advance')
    }
    else if (decision.reason === 'pause_before') {
      logger.info({ projectId, nextPhase: decision.nextPhase }, 'pause-before phase, waiting for user confirmation')
    }
    return null
  }

  const currentPhase = decision.currentPhase
  const nextPhase = decision.nextPhase
  if (!currentPhase || !nextPhase)
    return null

  // 6. 并发守卫 — 下一个 phase 没有 active run
  // 复用 workflow-engine 的推进守卫（pause-before 理论上已被 decideCanvasAutoAdvance 拦截，
  // 这里 hasActiveRun 是真正的并发防护）
  const activeRun = await findActiveRunForPhase(projectId, nextPhase)
  if (!canAdvanceToPhase(nextPhase, { hasActiveRun: Boolean(activeRun) })) {
    logger.info({ projectId, nextPhase, activeRunId: activeRun?.id }, 'next phase blocked by advance guard, skipping')
    return null
  }

  try {
    const result = await createNextCanvasPipelineTask({
      projectId,
      accountId,
      nextPhase,
      traceId: task.traceId,
      adapter: {
        createPipelineRun,
        createTask,
        linkPipelineRunToTask,
      },
    })

    logger.info({ projectId, currentPhase, nextPhase, runId: result.runId, taskId: result.taskId }, 'pipeline auto-advanced to next phase')
    return result.taskId
  }
  catch (err) {
    logger.error({ err, projectId, nextPhase }, 'failed to auto-advance pipeline')
    return null
  }
}
