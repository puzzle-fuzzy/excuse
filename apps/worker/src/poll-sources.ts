import type { WorkerContext } from './context'
import type { WorkerHealthState } from './health'
/**
 * Worker 轮询源实现 — 三个 PollSource：统一任务队列 / 遗留视频轮询 / ASR 字幕
 */
import type { PollSource } from './poll-source'
import { claimNextTask, extendTaskLock, getTaskById, markTaskSucceeded, notifyTaskStatusChange, pollPendingASRProjects, pollPendingVideoTasks, releaseASRProjectClaims, releaseVideoTaskClaims } from '@excuse/db'
import { createLogger } from '@excuse/shared'
import { claimNextTaskWithAdapter, completeTaskWithAdapter } from '@excuse/task-engine'
import { startTaskHeartbeat } from './heartbeat'
import { advancePipelineAfterTaskSuccess } from './pipeline-stepper'
import { processASRTask } from './subtitle-processor'
import { handleTask, handleTaskError } from './task-handler'
import { createTaskProcessor } from './task-processor'

const logger = createLogger('poll-sources')

const workerId = `worker-${process.env.HOSTNAME ?? 'local'}-${process.pid}`

/** claimNextTaskWithAdapter 认领到的任务（已 null-check）— 与 handleTask 入参同型 */
type ClaimedTask = Parameters<typeof handleTask>[0]

/**
 * 统一任务队列轮询源 — claim + handle + complete + auto-advance
 *
 * in-flight promise 写入 currentTaskPromiseRef，使优雅退出能 drain 最长的阶段
 * （如 canvas.assemble 数分钟的 FFmpeg 合成），而非只 drain 视频轮询（TODO2 §1.3）。
 */
export function createTaskPollSource(
  ctx: WorkerContext,
  healthState: WorkerHealthState,
  refs: { currentTaskPromiseRef: { value: Promise<unknown> | null } },
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

      const execution = executeClaimedTask(claimedTask)
      refs.currentTaskPromiseRef.value = execution
      try {
        await execution
      }
      finally {
        refs.currentTaskPromiseRef.value = null
        stopHeartbeat()
        healthState.currentTaskId = null
      }

      return 1
    },
  }

  /** handle → complete → auto-advance（失败走 handleTaskError）。错误被吞，不外抛。 */
  async function executeClaimedTask(claimedTask: ClaimedTask): Promise<void> {
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
    currentTaskPromiseRef: { value: Promise<unknown> | null }
  },
): PollSource {
  const processor = createTaskProcessor(ctx)

  return {
    name: 'video',
    poll: async () => {
      const records = await pollPendingVideoTasks(workerId, ctx.config.claimTtlMs)
      let count = 0

      for (const record of records) {
        if (!refs.runningRef.value)
          break

        try {
          const taskLogger = logger.child({ taskId: record.taskId, traceId: record.traceId })
          const taskPromise = processor.processTask(record)
          refs.currentTaskPromiseRef.value = taskPromise
          const result = await taskPromise

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
        }
        finally {
          refs.currentTaskPromiseRef.value = null
          await releaseVideoTaskClaims([record.id], workerId)
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
      const asrProjects = await pollPendingASRProjects(workerId, ctx.config.claimTtlMs)
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
        finally {
          await releaseASRProjectClaims([project.id], workerId)
        }
      }

      return count
    },
  }
}
