/**
 * 统一任务 handler dispatch — 基于 task.type 分发到具体 handler
 *
 * Canvas phase handlers 在 P0-3 中已实现（canvas-handlers.ts）。
 * 其他类型暂抛 TaskNotImplementedError。
 */

import type { TaskErrorInfo, TaskRow } from '@excuse/db'
import type { WorkerContext } from './context'
import { markTaskFailed, markTaskRetrying } from '@excuse/db'
import { createLogger } from '@excuse/shared'
import {
  applyTaskFailureWithAdapter,
  classifyTaskError,
  createTaskHandlerRegistry,
  TaskNotImplementedError,
} from '@excuse/task-engine'
import { markRunFailedAndNotify } from './canvas-handlers'

const logger = createLogger('task-handler')

type WorkerTaskOutput = Record<string, unknown> | undefined

const taskRegistry = createTaskHandlerRegistry<TaskRow, WorkerContext, WorkerTaskOutput>([
  {
    type: 'canvas.analyze',
    handler: async (task, ctx) => {
      const { handleCanvasAnalyze } = await import('./canvas-handlers')
      return handleCanvasAnalyze(task, ctx)
    },
  },
  {
    type: 'canvas.characters',
    handler: async (task, ctx) => {
      const { handleCanvasCharacters } = await import('./canvas-handlers')
      return handleCanvasCharacters(task, ctx)
    },
  },
  {
    type: 'canvas.locations',
    handler: async (task, ctx) => {
      const { handleCanvasLocations } = await import('./canvas-handlers')
      return handleCanvasLocations(task, ctx)
    },
  },
  {
    type: 'canvas.characterRefs',
    handler: async (task, ctx) => {
      const { handleCanvasCharacterRefs } = await import('./canvas-handlers')
      return handleCanvasCharacterRefs(task, ctx)
    },
  },
  {
    type: 'canvas.locationRefs',
    handler: async (task, ctx) => {
      const { handleCanvasLocationRefs } = await import('./canvas-handlers')
      return handleCanvasLocationRefs(task, ctx)
    },
  },
  {
    type: 'canvas.storyboard',
    handler: async (task, ctx) => {
      const { handleCanvasStoryboard } = await import('./canvas-handlers')
      return handleCanvasStoryboard(task, ctx)
    },
  },
  {
    type: 'canvas.continuity',
    handler: async (task, ctx) => {
      const { handleCanvasContinuity } = await import('./canvas-handlers')
      return handleCanvasContinuity(task, ctx)
    },
  },
  {
    type: 'canvas.rebuild',
    handler: async (task, ctx) => {
      const { handleCanvasRebuild } = await import('./canvas-handlers')
      return handleCanvasRebuild(task, ctx)
    },
  },
  {
    type: 'canvas.videos',
    handler: async (task, ctx) => {
      const { handleCanvasVideos } = await import('./canvas-handlers')
      return handleCanvasVideos(task, ctx)
    },
  },
  {
    type: 'canvas.dialogue',
    handler: async (task, ctx) => {
      const { getCanvasProjectDetail, updateCanvasShot } = await import('@excuse/db')
      const { runDialoguePhase } = await import('@excuse/canvas-runtime')
      const { getTextModel } = await import('./canvas-execution')

      const projectId = task.projectId!
      const detail = await getCanvasProjectDetail(projectId)
      if (!detail) throw new Error('项目不存在')

      const textModel = getTextModel(detail.project.modelPreferencesJson)
      const { results } = await runDialoguePhase({ projectId, detail, client: ctx.client, textModel })

      for (const result of results) {
        if (result.dialoguePrompt === null && result.dialogueJson === null) continue
        const patch: Record<string, unknown> = { dialoguePrompt: result.dialoguePrompt ?? undefined }
        if (result.dialogueJson) patch.dialogueJson = result.dialogueJson
        await updateCanvasShot(result.shotId, patch as Parameters<typeof updateCanvasShot>[1])
      }
      return { dialogueShotCount: results.filter(r => r.dialogueJson).length }
    },
  },
  {
    type: 'canvas.bgm',
    handler: async (_task, _ctx) => {
      // TODO: Phase 10 — FunMusic BGM 生成
      throw new Error('BGM 阶段尚未实现 (canvas.bgm)')
    },
  },
  {
    type: 'canvas.assemble',
    handler: async (_task, _ctx) => {
      // TODO: Phase 11 — FFmpeg 合成
      throw new Error('合成阶段尚未实现 (canvas.assemble)')
    },
  },

  // ── Media tasks ──────────────────────────────────────
  {
    type: 'media.extract-audio',
    handler: async (task, ctx) => {
      const { handleMediaExtractAudio } = await import('./media-handlers')
      return handleMediaExtractAudio(task, ctx)
    },
  },
  {
    type: 'media.burn-subtitle',
    handler: async (task, ctx) => {
      const { handleMediaBurnSubtitle } = await import('./media-handlers')
      return handleMediaBurnSubtitle(task, ctx)
    },
  },
])

/**
 * 处理已 claim 的 task — 根据 task.type dispatch 到对应 handler
 *
 * handler 返回值：成功时返回 output（可选），失败时抛异常
 * 抛异常由 index.ts 的 handleTaskError 统一处理（retryable vs permanent）
 */
export async function handleTask(task: TaskRow, ctx: WorkerContext): Promise<Record<string, unknown> | undefined> {
  logger.info({ taskId: task.id, type: task.type, domain: task.domain }, 'Handling task')
  return taskRegistry.handle(task, ctx)
}

/**
 * Task handler 错误处理 — 区分 retriable vs permanent
 *
 * retriable 且 attempts < maxAttempts → markTaskRetrying（nextRunAt 推迟）
 * permanent 或超过 maxAttempts → markTaskFailed
 * Canvas domain: additionally markRunFailedAndNotify (pipeline run + PG NOTIFY)
 */
export async function handleTaskError(task: TaskRow, error: unknown): Promise<void> {
  const isNotImplemented = error instanceof TaskNotImplementedError
  const errorMessage = error instanceof Error ? error.message : String(error)

  if (isNotImplemented) {
    const decision = classifyTaskError(error)
    const errorInfo: TaskErrorInfo = {
      category: decision.category,
      retriable: decision.retriable,
      message: errorMessage,
    }
    await markTaskFailed(task.id, errorInfo, errorMessage)
    logger.warn({ taskId: task.id, type: task.type }, `Task type not implemented: ${task.type}`)
    return
  }

  const failureAction = await applyTaskFailureWithAdapter({
    task,
    error,
    adapter: {
      markTaskRetrying,
      markTaskFailed,
    },
  })

  if (failureAction.action === 'retry') {
    logger.info({ taskId: task.id, type: task.type, attempts: task.attempts, nextRetryDelay: failureAction.delayMs }, 'Task retrying')
  }
  else {
    logger.error({ taskId: task.id, type: task.type, attempts: task.attempts }, `Task permanently failed: ${errorMessage}`)

    // Canvas 任务额外标记 pipeline run 为 failed + PG NOTIFY
    if (task.domain === 'canvas' && task.projectId) {
      await markRunFailedAndNotify(task, errorMessage)
    }
  }
}
