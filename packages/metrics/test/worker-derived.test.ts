import type { WorkerMetricsInput } from '../src'
import { describe, expect, it } from 'bun:test'
import { aggregateWorkerMetrics, serializePrometheus } from '../src'

/** 构造一个默认 worker 输入，测试按需覆盖字段。 */
function makeInput(overrides: Partial<WorkerMetricsInput> = {}): WorkerMetricsInput {
  return {
    workerId: 'worker-local-1234',
    startedAtMs: 1_000_000,
    nowMs: 1_000_000 + 3600_000, // +1h
    isPolling: true,
    currentTaskId: 'task-abc',
    tasksClaimed: 5,
    totalTasksProcessed: 4,
    orphanSweeps: 2,
    lastPollAtMs: 1_000_000 + 1800_000,
    lastPollError: null,
    ...overrides,
  }
}

const FAMILY_NAMES = [
  'excuse_worker_uptime_seconds',
  'excuse_worker_polling',
  'excuse_worker_busy',
  'excuse_worker_tasks_claimed_total',
  'excuse_worker_tasks_processed_total',
  'excuse_worker_orphan_sweeps_total',
  'excuse_worker_last_poll_ok',
  'excuse_worker_last_poll_timestamp_seconds',
] as const

describe('aggregateWorkerMetrics', () => {
  it('输出全部 8 个 family 的 HELP + TYPE', () => {
    const metrics = aggregateWorkerMetrics(makeInput())
    expect(metrics).toHaveLength(8)

    const names = metrics.map(m => m.name)
    for (const name of FAMILY_NAMES) {
      expect(names).toContain(name)
    }

    // 每个 family 都有 HELP + TYPE 头部
    const body = serializePrometheus(metrics)
    for (const m of metrics) {
      expect(body).toContain(`# HELP ${m.name}`)
      expect(body).toMatch(new RegExp(`# TYPE ${m.name} (counter|gauge)`))
    }
  })

  it('uptime = floor((nowMs - startedAtMs)/1000)，向下取整不小于 0', () => {
    const metrics = aggregateWorkerMetrics(makeInput({ startedAtMs: 1_000_000, nowMs: 1_000_000 + 3600_000 }))
    const uptime = metrics.find(m => m.name === 'excuse_worker_uptime_seconds')!
    expect(uptime.samples[0]!.value).toBe(3600)
  })

  it('uptime 在 now < started 时 clamp 到 0', () => {
    const metrics = aggregateWorkerMetrics(makeInput({ startedAtMs: 2000, nowMs: 1000 }))
    const uptime = metrics.find(m => m.name === 'excuse_worker_uptime_seconds')!
    expect(uptime.samples[0]!.value).toBe(0)
  })

  it('polling / busy 反映布尔状态', () => {
    const busy = aggregateWorkerMetrics(makeInput({ isPolling: true, currentTaskId: 'x' }))
    expect(busy.find(m => m.name === 'excuse_worker_polling')!.samples[0]!.value).toBe(1)
    expect(busy.find(m => m.name === 'excuse_worker_busy')!.samples[0]!.value).toBe(1)

    const idle = aggregateWorkerMetrics(makeInput({ isPolling: false, currentTaskId: null }))
    expect(idle.find(m => m.name === 'excuse_worker_polling')!.samples[0]!.value).toBe(0)
    expect(idle.find(m => m.name === 'excuse_worker_busy')!.samples[0]!.value).toBe(0)
  })

  it('counter family 反映只增数值', () => {
    const metrics = aggregateWorkerMetrics(makeInput({ tasksClaimed: 7, totalTasksProcessed: 5, orphanSweeps: 3 }))
    expect(metrics.find(m => m.name === 'excuse_worker_tasks_claimed_total')!.samples[0]!.value).toBe(7)
    expect(metrics.find(m => m.name === 'excuse_worker_tasks_processed_total')!.samples[0]!.value).toBe(5)
    expect(metrics.find(m => m.name === 'excuse_worker_orphan_sweeps_total')!.samples[0]!.value).toBe(3)
  })

  it('counter family 类型为 counter', () => {
    const metrics = aggregateWorkerMetrics(makeInput())
    expect(metrics.find(m => m.name === 'excuse_worker_tasks_claimed_total')!.type).toBe('counter')
    expect(metrics.find(m => m.name === 'excuse_worker_tasks_processed_total')!.type).toBe('counter')
    expect(metrics.find(m => m.name === 'excuse_worker_orphan_sweeps_total')!.type).toBe('counter')
  })

  it('last_poll_ok：有 lastPollAt 且无 error → 1；有 error → 0；从未轮询 → 0', () => {
    const ok = aggregateWorkerMetrics(makeInput({ lastPollAtMs: 1500, lastPollError: null }))
    expect(ok.find(m => m.name === 'excuse_worker_last_poll_ok')!.samples[0]!.value).toBe(1)

    const err = aggregateWorkerMetrics(makeInput({ lastPollAtMs: 1500, lastPollError: 'ECONNREFUSED' }))
    expect(err.find(m => m.name === 'excuse_worker_last_poll_ok')!.samples[0]!.value).toBe(0)

    const never = aggregateWorkerMetrics(makeInput({ lastPollAtMs: null, lastPollError: null }))
    expect(never.find(m => m.name === 'excuse_worker_last_poll_ok')!.samples[0]!.value).toBe(0)
  })

  it('last_poll_timestamp_seconds：有 lastPollAt 输出秒值；从未轮询输出 NaN', () => {
    const polled = aggregateWorkerMetrics(makeInput({ lastPollAtMs: 5_000_000 }))
    expect(polled.find(m => m.name === 'excuse_worker_last_poll_timestamp_seconds')!.samples[0]!.value).toBe(5000)

    const never = aggregateWorkerMetrics(makeInput({ lastPollAtMs: null }))
    const ts = never.find(m => m.name === 'excuse_worker_last_poll_timestamp_seconds')!
    expect(Number.isNaN(ts.samples[0]!.value)).toBe(true)

    // NaN 在 Prometheus exposition 中序列化为字面量 NaN
    const body = serializePrometheus(never)
    expect(body).toContain('excuse_worker_last_poll_timestamp_seconds NaN')
  })

  it('纯函数：不修改入参', () => {
    const input = makeInput()
    const snapshot = { ...input }
    aggregateWorkerMetrics(input)
    expect(input).toEqual(snapshot)
  })
})
