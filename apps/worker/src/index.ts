/**
 * Worker — 统一任务轮询入口
 *
 * 职责：
 *   1. 加载配置、创建共享 context（provider / storage 单例）
 *   2. 注册 provider observer + guard（metrics / 断路器降级）
 *   3. 启动健康 HTTP 服务器 + 孤儿任务清扫 + 优雅退出处理器
 *   4. 主循环：迭代统一 PollSource（generate.video + subtitle.asr 已迁入统一队列）
 *
 * 设计（见 docs/TODO.md §一、2）：
 *   - lifecycle 逻辑抽离到 worker-lifecycle.ts
 *   - 主循环只遍历 PollSource[]，各源在 poll-sources.ts 中定义
 *   - index.ts 仅做编排
 */

import { registerProviderCallGuard, registerProviderCallObserver } from '@excuse/provider'
import { createLogger, isPgTableNotFoundError } from '@excuse/shared'
import { loadConfig } from './config'
import { createWorkerContext } from './context'
import { createTaskPollSource } from './poll-sources'
import { reconcileTaskRunDrift } from './reconcile'
import { recordProviderCall } from './services/metrics'
import { providerCallGuard, recordProviderCallOutcome, warmProviderHealthCache } from './services/provider-health'
import { checkWorkerEnvironment, setupGracefulShutdown, setupHealthServer, startCreditReconciliation, startOrphanSweep } from './worker-lifecycle'

const config = loadConfig()
const logger = createLogger('worker')

// ── 共享 context + provider observer/guard ──────────────
const ctx = createWorkerContext(config)

registerProviderCallObserver((model, durationMs, success) => {
  recordProviderCall(model, durationMs, success)
  void recordProviderCallOutcome(model, success)
})

registerProviderCallGuard(providerCallGuard)
warmProviderHealthCache()

// ── 健康服务器 ──────────────────────────────────────────
const { healthState, server } = setupHealthServer(config)

// ── 引用包装（供 graceful shutdown 读写主循环中的 currentTaskPromise）─
const runningRef = { value: true }
const currentTaskPromiseRef = { value: null as Promise<unknown> | null }

// ── 优雅退出 + 孤儿任务清扫 ────────────────────────────
setupGracefulShutdown(runningRef, currentTaskPromiseRef, server)
const stopSweep = startOrphanSweep(config, healthState)
const stopCreditRecon = startCreditReconciliation(config)

// ── 主循环 ──────────────────────────────────────────────
const pollSources = [
  createTaskPollSource(ctx, healthState, { currentTaskPromiseRef }),
]

async function main() {
  // ── 启动前环境检查 ──────────────────────────────────
  const ffmpegWarnings = await checkWorkerEnvironment()
  for (const w of ffmpegWarnings) {
    logger.warn(w)
  }

  if (!runningRef.value) {
    logger.info('🤖 Worker stopped.')
    return
  }

  logger.info({
    pollIntervalMs: config.pollIntervalMs,
    claimTtlMs: config.claimTtlMs,
    sweepIntervalMs: config.sweepIntervalMs,
    healthPort: (server as unknown as { port: number }).port ?? 5100,
    workerId: healthState.workerId,
  }, '🤖 Worker started')

  while (runningRef.value) {
    healthState.isPolling = true
    try {
      for (const source of pollSources) {
        if (!runningRef.value)
          break
        await source.poll()
        healthState.lastPollAt = new Date()
        healthState.lastPollError = null
      }
    }
    catch (error: unknown) {
      if (isPgTableNotFoundError(error)) {
        logger.error('❌ 数据库表不存在，请先运行数据库迁移：bun run --cwd packages/db db:push')
        healthState.lastPollError = 'UNDEFINED_TABLE'
        runningRef.value = false
        break
      }

      const err = error instanceof Error ? error : null
      const code = (err as NodeJS.ErrnoException)?.code
      if (code === 'ECONNREFUSED') {
        logger.error('❌ PostgreSQL 未启动（连接被拒绝），请检查数据库服务')
        healthState.lastPollError = 'ECONNREFUSED'
        runningRef.value = false
        break
      }
      healthState.lastPollError = err?.message ?? String(error)
      logger.error({ err: error }, 'Worker poll error')
    }
    healthState.isPolling = false

    // 每轮 poll 后检查 task↔run 状态漂移并修复
    await reconcileTaskRunDrift()

    // 分段 sleep，以便更快响应退出信号
    const sleepMs = config.pollIntervalMs
    const checkInterval = 1000
    let remaining = sleepMs
    while (remaining > 0 && runningRef.value) {
      const step = Math.min(remaining, checkInterval)
      await Bun.sleep(step)
      remaining -= step
    }
  }

  stopSweep()
  stopCreditRecon()
  logger.info('🤖 Worker stopped.')
}

main()
