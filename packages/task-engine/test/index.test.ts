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
  getTaskPriority,
  shouldRetryTask,
  sweepOrphanTasksWithAdapter,
  TaskInputError,
  TaskNotImplementedError,
} from '../src'

describe('@excuse/task-engine', () => {
  it('未实现任务分类为 validation 且不可重试', () => {
    const decision = classifyTaskError(new TaskNotImplementedError('generate.video'))

    expect(decision).toEqual({
      category: 'validation',
      retriable: false,
      message: 'Task handler not implemented: generate.video',
    })
  })

  it('任务输入非法（TaskInputError）分类为 validation 且不可重试', () => {
    const decision = classifyTaskError(new TaskInputError('media.extract-audio input missing videoFileId'))

    expect(decision).toEqual({
      category: 'validation',
      retriable: false,
      message: 'media.extract-audio input missing videoFileId',
    })
  })

  it('provider 瞬时错误标记为可重试', () => {
    const error = new Error('provider throttled', { cause: { code: 'Throttling' } })

    expect(classifyTaskError(error)).toEqual({
      category: 'provider_error',
      retriable: true,
      code: 'Throttling',
      message: 'provider throttled',
    })
  })

  it('无效参数错误标记为不可重试的 system 错误', () => {
    const error = new Error('bad request', { cause: { code: 'InvalidParameter' } })

    expect(classifyTaskError(error)).toEqual({
      category: 'system',
      retriable: false,
      code: 'InvalidParameter',
      message: 'bad request',
    })
  })

  it('模型降级（MODEL_DEGRADED，code 在 error 自身）分类为可重试的 provider_error', () => {
    // 模拟 provider guard 抛出的 ModelDegradedError：code 在 error 自身而非 cause
    const error: Error & { code: string } = Object.assign(
      new Error('模型 qwen-max 暂时不可用（连续失败已降级）'),
      { code: 'MODEL_DEGRADED' },
    )

    expect(classifyTaskError(error)).toEqual({
      category: 'provider_error',
      retriable: true,
      code: 'MODEL_DEGRADED',
      message: '模型 qwen-max 暂时不可用（连续失败已降级）',
    })
  })

  it('检查重试预算', () => {
    const error = new Error('timeout', { cause: { code: 'ETIMEDOUT' } })

    expect(shouldRetryTask(error, 1, 3)).toBe(true)
    expect(shouldRetryTask(error, 3, 3)).toBe(false)
  })

  it('暴露管理安全的任务操作守卫', () => {
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

  it('视频任务使用更长的指数延迟', () => {
    expect(computeRetryDelay('canvas.videos', 1)).toBe(60_000)
    expect(computeRetryDelay('generate.video', 3)).toBe(240_000)
    expect(computeRetryDelay('canvas.analyze', 3)).toBe(30_000)
  })

  it('按任务类型返回统一队列优先级', () => {
    expect(getTaskPriority({ type: 'media.extract-audio', domain: 'subtitle' })).toBe(3)
    expect(getTaskPriority({ type: 'media.burn-subtitle', domain: 'subtitle' })).toBe(3)
    expect(getTaskPriority({ type: 'canvas.analyze', domain: 'canvas' })).toBe(5)
    expect(getTaskPriority({ type: 'canvas.videos', domain: 'canvas' })).toBe(6)
    expect(getTaskPriority({ type: 'unknown.task', domain: 'generate' })).toBe(5)
  })

  it('通过类型化 handler 注册表分发任务', async () => {
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

  it('未注册任务类型抛出 TaskNotImplementedError', async () => {
    const registry = createTaskHandlerRegistry<{ type: string }, undefined>()

    await expect(registry.handle({ type: 'missing.task' }, undefined)).rejects.toThrow(TaskNotImplementedError)
  })

  it('后续注册可替换任务类型的 handler', async () => {
    const registry = createTaskHandlerRegistry<{ type: string }, undefined, string>()
      .register({ type: 'demo.task', handler: () => 'first' })
      .register({ type: 'demo.task', handler: () => 'second' })

    await expect(registry.handle({ type: 'demo.task' }, undefined)).resolves.toBe('second')
  })

  it('根据任务重试延迟策略决定重试动作', () => {
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

  it('重试预算耗尽时决定失败动作', () => {
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

  it('通过 adapter 完成任务并在更新时通知', async () => {
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

  it('complete adapter 返回 null 时不通知', async () => {
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

  it('通过 adapter 领取下一个任务', async () => {
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

  it('claim adapter 无符合条件任务时返回 null', async () => {
    const result = await claimNextTaskWithAdapter({
      workerId: 'worker-1',
      claimTtlMs: 30_000,
      adapter: {
        claimNextTask: async () => null,
      },
    })

    expect(result).toBeNull()
  })

  it('通过 adapter 清扫孤立任务并返回恢复数量', async () => {
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

  it('undefined timeoutMinutes 转发给 sweep adapter 默认值', async () => {
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

  it('通过 adapter 延长任务锁，传入 task/worker/ttl 参数', async () => {
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

  it('extend lock adapter 报告任务不再运行时返回 null', async () => {
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

  it('通过 adapter 取消任务并返回已取消的任务', async () => {
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

  it('cancel adapter 报告任务已处于终态时返回 null', async () => {
    const result = await cancelTaskWithAdapter({
      taskId: 'task-1',
      adapter: {
        cancelTask: async () => null,
      },
    })

    expect(result).toBeNull()
  })

  it('通过 adapter 应用重试失败动作', async () => {
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

  it('重试预算耗尽时通过 adapter 应用失败动作', async () => {
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
