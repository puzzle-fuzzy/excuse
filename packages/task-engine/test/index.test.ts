import { describe, expect, it } from 'bun:test'
import {
  applyTaskFailureWithAdapter,
  canCancelTask,
  cancelTaskWithAdapter,
  canRequeueTask,
  claimNextTaskWithAdapter,
  classifyTaskError,
  completeTaskWithAdapter,
  computeRetryDelay,
  createTaskHandlerRegistry,
  decideTaskFailureAction,
  extendTaskLockWithAdapter,
  shouldRetryTask,
  sweepOrphanTasksWithAdapter,
  TaskNotImplementedError,
} from '../src'

describe('@excuse/task-engine', () => {
  it('classifies unimplemented tasks as validation and non-retriable', () => {
    const decision = classifyTaskError(new TaskNotImplementedError('generate.video'))

    expect(decision).toEqual({
      category: 'validation',
      retriable: false,
      message: 'Task handler not implemented: generate.video',
    })
  })

  it('marks provider transient errors as retriable', () => {
    const error = new Error('provider throttled', { cause: { code: 'Throttling' } })

    expect(classifyTaskError(error)).toEqual({
      category: 'provider_error',
      retriable: true,
      code: 'Throttling',
      message: 'provider throttled',
    })
  })

  it('marks invalid parameter errors as non-retriable system errors', () => {
    const error = new Error('bad request', { cause: { code: 'InvalidParameter' } })

    expect(classifyTaskError(error)).toEqual({
      category: 'system',
      retriable: false,
      code: 'InvalidParameter',
      message: 'bad request',
    })
  })

  it('checks retry budget', () => {
    const error = new Error('timeout', { cause: { code: 'ETIMEDOUT' } })

    expect(shouldRetryTask(error, 1, 3)).toBe(true)
    expect(shouldRetryTask(error, 3, 3)).toBe(false)
  })

  it('exposes admin-safe task operation guards', () => {
    expect(canRequeueTask({ status: 'failed' })).toBe(true)
    expect(canRequeueTask({ status: 'retrying' })).toBe(true)
    expect(canRequeueTask({ status: 'queued' })).toBe(true)
    expect(canRequeueTask({ status: 'running' })).toBe(false)
    expect(canRequeueTask({ status: 'succeeded' })).toBe(false)

    expect(canCancelTask({ status: 'queued' })).toBe(true)
    expect(canCancelTask({ status: 'running' })).toBe(true)
    expect(canCancelTask({ status: 'retrying' })).toBe(true)
    expect(canCancelTask({ status: 'failed' })).toBe(false)
    expect(canCancelTask({ status: 'succeeded' })).toBe(false)
  })

  it('uses longer exponential delay for video tasks', () => {
    expect(computeRetryDelay('canvas.videos', 1)).toBe(60_000)
    expect(computeRetryDelay('generate.video', 3)).toBe(240_000)
    expect(computeRetryDelay('canvas.analyze', 3)).toBe(30_000)
  })

  it('dispatches tasks through a typed handler registry', async () => {
    const registry = createTaskHandlerRegistry<
      { type: string, payload: string },
      { suffix: string },
      { value: string }
    >([
      {
        type: 'demo.echo',
        handler: (task, context) => ({ value: `${task.payload}${context.suffix}` }),
      },
    ])

    expect(registry.has('demo.echo')).toBe(true)
    expect(registry.listTypes()).toEqual(['demo.echo'])
    await expect(registry.handle({ type: 'demo.echo', payload: 'hello' }, { suffix: '!' })).resolves.toEqual({
      value: 'hello!',
    })
  })

  it('throws TaskNotImplementedError for unregistered task types', async () => {
    const registry = createTaskHandlerRegistry<{ type: string }, undefined>()

    await expect(registry.handle({ type: 'missing.task' }, undefined)).rejects.toThrow(TaskNotImplementedError)
  })

  it('allows later registrations to replace handlers for a task type', async () => {
    const registry = createTaskHandlerRegistry<{ type: string }, undefined, string>()
      .register({ type: 'demo.task', handler: () => 'first' })
      .register({ type: 'demo.task', handler: () => 'second' })

    await expect(registry.handle({ type: 'demo.task' }, undefined)).resolves.toBe('second')
  })

  it('decides retry action with the task retry delay policy', () => {
    const error = new Error('timeout', { cause: { code: 'ETIMEDOUT' } })

    expect(decideTaskFailureAction({
      type: 'generate.video',
      attempts: 2,
      maxAttempts: 3,
    }, error)).toEqual({
      action: 'retry',
      delayMs: 120_000,
      decision: {
        category: 'timeout',
        retriable: true,
        code: 'ETIMEDOUT',
        message: 'timeout',
      },
    })
  })

  it('decides fail action when retry budget is exhausted', () => {
    const error = new Error('timeout', { cause: { code: 'ETIMEDOUT' } })

    expect(decideTaskFailureAction({
      type: 'generate.video',
      attempts: 3,
      maxAttempts: 3,
    }, error)).toEqual({
      action: 'fail',
      decision: {
        category: 'timeout',
        retriable: true,
        code: 'ETIMEDOUT',
        message: 'timeout',
      },
    })
  })

  it('completes a task through an adapter and notifies when updated', async () => {
    const calls: string[] = []
    const updated = await completeTaskWithAdapter({
      task: { id: 'task-1' },
      output: { ok: true },
      adapter: {
        markTaskSucceeded: async (id, output) => {
          calls.push(`succeed:${id}:${JSON.stringify(output)}`)
          return { id, status: 'succeeded' }
        },
        notifyTaskStatusChange: async (task) => {
          calls.push(`notify:${task.id}`)
        },
      },
    })

    expect(updated).toEqual({ id: 'task-1', status: 'succeeded' })
    expect(calls).toEqual(['succeed:task-1:{"ok":true}', 'notify:task-1'])
  })

  it('does not notify when complete adapter returns null', async () => {
    const calls: string[] = []
    const updated = await completeTaskWithAdapter({
      task: { id: 'task-1' },
      adapter: {
        markTaskSucceeded: async (id) => {
          calls.push(`succeed:${id}`)
          return null
        },
        notifyTaskStatusChange: async (task) => {
          calls.push(`notify:${task.id}`)
        },
      },
    })

    expect(updated).toBeNull()
    expect(calls).toEqual(['succeed:task-1'])
  })

  it('claims the next task through an adapter', async () => {
    const calls: Array<[string, number]> = []
    const claimed = { id: 'task-1', type: 'canvas.analyze' }
    const result = await claimNextTaskWithAdapter({
      workerId: 'worker-1',
      claimTtlMs: 30_000,
      adapter: {
        claimNextTask: async (workerId, claimTtlMs) => {
          calls.push([workerId, claimTtlMs])
          return claimed
        },
      },
    })

    expect(result).toBe(claimed)
    expect(calls).toEqual([['worker-1', 30_000]])
  })

  it('returns null when claim adapter has no eligible task', async () => {
    const result = await claimNextTaskWithAdapter({
      workerId: 'worker-1',
      claimTtlMs: 30_000,
      adapter: {
        claimNextTask: async () => null,
      },
    })

    expect(result).toBeNull()
  })

  it('sweeps orphan tasks through an adapter and returns recovered count', async () => {
    const calls: Array<[number | undefined]> = []
    const result = await sweepOrphanTasksWithAdapter({
      timeoutMinutes: 5,
      adapter: {
        sweepOrphanTasks: async (timeoutMinutes) => {
          calls.push([timeoutMinutes])
          return 3
        },
      },
    })

    expect(result).toBe(3)
    expect(calls).toEqual([[5]])
  })

  it('forwards undefined timeoutMinutes to the sweep adapter default', async () => {
    const calls: Array<[number | undefined]> = []
    const result = await sweepOrphanTasksWithAdapter({
      adapter: {
        sweepOrphanTasks: async (timeoutMinutes) => {
          calls.push([timeoutMinutes])
          return 0
        },
      },
    })

    expect(result).toBe(0)
    expect(calls).toEqual([[undefined]])
  })

  it('extends a task lock through an adapter with task/worker/ttl args', async () => {
    const calls: Array<[string, string, number]> = []
    const updated = { id: 'task-1', status: 'running' }
    const result = await extendTaskLockWithAdapter({
      taskId: 'task-1',
      workerId: 'worker-1',
      claimTtlMs: 30_000,
      adapter: {
        extendTaskLock: async (id, workerId, claimTtlMs) => {
          calls.push([id, workerId, claimTtlMs])
          return updated
        },
      },
    })

    expect(result).toBe(updated)
    expect(calls).toEqual([['task-1', 'worker-1', 30_000]])
  })

  it('returns null when extend lock adapter reports task no longer running', async () => {
    const result = await extendTaskLockWithAdapter({
      taskId: 'task-1',
      workerId: 'worker-1',
      claimTtlMs: 30_000,
      adapter: {
        extendTaskLock: async () => null,
      },
    })

    expect(result).toBeNull()
  })

  it('cancels a task through an adapter and returns the cancelled task', async () => {
    const calls: string[] = []
    const cancelled = { id: 'task-1', status: 'cancelled' }
    const result = await cancelTaskWithAdapter({
      taskId: 'task-1',
      adapter: {
        cancelTask: async (id) => {
          calls.push(id)
          return cancelled
        },
      },
    })

    expect(result).toBe(cancelled)
    expect(calls).toEqual(['task-1'])
  })

  it('returns null when cancel adapter reports task already in terminal state', async () => {
    const result = await cancelTaskWithAdapter({
      taskId: 'task-1',
      adapter: {
        cancelTask: async () => null,
      },
    })

    expect(result).toBeNull()
  })

  it('applies retry failure action through an adapter', async () => {
    const error = new Error('throttled', { cause: { code: 'Throttling' } })
    const calls: string[] = []
    const result = await applyTaskFailureWithAdapter({
      task: { id: 'task-1', type: 'canvas.videos', attempts: 1, maxAttempts: 3 },
      error,
      now: () => 1_000,
      adapter: {
        markTaskRetrying: async (id, nextRunAt) => {
          calls.push(`retry:${id}:${nextRunAt.getTime()}`)
        },
        markTaskFailed: async () => {
          calls.push('fail')
        },
      },
    })

    expect(result).toMatchObject({
      action: 'retry',
      delayMs: 60_000,
    })
    expect(calls).toEqual(['retry:task-1:61000'])
  })

  it('applies fail action through an adapter when retry budget is exhausted', async () => {
    const error = new Error('timeout', { cause: { code: 'ETIMEDOUT' } })
    const calls: unknown[] = []
    const result = await applyTaskFailureWithAdapter({
      task: { id: 'task-1', type: 'canvas.videos', attempts: 3, maxAttempts: 3 },
      error,
      adapter: {
        markTaskRetrying: async () => {
          calls.push('retry')
        },
        markTaskFailed: async (id, errorInfo, errorMessage) => {
          calls.push({ id, errorInfo, errorMessage })
        },
      },
    })

    const expectedFailure = {
      id: 'task-1',
      errorInfo: {
        category: 'timeout',
        retriable: true,
        code: 'ETIMEDOUT',
        message: 'timeout',
      },
      errorMessage: 'timeout',
    }

    expect(result).toMatchObject({
      action: 'fail',
      errorInfo: expectedFailure.errorInfo,
      errorMessage: expectedFailure.errorMessage,
    })
    expect(calls).toEqual([expectedFailure])
  })
})
