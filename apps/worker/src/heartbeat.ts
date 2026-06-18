/**
 * Task lock heartbeat — 定期延长 claim 锁定时间
 *
 * 参考 puzzle-bobble/apps/worker/src/index.ts 的 startLockHeartbeat()
 * Worker claim task 后启动 heartbeat，在 finally 块中停止。
 * 间隔 = max(5s, claimTtlMs/2)，确保锁不会过期。
 *
 * 改进（TODO §2.3）：
 *   - 续锁失败时不再吞错，而是重试 3 次（退避 1s/2s/3s）再标记 lost。
 *   - 返回 `TaskHeartbeatHandle`（含 `stop` + `lostOwnership`），
 *     让 poll-sources.ts 在长任务的子操作间检查所有权。
 *   - lost 后不再续传心跳（锁已不可恢复，继续 tick 无意义）。
 */

import type { TaskHeartbeatAdapter } from '@excuse/task-engine'
import { createLogger } from '@excuse/shared'
import { extendTaskLockWithAdapter } from '@excuse/task-engine'

const logger = createLogger('worker-heartbeat')

const MAX_RETRIES = 3

export interface TaskHeartbeatHandle {
  /** 停止心跳间隔 */
  stop: () => void
  /** 心跳检测到锁所有权已丢失（任务被 sweep/cancelled 或所有续锁重试耗尽） */
  lostOwnership: () => boolean
}

/**
 * 启动 task heartbeat — 定期延长 lockedUntil
 *
 * 续锁动作通过 adapter 注入（`extendTaskLock` 实现仍由调用方提供），
 * 让 heartbeat 的「何时续锁、续锁失败如何停止」可测试、不直接依赖 `@excuse/db`。
 *
 * @param taskId 任务 ID
 * @param workerId Worker 标识（必须与 claim 时的 lockedBy 一致）
 * @param claimTtlMs claim 锁定时长（毫秒）
 * @param adapter 续锁 adapter — 调用方注入 DB `extendTaskLock`
 * @returns TaskHeartbeatHandle — stop + lostOwnership
 */
export function startTaskHeartbeat(
  taskId: string,
  workerId: string,
  claimTtlMs: number,
  adapter: TaskHeartbeatAdapter<unknown>,
): TaskHeartbeatHandle {
  const intervalMs = Math.max(5_000, Math.floor(claimTtlMs / 2))
  let stopped = false
  let lost = false

  const timer = setInterval(async () => {
    if (stopped)
      return

    try {
      const updated = await renewWithRetry(taskId, workerId, claimTtlMs, adapter)
      if (!updated) {
        // Task 可能已被 sweep 或 cancelled — 锁已丢失，停止心跳
        logger.warn({ taskId, workerId }, 'Heartbeat: task no longer running, marking lost and stopping')
        lost = true
        stopped = true
        clearInterval(timer)
      }
      else {
        // 续锁成功 — 清除瞬态丢失标记（如果之前有短暂失败但这次成功了）
        lost = false
      }
    }
    catch (err) {
      // 所有重试耗尽 — 锁大概率已丢失，停止心跳
      logger.error({ err, taskId, workerId }, 'Heartbeat: all retries exhausted, marking ownership lost and stopping')
      lost = true
      stopped = true
      clearInterval(timer)
    }
  }, intervalMs)

  return {
    stop: () => {
      stopped = true
      clearInterval(timer)
    },
    lostOwnership: () => lost,
  }
}

/**
 * 续锁重试 — 最多 MAX_RETRIES 次，退避 1s / 2s / 3s
 *
 * 每次失败记录 warn 日志；最后一次失败则抛出原始错误让外层 catch 处理。
 * 成功续锁或 `null`（任务已 sweep/cancelled）则直接返回。
 */
async function renewWithRetry(
  taskId: string,
  workerId: string,
  claimTtlMs: number,
  adapter: TaskHeartbeatAdapter<unknown>,
): Promise<unknown | null> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const updated = await extendTaskLockWithAdapter({ taskId, workerId, claimTtlMs, adapter })
      if (!updated)
        return null // 任务已 sweep/cancelled
      return updated
    }
    catch (err) {
      if (attempt === MAX_RETRIES)
        throw err // 最后一次 — 传播错误给外层 catch

      const delayMs = 1000 * attempt // 1s, 2s
      logger.warn({ err, taskId, workerId, attempt, maxRetries: MAX_RETRIES, retryInMs: delayMs }, 'Heartbeat: extendTaskLock failed, retrying')
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }

  // unreachable — loop 总是 return 或 throw
  return null
}
