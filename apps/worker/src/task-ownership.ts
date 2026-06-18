/**
 * Per-task lock ownership check — module-scoped accessor
 *
 * The worker processes one task at a time. During a task's execution, this module
 * holds a `checkOwnership` callback that throws `TaskLockLostError` if the heartbeat
 * detected that the worker lost lock ownership (DB transient error exhausted retries,
 * or task was swept/cancelled).
 *
 * Long-running handlers (assemble, burn-subtitle) call `checkTaskOwnership()` before
 * expensive sub-operations (FFmpeg concat/mix, subtitle burn). If the lock is lost,
 * the handler aborts immediately, and `handleTaskError` re-queues the task.
 *
 * Set at the start of each task cycle (poll-sources.ts), cleared in finally.
 */

import { TaskLockLostError } from '@excuse/task-engine'

let currentCheck: (() => void) | null = null

/**
 * Install the ownership-check callback for the current task cycle.
 * Called by poll-sources.ts before `executeClaimedTask`, cleared in finally.
 */
export function setTaskOwnershipCheck(fn: (() => void) | null): void {
  currentCheck = fn
}

/**
 * Mid-task checkpoint — call before expensive sub-operations (FFmpeg, long loops).
 *
 * If the heartbeat detected lock loss, this throws `TaskLockLostError` (retriable),
 * causing the task to abort and re-queue rather than continue to double-run.
 *
 * Safe to call anywhere in the handler chain; no-op if no check is installed
 * (e.g., during tests or non-long-running handlers).
 */
export function checkTaskOwnership(): void {
  currentCheck?.()
}

/**
 * Create a `checkOwnership` callback that queries the heartbeat's `lostOwnership`
 * flag and throws `TaskLockLostError` if the lock was lost.
 *
 * This is the factory used by poll-sources.ts to wire the heartbeat signal
 * into the per-task ownership check.
 */
export function createOwnershipCheck(
  taskId: string,
  workerId: string,
  lostOwnership: () => boolean,
): () => void {
  return () => {
    if (lostOwnership()) {
      throw new TaskLockLostError(taskId, workerId)
    }
  }
}
