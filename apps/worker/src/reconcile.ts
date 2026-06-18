/**
 * Task ↔ Pipeline Run 状态漂移修复
 *
 * 背景：Canvas handler 先写 `canvas_pipeline_runs.status='succeeded'`，
 * 后由 task-handler 外层写 `tasks.status='succeeded'`——两次独立写入无事务。
 * Worker 在两次写之间崩溃会导致 task=succeeded 但 run=running 永久漂移。
 *
 * 本模块在每轮 poll 周期末尾调用，查询并修复漂移对：
 *   - task 已 succeeded 且 run 仍 running → 把 run 补标 succeeded
 *   - task 已 failed/cancelled 且 run 仍 running → 把 run 补标 failed
 *
 * 修复完成后记录 warn 日志，便于排查漂移根因。
 */

import type { DriftedTaskRunPair } from '@excuse/db'
import { findDriftedTaskRunPairs, markPipelineRunFailed, markPipelineRunSucceeded } from '@excuse/db'
import { createLogger } from '@excuse/shared'

const logger = createLogger('reconcile')

/**
 * 修复一对漂移的 task/run。
 *
 * @returns true 表示修复成功，false 表示修复失败（通常因为 run 已不在 running 状态）。
 */
async function repairDriftedPair(pair: DriftedTaskRunPair): Promise<boolean> {
  if (pair.taskStatus === 'succeeded') {
    const updated = await markPipelineRunSucceeded(pair.runId)
    if (updated) {
      logger.warn(
        { taskId: pair.taskId, runId: pair.runId, projectId: pair.projectId, phase: pair.phase },
        'Reconcile: marked drifted run as succeeded (task was already succeeded)',
      )
      return true
    }
  }
  else {
    // failed 或 cancelled → 把 run 补标 failed
    const reason = `Reconciled: task status is "${pair.taskStatus}" but run was still running`
    const updated = await markPipelineRunFailed(pair.runId, reason)
    if (updated) {
      logger.warn(
        { taskId: pair.taskId, runId: pair.runId, projectId: pair.projectId, phase: pair.phase, taskStatus: pair.taskStatus },
        'Reconcile: marked drifted run as failed (task was in terminal state)',
      )
      return true
    }
  }

  logger.debug(
    { taskId: pair.taskId, runId: pair.runId, taskStatus: pair.taskStatus },
    'Reconcile: run already in terminal state, skipped',
  )
  return false
}

/**
 * 主入口：查询并修复 task/run 状态漂移。
 *
 * 幂等投等——run 已经是终态时 markXxx 的 append-only guard 会返回 null，安全跳过。
 * 在每轮 poll 周期末尾调用一次（频率低，开销可控）。
 *
 * @returns 修复数量
 */
export async function reconcileTaskRunDrift(): Promise<number> {
  let repaired = 0

  try {
    const pairs = await findDriftedTaskRunPairs()
    if (pairs.length === 0)
      return 0

    logger.warn({ count: pairs.length }, 'Reconcile: found drifted task/run pairs')

    for (const pair of pairs) {
      const ok = await repairDriftedPair(pair)
      if (ok)
        repaired++
    }

    if (repaired > 0) {
      logger.warn({ repaired, total: pairs.length }, 'Reconcile: drift repair complete')
    }
  }
  catch (err) {
    logger.error({ err }, 'Reconcile failed, will retry next cycle')
  }

  return repaired
}
