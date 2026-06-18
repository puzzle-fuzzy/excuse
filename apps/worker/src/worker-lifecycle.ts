/**
 * Worker 生命周期管理 — 健康检查、优雅退出、孤儿任务清扫
 *
 * 从 index.ts 抽离，降低主文件耦合。
 */

import type { WorkerConfig } from './config'
import type { WorkerHealthState } from './health'
import { findStaleReservedCredits, refundCredit, sweepOrphanTasks } from '@excuse/db'
import { registerProviderCallGuard, registerProviderCallObserver } from '@excuse/provider'
import { createLogger, isPgTableNotFoundError } from '@excuse/shared'
import { sweepOrphanTasksWithAdapter } from '@excuse/task-engine'
import { createHealthServer } from './health'
import { getProviderCallsSnapshot, recordProviderCall } from './services/metrics'
import { providerCallGuard, recordProviderCallOutcome, warmProviderHealthCache } from './services/provider-health'

const logger = createLogger('worker-lifecycle')

/**
 * Worker 生命周期管理器 — 收敛所有模块级副作用。
 *
 * 返回 healthState / server 引用 + provider observer/guard 清理函数 +
 * 优雅退出 / 孤儿清扫 / 信用对账的启动函数。
 */
export interface WorkerLifecycle {
  healthState: WorkerHealthState
  server: ReturnType<typeof createHealthServer>
  /** 注册 SIGINT/SIGTERM 处理器 */
  setupGracefulShutdown: (
    runningRef: { value: boolean },
    currentTaskPromiseRef: { value: Promise<unknown> | null },
  ) => void
  startOrphanSweep: typeof startOrphanSweep
  startCreditReconciliation: typeof startCreditReconciliation
}

export function setupLifecycle(config: WorkerConfig): WorkerLifecycle {
  // 1. Provider observer + guard（注册 → 返回清理函数）
  const unregisterObserver = registerProviderCallObserver((model, durationMs, success) => {
    recordProviderCall(model, durationMs, success)
    void recordProviderCallOutcome(model, success)
  })
  const unregisterGuard = registerProviderCallGuard(providerCallGuard)
  warmProviderHealthCache()

  // 2. 健康服务器
  const { healthState, server } = setupHealthServer(config)

  // 3. 优雅退出（增强：清理 provider observer/guard）
  function setupGracefulShutdown(
    runningRef: { value: boolean },
    currentTaskPromiseRef: { value: Promise<unknown> | null },
  ) {
    const GRACEFUL_TIMEOUT_MS = 30_000

    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.on(signal, async () => {
        logger.info({ signal }, '🛑 Received signal, shutting down gracefully...')
        runningRef.value = false
        server.stop()

        // 清理 provider observer/guard
        unregisterObserver()
        unregisterGuard()

        if (currentTaskPromiseRef.value) {
          const timeout = setTimeout(() => {
            logger.warn('⏰ Graceful timeout exceeded, forcing exit')
            process.exit(1)
          }, GRACEFUL_TIMEOUT_MS)

          try {
            await currentTaskPromiseRef.value
            logger.info('✅ Current task completed before exit')
          }
          catch {
            logger.warn('⚠️ Current task failed during graceful shutdown')
          }
          clearTimeout(timeout)
        }

        process.exit(0)
      })
    }
  }

  return {
    healthState,
    server,
    setupGracefulShutdown,
    startOrphanSweep,
    startCreditReconciliation,
  }
}

/**
 * 创建健康 HTTP 服务器，返回 healthState 引用 + stop 函数。
 */
export function setupHealthServer(config: WorkerConfig) {
  const workerId = `worker-${process.env.HOSTNAME ?? 'local'}-${process.pid}`
  const healthPort = Number(process.env.WORKER_HEALTH_PORT) || 5100

  const healthState: WorkerHealthState = {
    isPolling: false,
    lastPollAt: null,
    lastPollError: null,
    totalTasksProcessed: 0,
    startedAt: new Date(),
    workerId,
    currentTaskId: null,
    tasksClaimed: 0,
    orphanSweeps: 0,
    lastSweepAt: null,
  }

  const server = createHealthServer(healthState, healthPort, {
    providerCallsSnapshot: getProviderCallsSnapshot,
    metricsAllowedCidrs: config.metricsAllowedCidrs,
    metricsAccessToken: config.metricsAccessToken,
    readyStaleMs: config.pollIntervalMs * 4,
  })

  return { healthState, healthPort, workerId, server }
}

/**
 * 注册 SIGINT / SIGTERM 优雅退出处理器。
 * currentTaskPromiseRef 是一个包含引用的对象，主循环在跑**任意**任务（统一队列 / 视频轮询）时设置其 value，
 * 关停时 await 它以 drain 在途任务（如数分钟的 canvas.assemble），而非只 drain 视频（见 CHANGELOG.md "优雅关停 drain 统一任务队列"）。
 */
export function setupGracefulShutdown(
  runningRef: { value: boolean },
  currentTaskPromiseRef: { value: Promise<unknown> | null },
  server: { stop: () => void },
) {
  const GRACEFUL_TIMEOUT_MS = 30_000

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
      logger.info({ signal }, '🛑 Received signal, shutting down gracefully...')
      runningRef.value = false
      server.stop()

      if (currentTaskPromiseRef.value) {
        const timeout = setTimeout(() => {
          logger.warn('⏰ Graceful timeout exceeded, forcing exit')
          process.exit(1)
        }, GRACEFUL_TIMEOUT_MS)

        try {
          await currentTaskPromiseRef.value
          logger.info('✅ Current task completed before exit')
        }
        catch {
          logger.warn('⚠️ Current task failed during graceful shutdown')
        }
        clearTimeout(timeout)
      }

      process.exit(0)
    })
  }
}

/**
 * 启动孤儿任务定时清扫。
 * 返回 clearInterval 函数。
 */
export function startOrphanSweep(
  config: WorkerConfig,
  healthState: WorkerHealthState,
): () => void {
  let sweepTimer: ReturnType<typeof setInterval>

  async function run() {
    try {
      const recovered = await sweepOrphanTasksWithAdapter({ timeoutMinutes: 5, adapter: { sweepOrphanTasks } })
      healthState.orphanSweeps++
      healthState.lastSweepAt = new Date()
      if (recovered > 0) {
        logger.info({ recovered }, '🔄 Swept orphan tasks')
      }
    }
    catch (err) {
      if (isPgTableNotFoundError(err)) {
        logger.error('❌ 数据库表不存在，请先运行数据库迁移：bun run --cwd packages/db db:push')
        clearInterval(sweepTimer)
        return
      }
      logger.error({ err }, 'Orphan sweep error')
    }
  }

  run()
  sweepTimer = setInterval(run, config.sweepIntervalMs)
  return () => clearInterval(sweepTimer)
}

/**
 * 信用对账 — 释放孤立 reserve 冻结资金（TODO §1.3）
 *
 * 扫描 credit_transactions 中 reserve 超过 1h 但无对应 debit/refund 收尾的记录，
 * 自动 refund 并审计。防止 server/worker 崩溃或流式中断导致用户余额永久 frozen。
 *
 * 幂等：refundCredit 已按 generationRecordId + type 唯一索引防重。
 */
async function reconcileStaleReservedCredits(): Promise<number> {
  const orphans = await findStaleReservedCredits(60) // 1h 阈值
  if (orphans.length === 0)
    return 0

  const CREDIT_RECONCILE_DESCRIPTION = '信用对账：孤立 reserve 自动退款'
  let reconciled = 0
  for (const orphan of orphans) {
    try {
      await refundCredit({
        accountId: orphan.accountId,
        generationRecordId: orphan.generationRecordId,
        description: CREDIT_RECONCILE_DESCRIPTION,
      })
      reconciled++
    }
    catch (err) {
      logger.error({ err, generationRecordId: orphan.generationRecordId }, '信用对账失败')
    }
  }
  return reconciled
}

/**
 * 启动信用对账周期任务（与孤儿清扫同频）。
 * 返回 clearInterval 函数。
 */
export function startCreditReconciliation(config: WorkerConfig): () => void {
  let timer: ReturnType<typeof setInterval>

  async function run() {
    try {
      const count = await reconcileStaleReservedCredits()
      if (count > 0) {
        logger.info({ count }, '💰 Credit reconciliation: released orphaned reserved credits')
      }
    }
    catch (err) {
      if (isPgTableNotFoundError(err)) {
        logger.error('❌ 数据库表不存在，请先运行数据库迁移')
        clearInterval(timer)
        return
      }
      logger.error({ err }, 'Credit reconciliation error')
    }
  }

  run()
  // 与孤儿清扫共用 sweep 间隔（默认 60s），对账轻量无额外负担
  timer = setInterval(run, config.sweepIntervalMs)
  return () => clearInterval(timer)
}

/**
 * 启动前环境检查（FFmpeg），返回警告列表。
 */
export async function checkWorkerEnvironment(): Promise<string[]> {
  const { checkFFmpegAsync } = await import('@excuse/ffmpeg')
  return checkFFmpegAsync()
}
