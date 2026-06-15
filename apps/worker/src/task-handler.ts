/**
 * 统一任务 handler dispatch — 基于 task.type 分发到具体 handler
 *
 * Canvas phase handlers 在 P0-3 中已实现（canvas-handlers.ts）。
 * 其他类型暂抛 TaskNotImplementedError。
 */

import type { TaskErrorInfo, TaskRow } from '@excuse/db'
import type { WorkerConfig } from './config'
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

const taskRegistry = createTaskHandlerRegistry<TaskRow, WorkerConfig, WorkerTaskOutput>([
  {
    type: 'canvas.analyze',
    handler: async (task, workerConfig) => {
      const { handleCanvasAnalyze } = await import('./canvas-handlers')
      return handleCanvasAnalyze(task, workerConfig)
    },
  },
  {
    type: 'canvas.characters',
    handler: async (task, workerConfig) => {
      const { handleCanvasCharacters } = await import('./canvas-handlers')
      return handleCanvasCharacters(task, workerConfig)
    },
  },
  {
    type: 'canvas.locations',
    handler: async (task, workerConfig) => {
      const { handleCanvasLocations } = await import('./canvas-handlers')
      return handleCanvasLocations(task, workerConfig)
    },
  },
  {
    type: 'canvas.characterRefs',
    handler: async (task, workerConfig) => {
      const { handleCanvasCharacterRefs } = await import('./canvas-handlers')
      return handleCanvasCharacterRefs(task, workerConfig)
    },
  },
  {
    type: 'canvas.locationRefs',
    handler: async (task, workerConfig) => {
      const { handleCanvasLocationRefs } = await import('./canvas-handlers')
      return handleCanvasLocationRefs(task, workerConfig)
    },
  },
  {
    type: 'canvas.storyboard',
    handler: async (task, workerConfig) => {
      const { handleCanvasStoryboard } = await import('./canvas-handlers')
      return handleCanvasStoryboard(task, workerConfig)
    },
  },
  {
    type: 'canvas.continuity',
    handler: async (task, workerConfig) => {
      const { handleCanvasContinuity } = await import('./canvas-handlers')
      return handleCanvasContinuity(task, workerConfig)
    },
  },
  {
    type: 'canvas.rebuild',
    handler: async (task, workerConfig) => {
      const { handleCanvasRebuild } = await import('./canvas-handlers')
      return handleCanvasRebuild(task, workerConfig)
    },
  },
  {
    type: 'canvas.videos',
    handler: async (task, workerConfig) => {
      const { handleCanvasVideos } = await import('./canvas-handlers')
      return handleCanvasVideos(task, workerConfig)
    },
  },

  // ── Media tasks ──────────────────────────────────────
  {
    type: 'media.extract-audio',
    handler: async (task, workerConfig) => {
      const { handleMediaExtractAudio } = await import('./media-handlers')
      return handleMediaExtractAudio(task, workerConfig)
    },
  },
  {
    type: 'media.burn-subtitle',
    handler: async (task, workerConfig) => {
      const { handleMediaBurnSubtitle } = await import('./media-handlers')
      return handleMediaBurnSubtitle(task, workerConfig)
    },
  },
])

/**
 * 处理已 claim 的 task — 根据 task.type dispatch 到对应 handler
 *
 * handler 返回值：成功时返回 output（可选），失败时抛异常
 * 抛异常由 index.ts 的 handleTaskError 统一处理（retryable vs permanent）
 */
export async function handleTask(task: TaskRow, workerConfig: WorkerConfig): Promise<Record<string, unknown> | undefined> {
  logger.info({ taskId: task.id, type: task.type, domain: task.domain }, 'Handling task')
  return taskRegistry.handle(task, workerConfig)
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
