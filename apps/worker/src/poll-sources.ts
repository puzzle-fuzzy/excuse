import type { WorkerContext } from './context'
import type { WorkerHealthState } from './health'
/**
 * Worker 轮询源实现 — 单个 PollSource：统一任务队列（video/ASR 已迁入）
 */
import type { PollSource } from './poll-source'
import { claimNextTask, extendTaskLock, getTaskById, markTaskSucceeded, notifyTaskStatusChange } from '@excuse/db'
import { createLogger } from '@excuse/shared'
import { claimNextTaskWithAdapter, completeTaskWithAdapter, extendTaskLockWithAdapter } from '@excuse/task-engine'
import { startTaskHeartbeat } from './heartbeat'
import { advancePipelineAfterTaskSuccess } from './pipeline-stepper'
import { handleTask, handleTaskError } from './task-handler'
import { checkTaskOwnership, createOwnershipCheck, setTaskOwnershipCheck } from './task-ownership'

const logger = createLogger('poll-sources')

const workerId = `worker-${process.env.HOSTNAME ?? 'local'}-${process.pid}`

/** claimNextTaskWithAdapter 认领到的任务（已 null-check）— 与 handleTask 入参同型 */
type ClaimedTask = Parameters<typeof handleTask>[0]

/**
 * 长任务类型 — 执行时间可达数分钟（FFmpeg concat/mix、字幕烧录、视频提交循环），
 * 需更长的 claim TTL（默认 30s 对这些任务太短，一次 DB 瞬断就丢锁）。
 */
const LONG_TASK_TYPES: readonly string[] = [
  'canvas.assemble',
  'canvas.videos',
  'canvas.bgm',
  'media.burn-subtitle',
]

/** 长任务 claim TTL — 5 分钟（足够覆盖 DB 瞬断 + orphan sweep 5min 宽限） */
const LONG_TASK_CLAIM_TTL_MS = 300_000

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

      // 长任务用更长的 TTL — 立即续锁扩大 claim 窗口
      const isLongTask = LONG_TASK_TYPES.includes(claimedTask.type)
      const effectiveTtlMs = isLongTask ? LONG_TASK_CLAIM_TTL_MS : ctx.config.claimTtlMs
      if (isLongTask && effectiveTtlMs > ctx.config.claimTtlMs) {
        await extendTaskLockWithAdapter({
          taskId: claimedTask.id,
          workerId,
          claimTtlMs: effectiveTtlMs,
          adapter: { extendTaskLock },
        })
        logger.info({ taskId: claimedTask.id, type: claimedTask.type, claimTtlMs: effectiveTtlMs }, 'Long task: extended claim TTL')
      }

      const { stop: stopHeartbeat, lostOwnership } = startTaskHeartbeat(claimedTask.id, workerId, effectiveTtlMs, { extendTaskLock })

      // 设置 per-task ownership check — 长 handler 在子操作间调用 checkTaskOwnership()
      setTaskOwnershipCheck(createOwnershipCheck(claimedTask.id, workerId, lostOwnership))

      const execution = executeClaimedTask(claimedTask)
      refs.currentTaskPromiseRef.value = execution
      try {
        await execution
      }
      finally {
        refs.currentTaskPromiseRef.value = null
        stopHeartbeat()
        setTaskOwnershipCheck(null) // 清除 per-task 检查
        healthState.currentTaskId = null
      }

      return 1
    },
  }

  /** handle → complete → auto-advance（失败走 handleTaskError）。错误被吞，不外抛。 */
  async function executeClaimedTask(claimedTask: ClaimedTask): Promise<void> {
    try {
      const output = await handleTask(claimedTask, ctx)
      // 任务完成前检查锁所有权 — 如果丢失，不应 complete（另一 worker 可能已在跑）
      checkTaskOwnership()
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
