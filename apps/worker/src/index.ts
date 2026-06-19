/**
 * Worker — 统一任务轮询入口
 *
 * 职责：
 *   1. 加载配置、创建共享 context（provider / storage 单例）
 *   2. 注册 provider observer + guard（metrics / 断路器降级）
 *   3. 启动健康 HTTP 服务器 + 孤儿任务清扫 + 优雅退出处理器
 *   4. 主循环：迭代统一 PollSource（generate.video + subtitle.asr 已迁入统一队列）
 */

import { createLogger, isPgTableNotFoundError } from '@excuse/shared'
import { loadConfig } from './config'
import { createWorkerContext } from './context'
import { createTaskPollSource } from './poll-sources'
import { reconcileTaskRunDrift } from './reconcile'
import { checkWorkerEnvironment, setupHealthServer, setupLifecycle } from './worker-lifecycle'

const config = loadConfig()
const logger = createLogger('worker')

/**
 * =====================================================
 * Worker 启动入口 — 所有副作用收敛到 main()
 * =====================================================
 *
 * import 本文件不触发任何副作用（不注册 provider observer/guard、
 * 不启动健康服务器、不注册信号处理器）。
 */
async function main() {
  // ── 共享 context ─────────────────────────────────────
  const ctx = createWorkerContext(config)

  // ── 生命周期管理（provider observer/guard + 健康服务器 + 优雅退出） ─
  const lifecycle = setupLifecycle(config)

  // ── 引用包装（供 graceful shutdown 读写主循环中的 currentTaskPromise）─
  const runningRef = { value: true }
  const currentTaskPromiseRef = { value: null as Promise<unknown> | null }

  // ── 优雅退出 + 孤儿任务清扫 ────────────────────────────
  lifecycle.setupGracefulShutdown(runningRef, currentTaskPromiseRef)
  const stopSweep = lifecycle.startOrphanSweep(config, lifecycle.healthState)
  const stopCreditRecon = lifecycle.startCreditReconciliation(config)

  // ── 主循环 ──────────────────────────────────────────────
  const pollSources = [
    createTaskPollSource(ctx, lifecycle.healthState, { currentTaskPromiseRef }),
  ]

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
    healthPort: (lifecycle.server as unknown as { port: number }).port ?? 5100,
    workerId: lifecycle.healthState.workerId,
  }, '🤖 Worker started')

  while (runningRef.value) {
    lifecycle.healthState.isPolling = true
    try {
      for (const source of pollSources) {
        if (!runningRef.value)
          break
        await source.poll()
        lifecycle.healthState.lastPollAt = new Date()
        lifecycle.healthState.lastPollError = null
      }
    }
    catch (error: unknown) {
      if (isPgTableNotFoundError(error)) {
        logger.error('❌ 数据库表不存在，请先运行数据库迁移：bun run --cwd packages/db db:push')
        lifecycle.healthState.lastPollError = 'UNDEFINED_TABLE'
        runningRef.value = false
        break
      }

      const err = error instanceof Error ? error : null
      const code = (err as NodeJS.ErrnoException)?.code
      if (code === 'ECONNREFUSED') {
        logger.error('❌ PostgreSQL 未启动（连接被拒绝），请检查数据库服务')
        lifecycle.healthState.lastPollError = 'ECONNREFUSED'
        runningRef.value = false
        break
      }
      lifecycle.healthState.lastPollError = err?.message ?? String(error)
      logger.error({ err: error }, 'Worker poll error')
    }
    lifecycle.healthState.isPolling = false

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
