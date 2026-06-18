import type { WorkerContext } from './context'
import type { WorkerHealthState } from './health'
/**
 * Worker 轮询源实现 — 单个 PollSource：统一任务队列（video/ASR 已迁入）
 */
import type { PollSource } from './poll-source'
import { claimNextTask, extendTaskLock, getTaskById, markTaskSucceeded, notifyTaskStatusChange } from '@excuse/db'
import { createLogger } from '@excuse/shared'
import { claimNextTaskWithAdapter, completeTaskWithAdapter } from '@excuse/task-engine'
import { startTaskHeartbeat } from './heartbeat'
import { advancePipelineAfterTaskSuccess } from './pipeline-stepper'
import { handleTask, handleTaskError } from './task-handler'

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
