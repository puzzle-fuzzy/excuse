/**
 * Canvas 流水线阶段 handler — 9 个阶段 + cancel-active
 */
import type { CanvasPipelinePhase } from '@excuse/db'
import type { ServerContext } from '../../context'
import type { AcceptedResponse } from '@excuse/shared'
import {
  cancelActiveCanvasAssetsByProject, cancelTask,
  findActiveRunForPhase, getCanvasProjectByIdForAccount,
  listPipelineRunsByProject, markPipelineRunCancelled,
} from '@excuse/db'
import { cancelTaskWithAdapter } from '@excuse/task-engine'
import { canCancelPipelineRun } from '@excuse/workflow-engine'
import * as svc from '../../modules/canvas/service'
import { createFireAndForgetPhase, createTaskDrivenPhase } from './helpers'
import { ConflictError, NotFoundError } from '../../utils/app-errors'
import { audit } from '../../services/audit'
import { dispatchToUser } from '../../services/sse-manager'

type PhaseFactory = (runId: string) => Promise<unknown>

async function runPhase(projectId: string, userId: string, phase: CanvasPipelinePhase, execute: PhaseFactory) {
  const owned = await getCanvasProjectByIdForAccount(projectId, userId)
  if (!owned) throw new NotFoundError('项目不存在或无权访问')
  const activeRun = await findActiveRunForPhase(projectId, phase)
  if (activeRun) throw new ConflictError('该阶段已有进行中的任务')
  const autoProgress = owned.modelPreferencesJson?.autoProgress ?? false
  if (autoProgress) return createTaskDrivenPhase(userId, projectId, phase)
  return createFireAndForgetPhase(userId, projectId, phase, runId => execute(runId))
}

export function handleAnalyzePhase(projectId: string, userId: string, ctx: ServerContext): Promise<AcceptedResponse> {
  return runPhase(projectId, userId, 'analyze', runId => svc.analyzeProject(projectId, ctx.client, runId))
}

export function handleCharactersPhase(projectId: string, userId: string, ctx: ServerContext): Promise<AcceptedResponse> {
  return runPhase(projectId, userId, 'characters', runId => svc.generateCharacters(projectId, ctx.client, runId))
}

export function handleLocationsPhase(projectId: string, userId: string, ctx: ServerContext): Promise<AcceptedResponse> {
  return runPhase(projectId, userId, 'locations', runId => svc.generateLocations(projectId, ctx.client, runId))
}

export function handleCharacterRefsPhase(projectId: string, userId: string, ctx: ServerContext): Promise<AcceptedResponse> {
  return runPhase(projectId, userId, 'characterRefs', runId => svc.generateCharacterRefs(projectId, ctx.client, ctx.storage, runId))
}

export function handleLocationRefsPhase(projectId: string, userId: string, ctx: ServerContext): Promise<AcceptedResponse> {
  return runPhase(projectId, userId, 'locationRefs', runId => svc.generateLocationRefs(projectId, ctx.client, ctx.storage, runId))
}

export function handleStoryboardPhase(projectId: string, userId: string, ctx: ServerContext): Promise<AcceptedResponse> {
  return runPhase(projectId, userId, 'storyboard', runId => svc.generateStoryboard(projectId, ctx.client, runId))
}

export function handleContinuityPhase(projectId: string, userId: string, _ctx: ServerContext): Promise<AcceptedResponse> {
  return runPhase(projectId, userId, 'continuity', runId => svc.checkContinuity(projectId, runId))
}

export function handleRebuildPhase(projectId: string, userId: string, _ctx: ServerContext): Promise<AcceptedResponse> {
  return runPhase(projectId, userId, 'rebuild', runId => svc.rebuildShotPrompts(projectId, runId))
}

export function handleVideosPhase(projectId: string, userId: string, ctx: ServerContext): Promise<AcceptedResponse> {
  return runPhase(projectId, userId, 'videos', runId => svc.generateVideos(projectId, ctx.client, runId))
}

export function handleDialoguePhase(projectId: string, userId: string, _ctx: ServerContext): Promise<AcceptedResponse> {
  return runPhase(projectId, userId, 'dialogue', async (_runId) => {
    // TODO: Phase 8.5 — LLM 为每个 shot 生成对话层 prompt
    throw new Error('对话阶段尚未实现')
  })
}

export function handleBgmPhase(projectId: string, userId: string, _ctx: ServerContext): Promise<AcceptedResponse> {
  return runPhase(projectId, userId, 'bgm', async (_runId) => {
    // TODO: Phase 10 — FunMusic BGM 生成
    throw new Error('BGM 阶段尚未实现')
  })
}

export function handleAssemblePhase(projectId: string, userId: string, _ctx: ServerContext): Promise<AcceptedResponse> {
  return runPhase(projectId, userId, 'assemble', async (_runId) => {
    // TODO: Phase 11 — FFmpeg 合成
    throw new Error('合成阶段尚未实现')
  })
}

export async function handleCancelActive(projectId: string, userId: string) {
  const owned = await getCanvasProjectByIdForAccount(projectId, userId)
  if (!owned) throw new NotFoundError('项目不存在或无权访问')

  const runs = await listPipelineRunsByProject(projectId)
  const activeRuns = runs.filter(canCancelPipelineRun)
  if (activeRuns.length === 0) return { cancelled: 0, message: '当前没有活跃的阶段任务' }

  let cancelledCount = 0
  const cancelledPhases: string[] = []
  for (const run of activeRuns) {
    const cancelled = await markPipelineRunCancelled(run.id)
    if (cancelled) {
      cancelledCount++
      cancelledPhases.push(cancelled.phase)
      if (cancelled.taskId) await cancelTaskWithAdapter({ taskId: cancelled.taskId, adapter: { cancelTask } }).catch(() => {})
      dispatchToUser(userId, 'pipeline_node_update', {
        projectId, nodeType: 'phase', nodeId: cancelled.phase, status: 'cancelled', runId: run.id,
      })
    }
  }
  await cancelActiveCanvasAssetsByProject(projectId).catch(() => {})
  audit('canvas_cancel', { accountId: userId, targetId: projectId, detail: { projectId, cancelledRuns: cancelledCount, phases: cancelledPhases } })
  return { cancelled: cancelledCount, message: `已取消 ${cancelledCount} 个活跃阶段` }
}
