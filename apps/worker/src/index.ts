import type { WorkerHealthState } from './health'
import type { TaskResult } from './task-processor'
import { claimNextTask, extendTaskLock, getTaskById, markTaskSucceeded, notifyTaskStatusChange, pollExportingProjects, pollPendingASRProjects, pollPendingVideoTasks, sweepOrphanTasks } from '@excuse/db'
import { ASRClient, checkFFmpegAsync } from '@excuse/provider'
import { createLogger, isPgTableNotFoundError } from '@excuse/shared'
import { claimNextTaskWithAdapter, completeTaskWithAdapter, sweepOrphanTasksWithAdapter } from '@excuse/task-engine'
import { loadConfig } from './config'
import { createHealthServer } from './health'
import { startTaskHeartbeat } from './heartbeat'
import { advancePipelineAfterTaskSuccess } from './pipeline-stepper'
import { processASRTask, processExportTask } from './subtitle-processor'
import { handleTask, handleTaskError } from './task-handler'
import { createTaskProcessor } from './task-processor'

const config = loadConfig()
const processor = createTaskProcessor(config)
const asrClient = new ASRClient({
  apiKey: config.dashscopeApiKey,
  baseUrl: config.dashscopeBaseUrl,
})
const logger = createLogger('worker')

// ── Worker ID ──────────────────────────────────────────
const workerId = `worker-${process.env.HOSTNAME ?? 'local'}-${process.pid}`

/**
 * 轮询循环控制状态
 *
 * running: SIGINT/SIGTERM 时置 false，循环在下一轮检查后退出
 * currentTaskPromise: 当前正在处理的任务，用于优雅退出时等待其完成
 */
let running = true
let currentTaskPromise: Promise<TaskResult> | null = null

/** 优雅退出最大等待时间 — 超过此时间强制退出，避免长时间挂起 */
const GRACEFUL_TIMEOUT_MS = 30_000

// ── Worker 健康状态 ──────────────────────────────────────

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

const healthPort = Number(process.env.WORKER_HEALTH_PORT) || 5100
createHealthServer(healthState, healthPort)

// ── 优雅退出 ──────────────────────────────────────────
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    logger.info({ signal }, '🛑 Received signal, shutting down gracefully...')
    running = false

    // Wait for current task to finish (max 30s), then force exit
    if (currentTaskPromise) {
      const timeout = setTimeout(() => {
        logger.warn('⏰ Graceful timeout exceeded, forcing exit')
        process.exit(1)
      }, GRACEFUL_TIMEOUT_MS)

      try {
        await currentTaskPromise
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

// ── Orphan sweep 定时任务 ──────────────────────────────────
// 启动时立即 sweep 一次，然后每隔 sweepIntervalMs 毫秒运行一次
let sweepTimer: NodeJS.Timeout
async function runOrphanSweep() {
  try {
    const recovered = await sweepOrphanTasksWithAdapter({ timeoutMinutes: 5, adapter: { sweepOrphanTasks } }) // 5 分钟 grace period
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
      running = false
      return
    }
    logger.error({ err }, 'Orphan sweep error')
  }
}

runOrphanSweep()
sweepTimer = setInterval(runOrphanSweep, config.sweepIntervalMs)

// ── 轮询循环 ──────────────────────────────────────────
/**
 * Worker 主循环 — 持续轮询 DB 中 pending 的视频任务 + claim tasks 表中的任务
 *
 * 流程（每个 cycle）:
 *   1. claimNextTask() → handler dispatch → heartbeat → 完成或失败
 *   2. pollPendingVideoTasks() → processor.processTask() → 根据 action 结果处理
 *   3. pollPendingASRProjects() → processASRTask()
 *   4. pollExportingProjects() → processExportTask()
 * 退出: SIGINT/SIGTERM → running=false → 当前任务完成后退出（最长 30s）
 */
async function main() {
  // ── 启动前环境检查 ──────────────────────────────────
  const ffmpegWarnings = await checkFFmpegAsync()
  for (const w of ffmpegWarnings) {
    logger.warn(w)
  }

  // 前置异步检查（orphan sweep / ffmpeg）期间可能已将 running 设为 false
  if (!running) {
    logger.info('🤖 Worker stopped.')
    return
  }

  logger.info({
    pollIntervalMs: config.pollIntervalMs,
    claimTtlMs: config.claimTtlMs,
    sweepIntervalMs: config.sweepIntervalMs,
    healthPort,
    workerId,
  }, '🤖 Worker started')

  while (running) {
    healthState.isPolling = true
    try {
      // ── Claim tasks from unified task queue ────────────
      const claimedTask = await claimNextTaskWithAdapter({ workerId, claimTtlMs: config.claimTtlMs, adapter: { claimNextTask } })
      if (claimedTask) {
        healthState.tasksClaimed++
        healthState.currentTaskId = claimedTask.id
        const stopHeartbeat = startTaskHeartbeat(claimedTask.id, workerId, config.claimTtlMs, { extendTaskLock })

        try {
          const output = await handleTask(claimedTask, config)
          const succeeded = await completeTaskWithAdapter({
            task: claimedTask,
            output,
            adapter: {
              markTaskSucceeded,
              notifyTaskStatusChange,
            },
          })
          if (succeeded) {
            healthState.totalTasksProcessed++
            logger.info({ taskId: claimedTask.id, type: claimedTask.type }, '✅ Task completed')

            // ── Pipeline auto-advance ──
            // Worker 完成当前 phase task 后，如果 autoProgress=true，自动创建下一个 phase task
            const nextTaskId = await advancePipelineAfterTaskSuccess(succeeded, config)
            if (nextTaskId) {
              logger.info({ nextTaskId, projectId: claimedTask.projectId }, '🔗 Pipeline auto-advanced')
            }
          }
        }
        catch (error) {
          // Handler 失败 → handleTaskError (retryable vs permanent)
          await handleTaskError(claimedTask, error)
          const updatedTask = await getTaskById(claimedTask.id)
          if (updatedTask) {
            await notifyTaskStatusChange(updatedTask)
          }
        }
        finally {
          stopHeartbeat()
          healthState.currentTaskId = null
        }
      }

      // ── 轮询视频生成任务（generation_records）──────────
      const records = await pollPendingVideoTasks()
      healthState.lastPollAt = new Date()
      healthState.lastPollError = null

      for (const record of records) {
        if (!running)
          break // 退出信号检查

        const taskLogger = logger.child({ taskId: record.taskId, traceId: record.traceId })
        currentTaskPromise = processor.processTask(record)

        const result = await currentTaskPromise
        currentTaskPromise = null

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

      // ── 轮询 ASR 字幕任务 ────────────────────────────────
      const asrProjects = await pollPendingASRProjects()
      for (const project of asrProjects) {
        if (!running)
          break
        try {
          await processASRTask(project, asrClient)
          healthState.totalTasksProcessed++
        }
        catch (err) {
          logger.error({ err, projectId: project.id }, 'ASR task processing error')
        }
      }

      // ── 轮询字幕导出任务 ──────────────────────────────────
      const exportProjects = await pollExportingProjects()
      for (const project of exportProjects) {
        if (!running)
          break
        try {
          await processExportTask(project, config)
          healthState.totalTasksProcessed++
        }
        catch (err) {
          logger.error({ err, projectId: project.id }, 'Export task processing error')
        }
      }
    }
    catch (error: unknown) {
      if (isPgTableNotFoundError(error)) {
        logger.error('❌ 数据库表不存在，请先运行数据库迁移：bun run --cwd packages/db db:push')
        healthState.lastPollError = 'UNDEFINED_TABLE'
        running = false
        break
      }

      const err = error instanceof Error ? error : null
      const code = (err as NodeJS.ErrnoException)?.code
      if (code === 'ECONNREFUSED') {
        logger.error('❌ PostgreSQL 未启动（连接被拒绝），请检查数据库服务')
        healthState.lastPollError = 'ECONNREFUSED'
        running = false
        break
      }
      healthState.lastPollError = err?.message ?? String(error)
      logger.error({ err: error }, 'Worker poll error')
    }
    healthState.isPolling = false

    // 分段 sleep，以便更快响应退出信号
    const sleepMs = config.pollIntervalMs
    const checkInterval = 1000
    let remaining = sleepMs
    while (remaining > 0 && running) {
      const step = Math.min(remaining, checkInterval)
      await Bun.sleep(step)
      remaining -= step
    }
  }

  clearInterval(sweepTimer)
  logger.info('🤖 Worker stopped.')
}

main()
