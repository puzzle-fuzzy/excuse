import type { PrometheusMetric } from './prometheus'

/**
 * Worker 进程运行时状态 —— 纯数据 DTO，不依赖 apps/worker。
 *
 * 由 worker health handler 把 `WorkerHealthState` 映射为本结构后传入，
 * 让 `@excuse/metrics` 保持与 app 层解耦。
 *
 * 设计要点：
 * - 时间一律以毫秒数值传入（`nowMs` / `startedAtMs` / `lastPollAtMs`），
 *   避免在纯函数内调 `Date.now()`，保证测试可注入确定性时间。
 */
export interface WorkerMetricsInput {
  /** Worker 标识（`worker-${hostname}-${pid}`），当前不作为 label，仅留作扩展 */
  workerId: string
  /** 进程启动时间（ms） */
  startedAtMs: number
  /** 当前时间（ms），由调用方注入 */
  nowMs: number
  /** 是否正在轮询主循环 */
  isPolling: boolean
  /** 当前正在执行的任务 ID（null 表示空闲） */
  currentTaskId: string | null
  /** 累计 claim 的任务数（只增） */
  tasksClaimed: number
  /** 累计处理完成的任务数（只增） */
  totalTasksProcessed: number
  /** orphan sweep 累计运行次数（只增） */
  orphanSweeps: number
  /** 最近一次轮询时间（ms），null 表示从未轮询 */
  lastPollAtMs: number | null
  /** 最近一次轮询错误信息，null 表示无错误 */
  lastPollError: string | null
}

/**
 * 把 worker 运行时状态映射为 Prometheus metric family。
 *
 * 输出 8 个 family（统一 `excuse_worker_` 前缀）：
 * - `excuse_worker_uptime_seconds` (gauge)：进程运行时长（秒）。
 * - `excuse_worker_polling` (gauge 0/1)：是否在轮询主循环。
 * - `excuse_worker_busy` (gauge 0/1)：是否有任务正在执行。
 * - `excuse_worker_tasks_claimed_total` (counter)：累计 claim 任务数。
 * - `excuse_worker_tasks_processed_total` (counter)：累计处理完成数。
 * - `excuse_worker_orphan_sweeps_total` (counter)：累计 orphan sweep 次数。
 * - `excuse_worker_last_poll_ok` (gauge 0/1)：最近一次轮询是否成功。
 * - `excuse_worker_last_poll_timestamp_seconds` (gauge)：最近一次轮询时间戳（秒）；从未轮询输出 NaN。
 *
 * Pure 函数：无副作用、无 IO。
 */
export function aggregateWorkerMetrics(input: WorkerMetricsInput): PrometheusMetric[] {
  const uptimeSeconds = Math.max(0, Math.floor((input.nowMs - input.startedAtMs) / 1000))
  const lastPollOk = input.lastPollAtMs !== null && input.lastPollError === null ? 1 : 0
  const lastPollTsSeconds = input.lastPollAtMs !== null ? input.lastPollAtMs / 1000 : Number.NaN

  return [
    {
      name: 'excuse_worker_uptime_seconds',
      help: 'Worker process uptime in seconds.',
      type: 'gauge',
      samples: [{ value: uptimeSeconds }],
    },
    {
      name: 'excuse_worker_polling',
      help: 'Whether the worker is currently polling the main loop (1) or idle (0).',
      type: 'gauge',
      samples: [{ value: input.isPolling ? 1 : 0 }],
    },
    {
      name: 'excuse_worker_busy',
      help: 'Whether the worker is currently executing a task (1) or idle (0).',
      type: 'gauge',
      samples: [{ value: input.currentTaskId !== null ? 1 : 0 }],
    },
    {
      name: 'excuse_worker_tasks_claimed_total',
      help: 'Total tasks claimed from the unified task queue by this worker process since last restart.',
      type: 'counter',
      samples: [{ value: input.tasksClaimed }],
    },
    {
      name: 'excuse_worker_tasks_processed_total',
      help: 'Total tasks processed (completed) by this worker process since last restart.',
      type: 'counter',
      samples: [{ value: input.totalTasksProcessed }],
    },
    {
      name: 'excuse_worker_orphan_sweeps_total',
      help: 'Total orphan-task sweeps run by this worker process since last restart.',
      type: 'counter',
      samples: [{ value: input.orphanSweeps }],
    },
    {
      name: 'excuse_worker_last_poll_ok',
      help: 'Whether the most recent poll succeeded (1) or errored (0). 0 until first poll.',
      type: 'gauge',
      samples: [{ value: lastPollOk }],
    },
    {
      name: 'excuse_worker_last_poll_timestamp_seconds',
      help: 'Unix timestamp (seconds) of the most recent poll. NaN if never polled. Alert via `time() - excuse_worker_last_poll_timestamp_seconds > N`.',
      type: 'gauge',
      samples: [{ value: lastPollTsSeconds }],
    },
  ]
}
