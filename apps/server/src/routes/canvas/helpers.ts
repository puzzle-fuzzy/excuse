/**
 * Canvas 路由共享辅助函数
 *
 * 从 routes/canvas.ts 抽离，供子模块共用。
 */

import type { CanvasPipelinePhase } from '@excuse/db'
import type { AcceptedResponse } from '@excuse/shared'
import { createPipelineRun, createTask, linkPipelineRunToTask, updateCanvasProject } from '@excuse/db'
import { getTaskPriority } from '@excuse/task-engine'
import { createLogger } from '@excuse/shared'
import { audit } from '../../services/audit'
import { notifyCanvasPhaseFailed } from '../../services/notifications'
import { dispatchToUser } from '../../services/sse-manager'

const logger = createLogger('canvas-routes')

export function acceptedResponse(runId?: string): AcceptedResponse {
  return runId ? { accepted: true, runId } : { accepted: true }
}

/**
 * fire-and-forget 包装器 — 管道阶段的后台执行与结果推送
 */
export function fireAndForgetWithRun(
  userId: string,
  projectId: string,
  phaseKey: string,
  runId: string,
  promise: Promise<unknown>,
) {
  promise
    .then(() => {
      dispatchToUser(userId, 'pipeline_node_update', {
        projectId,
        nodeType: 'phase',
        nodeId: phaseKey,
        status: 'completed',
        runId,
      })
    })
    .catch((err) => {
      logger.error({ err, projectId, phaseKey }, `${phaseKey} failed`)
      updateCanvasProject(projectId, { status: 'failed' }).catch(dbErr =>
        logger.error({ err: dbErr, projectId }, 'Failed to update project status to failed'),
      )
      dispatchToUser(userId, 'pipeline_node_update', {
        projectId,
        nodeType: 'phase',
        nodeId: phaseKey,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        runId,
      })
      notifyCanvasPhaseFailed(userId, projectId, phaseKey, err instanceof Error ? err.message : String(err)).catch(() => {})
    })
}

/**
 * task-driven 模式 — 创建 pipeline_run + task，由 Worker 执行
 */
export async function createTaskDrivenPhase(
  userId: string,
  projectId: string,
  phase: CanvasPipelinePhase,
): Promise<AcceptedResponse> {
  const run = await createPipelineRun({ projectId, phase, createdBy: userId })
  const task = await createTask({
    accountId: userId,
    type: `canvas.${phase}`,
    domain: 'canvas',
    priority: getTaskPriority({ type: `canvas.${phase}`, domain: 'canvas' }),
    projectId,
    targetType: 'pipeline_run',
    targetId: run.id,
  })
  await linkPipelineRunToTask(run.id, task.id)

  audit('canvas_phase_run', { accountId: userId, targetId: projectId, detail: { phase, projectId, runId: run.id, autoProgress: true, taskId: task.id } })

  dispatchToUser(userId, 'pipeline_node_update', {
    projectId,
    nodeType: 'phase',
    nodeId: phase,
    status: 'queued',
    runId: run.id,
  })

  return acceptedResponse(run.id)
}

/**
 * fire-and-forget 模式 — 创建 pipeline_run + audit + 后台执行
 */
export async function createFireAndForgetPhase(
  userId: string,
  projectId: string,
  phase: CanvasPipelinePhase,
  factory: (runId: string) => Promise<unknown>,
): Promise<AcceptedResponse> {
  const run = await createPipelineRun({ projectId, phase, createdBy: userId })
  audit('canvas_phase_run', { accountId: userId, targetId: projectId, detail: { phase, projectId, runId: run.id, autoProgress: false } })
  fireAndForgetWithRun(userId, projectId, phase, run.id, factory(run.id))
  return acceptedResponse(run.id)
}
