import type { WorkerContext } from './context'
import type { WorkerHealthState } from './health'
/**
 * Worker 轮询源实现 — 三个 PollSource：统一任务队列 / 遗留视频轮询 / ASR 字幕
 */
import type { PollSource } from './poll-source'
import type { TaskResult } from './task-processor'
import { claimNextTask, extendTaskLock, getTaskById, markTaskSucceeded, notifyTaskStatusChange, pollPendingASRProjects, pollPendingVideoTasks } from '@excuse/db'
import { createLogger } from '@excuse/shared'
import { claimNextTaskWithAdapter, completeTaskWithAdapter } from '@excuse/task-engine'
import { startTaskHeartbeat } from './heartbeat'
import { advancePipelineAfterTaskSuccess } from './pipeline-stepper'
import { processASRTask } from './subtitle-processor'
import { handleTask, handleTaskError } from './task-handler'
import { createTaskProcessor } from './task-processor'

const logger = createLogger('poll-sources')

const workerId = `worker-${process.env.HOSTNAME ?? 'local'}-${process.pid}`

/**
 * 统一任务队列轮询源 — claim + handle + complete + auto-advance
 */
export function createTaskPollSource(
  ctx: WorkerContext,
  healthState: WorkerHealthState,
): PollSource {
  return {
    name: 'tasks',
    poll: async () => {
      const claimedTask = await claimNextTaskWithAdapter({
        workerId,
        claimTtlMs: ctx.config.claimTtlMs,
        adapter: { claimNextTask },
      })
      if (!claimedTask)
        return 0

      healthState.tasksClaimed++
      healthState.currentTaskId = claimedTask.id
      const stopHeartbeat = startTaskHeartbeat(claimedTask.id, workerId, ctx.config.claimTtlMs, { extendTaskLock })

      try {
        const output = await handleTask(claimedTask, ctx)
        const succeeded = await completeTaskWithAdapter({
          task: claimedTask,
          output,
          adapter: { markTaskSucceeded, notifyTaskStatusChange },
        })
        if (succeeded) {
          healthState.totalTasksProcessed++
          logger.info({ taskId: claimedTask.id, type: claimedTask.type }, '✅ Task completed')

          const nextTaskId = await advancePipelineAfterTaskSuccess(succeeded, ctx.config)
          if (nextTaskId) {
            logger.info({ nextTaskId, projectId: claimedTask.projectId }, '🔗 Pipeline auto-advanced')
          }
        }
      }
      catch (error) {
        await handleTaskError(claimedTask, error)
        const updatedTask = await getTaskById(claimedTask.id)
        if (updatedTask) {
          await notifyTaskStatusChange(updatedTask)
        }
      }
      finally {
        stopHeartbeat()
        healthState.currentTaskId = null
      }

      return 1
    },
  }
}

/**
 * 遗留视频任务轮询源 — pollPendingVideoTasks → processor.processTask
 */
export function createVideoPollSource(
  ctx: WorkerContext,
  healthState: WorkerHealthState,
  refs: {
    runningRef: { value: boolean }
    currentTaskPromiseRef: { value: Promise<TaskResult> | null }
  },
): PollSource {
  const processor = createTaskProcessor(ctx)

  return {
    name: 'video',
    poll: async () => {
      const records = await pollPendingVideoTasks()
      let count = 0

      for (const record of records) {
        if (!refs.runningRef.value)
          break

        const taskLogger = logger.child({ taskId: record.taskId, traceId: record.traceId })
        refs.currentTaskPromiseRef.value = processor.processTask(record)
        const result = await refs.currentTaskPromiseRef.value
        refs.currentTaskPromiseRef.value = null

        if (result.action === 'completed') {
          healthState.totalTasksProcessed++
        }

        switch (result.action) {
          case 'completed':
            taskLogger.info('✅ Task completed')
            break
          case 'skipped':
            if (result.reason === 'no taskId') {
              taskLogger.info({ recordId: record.id, reason: result.reason }, '⏭️ Record skipped')
            }
            break
          case 'ignored':
            taskLogger.warn({ status: result.status }, '⚠️ Unknown task status')
            break
        }
        count++
      }

      return count
    },
  }
}

/**
 * ASR 字幕任务轮询源 — pollPendingASRProjects → processASRTask
 */
export function createAsrPollSource(
  ctx: WorkerContext,
  healthState: WorkerHealthState,
): PollSource {
  return {
    name: 'asr',
    poll: async () => {
      const asrProjects = await pollPendingASRProjects()
      let count = 0

      for (const project of asrProjects) {
        if (!healthState.isPolling)
          break // running 信号已在主循环检查
        try {
          await processASRTask(project, ctx.asrClient, { staleTimeoutMs: ctx.config.asrStaleTimeoutMs })
          healthState.totalTasksProcessed++
          count++
        }
        catch (err) {
          logger.error({ err, projectId: project.id }, 'ASR task processing error')
        }
      }

      return count
    },
  }
}
