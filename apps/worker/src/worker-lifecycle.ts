/**
 * Worker 生命周期管理 — 健康检查、优雅退出、孤儿任务清扫
 *
 * 从 index.ts 抽离，降低主文件耦合。
 */

import type { WorkerConfig } from './config'
import type { TaskResult } from './task-processor'
import { sweepOrphanTasks } from '@excuse/db'
import { sweepOrphanTasksWithAdapter } from '@excuse/task-engine'
import { createLogger, isPgTableNotFoundError } from '@excuse/shared'
import { createHealthServer, type WorkerHealthState } from './health'
import { getProviderCallsSnapshot } from './services/metrics'

const logger = createLogger('worker-lifecycle')

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
 * currentTaskPromiseRef 是一个包含引用的对象，主循环在跑视频任务时设置其 value。
 */
export function setupGracefulShutdown(
  runningRef: { value: boolean },
  currentTaskPromiseRef: { value: Promise<TaskResult> | null },
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
 * 启动前环境检查（FFmpeg），返回警告列表。
 */
export async function checkWorkerEnvironment(): Promise<string[]> {
  const { checkFFmpegAsync } = await import('@excuse/provider')
  return checkFFmpegAsync()
}
