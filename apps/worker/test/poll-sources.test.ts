/**
 * PollSource 行为测试 — createTaskPollSource 的优雅退出 drain（TODO2 §1.3）
 *
 * 验证统一任务队列轮询源把 in-flight promise 写入 currentTaskPromiseRef，
 * 使 setupGracefulShutdown 能 drain 最长的阶段（如 canvas.assemble），而非只 drain 视频。
 */
import type { WorkerHealthState } from '../src/health'
import { describe, expect, it, mock } from 'bun:test'

// ── 可控 deferred：让 handleTask 在测试期间挂起，以便观察 ref 被设置 ──
let resolveHandle: ((v: unknown) => void) | undefined
let handlePromise: Promise<unknown>

function resetHandle() {
  handlePromise = new Promise((res) => {
    resolveHandle = res
  })
}

mock.module('@excuse/task-engine', () => ({
  claimNextTaskWithAdapter: async () => ({ id: 'task-1', type: 'canvas.assemble', projectId: 'proj-1' }),
  completeTaskWithAdapter: async () => null, // succeeded=null → 跳过 advance 分支
}))

mock.module('@excuse/db', () => ({
  claimNextTask: async () => null,
  extendTaskLock: async () => undefined,
  getTaskById: async () => null,
  markTaskSucceeded: async () => undefined,
  notifyTaskStatusChange: async () => undefined,
  pollPendingASRProjects: async () => [],
  pollPendingVideoTasks: async () => [],
}))

mock.module('../src/task-handler', () => ({
  // handleTask 返回挂起的 promise，模拟长任务在途
  handleTask: async () => handlePromise,
  handleTaskError: async () => undefined,
}))

mock.module('../src/heartbeat', () => ({
  startTaskHeartbeat: () => () => undefined,
}))

mock.module('../src/pipeline-stepper', () => ({
  advancePipelineAfterTaskSuccess: async () => undefined,
}))

// eslint-disable-next-line import/first
import { createTaskPollSource } from '../src/poll-sources'

const healthState: WorkerHealthState = {
  isPolling: false,
  lastPollAt: null,
  lastPollError: null,
  totalTasksProcessed: 0,
  startedAt: new Date(),
  workerId: 'worker-test',
  currentTaskId: null,
  tasksClaimed: 0,
  orphanSweeps: 0,
  lastSweepAt: null,
}

const ctx = { config: { claimTtlMs: 30_000 } } as unknown as Parameters<typeof createTaskPollSource>[0]

describe('createTaskPollSource — 优雅退出 drain（TODO2 §1.3）', () => {
  it('任务在途时把 promise 写入 currentTaskPromiseRef，完成后清空', async () => {
    resetHandle()
    const refs = { currentTaskPromiseRef: { value: null as Promise<unknown> | null } }
    const source = createTaskPollSource(ctx, healthState, refs)

    const pollPromise = source.poll()

    // 让 claim 微任务落地（claim 已 resolve，ref 被设置；handleTask 仍挂起）
    await new Promise(r => setTimeout(r, 0))

    // handleTask 仍挂起 → ref 应已被设置为在途 promise
    expect(refs.currentTaskPromiseRef.value).toBeTruthy()
    expect(refs.currentTaskPromiseRef.value).toBeInstanceOf(Promise)

    resolveHandle!('done')
    const count = await pollPromise

    // 完成后 ref 清空、计数为 1
    expect(count).toBe(1)
    expect(refs.currentTaskPromiseRef.value).toBeNull()
    expect(healthState.tasksClaimed).toBe(1)
    expect(healthState.currentTaskId).toBeNull()
  })

  it('无任务可认领时不触碰 ref', async () => {
    // 临时让 claim 返回 null
    const { claimNextTaskWithAdapter } = await import('@excuse/task-engine')
    const original = claimNextTaskWithAdapter
    mock.module('@excuse/task-engine', () => ({
      claimNextTaskWithAdapter: async () => null,
      completeTaskWithAdapter: async () => null,
    }))
    const refs = { currentTaskPromiseRef: { value: null as Promise<unknown> | null } }
    const source = createTaskPollSource(ctx, healthState, refs)

    const count = await source.poll()
    expect(count).toBe(0)
    expect(refs.currentTaskPromiseRef.value).toBeNull()

    // 还原 mock 供后续用例
    mock.module('@excuse/task-engine', () => ({
      claimNextTaskWithAdapter: original,
      completeTaskWithAdapter: async () => null,
    }))
    void original
  })
})
