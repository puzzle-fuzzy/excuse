/**
 * Canvas pipeline phase handlers — Worker 端执行
 *
 * Worker 本地执行 Canvas phase，不再动态加载 server modules。
 * Handler 入口和出口通过 PostgreSQL NOTIFY 发通知。
 */

import type { TaskRow } from '@excuse/db'
import type { WorkerContext } from './context'
import {
  getCanvasProjectById,
  markPipelineRunFailed,
  markPipelineRunRunning,
  markPipelineRunSucceeded,
  pgClient,
} from '@excuse/db'
import { createLogger } from '@excuse/shared'
import { executeCanvasAnalysis } from './canvas-analysis'
import { executeCanvasAssemble } from './canvas-assemble'
import { executeCanvasBgm } from './canvas-bgm'
import { executeCanvasCharacterRefs } from './canvas-character-refs'
import { executeCanvasCharacters } from './canvas-characters'
import { executeCanvasContinuity } from './canvas-continuity'
import { executeCanvasDialogue } from './canvas-dialogue'
import { executeCanvasLocationRefs } from './canvas-location-refs'
import { executeCanvasLocations } from './canvas-locations'
import { executeCanvasRebuild } from './canvas-rebuild'
import { executeCanvasStoryboard } from './canvas-storyboard'
import { executeCanvasVideos } from './canvas-videos'

const logger = createLogger('canvas-handlers')

// ── PostgreSQL NOTIFY helper ──────────────────────────────

async function notifyNodeViaPgNotify(
  accountId: string,
  projectId: string,
  nodeType: string,
  nodeId: string,
  status: string,
  data?: Record<string, unknown>,
  error?: string,
  runId?: string,
) {
  await pgClient.notify('canvas_node_update', JSON.stringify({
    accountId,
    projectId,
    nodeType,
    nodeId,
    status,
    data,
    error,
    runId,
  }))
}

// ── Pipeline run 状态管理 ──────────────────────────────────

async function markRunRunningAndNotify(task: TaskRow): Promise<string | null> {
  const runId = task.targetId ?? null
  if (!runId)
    return null

  await markPipelineRunRunning(runId)

  const pid = task.projectId
  if (!pid)
    throw new Error(`task ${task.id} has no projectId`)
  let project
  try {
    project = await getCanvasProjectById(pid)
  }
  catch (dbErr) {
    logger.error({ pid, dbErr, taskId: task.id }, 'getCanvasProjectById failed')
    throw dbErr
  }
  if (project) {
    const phaseKey = task.type.replace('canvas.', '')
    await notifyNodeViaPgNotify(project.accountId, task.projectId!, 'phase', phaseKey, 'running', undefined, undefined, runId)
  }
  return runId
}

async function markRunSucceededAndNotify(task: TaskRow, outputSummary?: Record<string, unknown>): Promise<void> {
  const runId = task.targetId ?? null
  if (runId) {
    await markPipelineRunSucceeded(runId, outputSummary)
  }

  const pid = task.projectId
  if (!pid)
    return
  const project = await getCanvasProjectById(pid)
  if (project) {
    const phaseKey = task.type.replace('canvas.', '')
    await notifyNodeViaPgNotify(project.accountId, task.projectId!, 'phase', phaseKey, 'completed', outputSummary, undefined, runId ?? undefined)
  }
}

/** Mark pipeline run as failed + notify frontend — called by handleTaskError */
export async function markRunFailedAndNotify(task: TaskRow, errorMessage: string): Promise<void> {
  const runId = task.targetId ?? null
  if (runId) {
    await markPipelineRunFailed(runId, errorMessage)
  }

  const project = await getCanvasProjectById(task.projectId!)
  if (project) {
    const phaseKey = task.type.replace('canvas.', '')
    await notifyNodeViaPgNotify(project.accountId, task.projectId!, 'phase', phaseKey, 'failed', undefined, errorMessage, runId ?? undefined)
  }
}

// ── Canvas phase handlers ──────────────────────────────────

export async function handleCanvasAnalyze(task: TaskRow, ctx: WorkerContext): Promise<Record<string, unknown>> {
  const projectId = task.projectId!
  const runId = await markRunRunningAndNotify(task)
  const result = await executeCanvasAnalysis(projectId, ctx.client, runId ?? undefined)
  await markRunSucceededAndNotify(task, result)
  return result
}

export async function handleCanvasCharacters(task: TaskRow, ctx: WorkerContext): Promise<Record<string, unknown>> {
  const projectId = task.projectId!
  const runId = await markRunRunningAndNotify(task)
  const result = await executeCanvasCharacters(projectId, ctx.client, runId ?? undefined)
  await markRunSucceededAndNotify(task, result)
  return result
}

export async function handleCanvasLocations(task: TaskRow, ctx: WorkerContext): Promise<Record<string, unknown>> {
  const projectId = task.projectId!
  const runId = await markRunRunningAndNotify(task)
  const result = await executeCanvasLocations(projectId, ctx.client, runId ?? undefined)
  await markRunSucceededAndNotify(task, result)
  return result
}

export async function handleCanvasCharacterRefs(task: TaskRow, ctx: WorkerContext): Promise<Record<string, unknown>> {
  const projectId = task.projectId!
  const runId = await markRunRunningAndNotify(task)
  const result = await executeCanvasCharacterRefs(projectId, ctx.client, ctx.storage, runId ?? undefined)
  await markRunSucceededAndNotify(task, result)
  return result
}

export async function handleCanvasLocationRefs(task: TaskRow, ctx: WorkerContext): Promise<Record<string, unknown>> {
  const projectId = task.projectId!
  const runId = await markRunRunningAndNotify(task)
  const result = await executeCanvasLocationRefs(projectId, ctx.client, ctx.storage, runId ?? undefined)
  await markRunSucceededAndNotify(task, result)
  return result
}

export async function handleCanvasStoryboard(task: TaskRow, ctx: WorkerContext): Promise<Record<string, unknown>> {
  const projectId = task.projectId!
  const runId = await markRunRunningAndNotify(task)
  const result = await executeCanvasStoryboard(projectId, ctx.client, runId ?? undefined)
  await markRunSucceededAndNotify(task, result)
  return result
}

export async function handleCanvasContinuity(task: TaskRow, _ctx: WorkerContext): Promise<Record<string, unknown>> {
  const projectId = task.projectId!
  const runId = await markRunRunningAndNotify(task)
  const result = await executeCanvasContinuity(projectId, runId ?? undefined)
  await markRunSucceededAndNotify(task, result)
  return result
}

export async function handleCanvasRebuild(task: TaskRow, _ctx: WorkerContext): Promise<Record<string, unknown>> {
  const projectId = task.projectId!
  const runId = await markRunRunningAndNotify(task)
  const result = await executeCanvasRebuild(projectId, runId ?? undefined)
  await markRunSucceededAndNotify(task, result)
  return result
}

export async function handleCanvasVideos(task: TaskRow, ctx: WorkerContext): Promise<Record<string, unknown>> {
  const projectId = task.projectId!
  const runId = await markRunRunningAndNotify(task)
  const result = await executeCanvasVideos(projectId, ctx.client, runId ?? undefined, task.id)
  await markRunSucceededAndNotify(task, result)
  return result
}

export async function handleCanvasDialogue(task: TaskRow, ctx: WorkerContext): Promise<Record<string, unknown>> {
  const projectId = task.projectId!
  await markRunRunningAndNotify(task)
  const result = await executeCanvasDialogue(projectId, ctx.client)
  await markRunSucceededAndNotify(task, result)
  return result
}

export async function handleCanvasBgm(task: TaskRow, ctx: WorkerContext): Promise<Record<string, unknown>> {
  const projectId = task.projectId!
  await markRunRunningAndNotify(task)
  const result = await executeCanvasBgm(projectId, ctx.client, ctx.storage)
  await markRunSucceededAndNotify(task, result)
  return result
}

export async function handleCanvasAssemble(task: TaskRow, ctx: WorkerContext): Promise<Record<string, unknown>> {
  const projectId = task.projectId!
  await markRunRunningAndNotify(task)
  const result = await executeCanvasAssemble(projectId, ctx.storage, ctx.config.storageRoot)
  await markRunSucceededAndNotify(task, result)
  return result
}
