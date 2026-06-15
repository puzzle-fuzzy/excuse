export type TaskErrorCategory = 'provider_error' | 'timeout' | 'validation' | 'system'

export type TaskHandler<TTask, TContext, TOutput = Record<string, unknown> | undefined> = (
  task: TTask,
  context: TContext,
) => Promise<TOutput> | TOutput

export interface TaskErrorDecision {
  category: TaskErrorCategory
  retriable: boolean
  code?: string
  message: string
}

export interface TaskErrorInfo {
  category: TaskErrorCategory
  retriable: boolean
  code?: string
  message: string
}

export type TaskFailureAction
  = | { action: 'retry', decision: TaskErrorDecision, delayMs: number }
    | { action: 'fail', decision: TaskErrorDecision }

export interface TaskRetryCandidate {
  type: string
  attempts: number
  maxAttempts: number
}

export interface TaskStatusCandidate {
  status: string
}

export interface TaskDefinition<TTask, TContext, TOutput = Record<string, unknown> | undefined> {
  type: string
  handler: TaskHandler<TTask, TContext, TOutput>
}

export interface TaskCompletionAdapter<TTask extends { id: string }, TOutput = Record<string, unknown> | undefined> {
  markTaskSucceeded: (id: string, output?: TOutput) => Promise<TTask | null> | TTask | null
  notifyTaskStatusChange: (task: TTask) => Promise<unknown> | unknown
}

export interface CompleteTaskWithAdapterInput<TTask extends { id: string }, TOutput = Record<string, unknown> | undefined> {
  task: TTask
  output?: TOutput
  adapter: TaskCompletionAdapter<TTask, TOutput>
}

export interface TaskClaimAdapter<TTask> {
  claimNextTask: (workerId: string, claimTtlMs: number) => Promise<TTask | null> | TTask | null
}

export interface ClaimNextTaskWithAdapterInput<TTask> {
  workerId: string
  claimTtlMs: number
  adapter: TaskClaimAdapter<TTask>
}

export interface TaskSweepAdapter {
  sweepOrphanTasks: (timeoutMinutes?: number) => Promise<number> | number
}

export interface SweepOrphanTasksWithAdapterInput {
  timeoutMinutes?: number
  adapter: TaskSweepAdapter
}

export interface TaskHeartbeatAdapter<TTask> {
  extendTaskLock: (id: string, workerId: string, claimTtlMs: number) => Promise<TTask | null> | TTask | null
}

export interface ExtendTaskLockWithAdapterInput<TTask> {
  taskId: string
  workerId: string
  claimTtlMs: number
  adapter: TaskHeartbeatAdapter<TTask>
}

export interface TaskCancelAdapter<TTask> {
  cancelTask: (id: string) => Promise<TTask | null> | TTask | null
}

export interface CancelTaskWithAdapterInput<TTask> {
  taskId: string
  adapter: TaskCancelAdapter<TTask>
}

/** 暂停 / 恢复 adapter — 将任务置为暂停状态或从暂停恢复（不改变队列数据，只锁状态） */
export interface TaskPauseAdapter<TTask> {
  pauseTask: (id: string) => Promise<TTask | null> | TTask | null
  resumeTask: (id: string) => Promise<TTask | null> | TTask | null
}

export interface PauseTaskWithAdapterInput<TTask> {
  taskId: string
  adapter: TaskPauseAdapter<TTask>
}

export interface TaskFailureAdapter {
  markTaskRetrying: (id: string, nextRunAt: Date) => Promise<unknown> | unknown
  markTaskFailed: (id: string, errorInfo?: TaskErrorInfo, errorMessage?: string) => Promise<unknown> | unknown
}

export interface ApplyTaskFailureWithAdapterInput<TTask extends TaskRetryCandidate & { id: string }> {
  task: TTask
  error: unknown
  adapter: TaskFailureAdapter
  now?: () => number
}

export type ApplyTaskFailureWithAdapterResult
  = | { action: 'retry', decision: TaskErrorDecision, delayMs: number, nextRunAt: Date }
    | { action: 'fail', decision: TaskErrorDecision, errorInfo: TaskErrorInfo, errorMessage: string }

export class TaskHandlerRegistry<TTask extends { type: string }, TContext, TOutput = Record<string, unknown> | undefined> {
  private readonly handlers = new Map<string, TaskHandler<TTask, TContext, TOutput>>()

  register(definition: TaskDefinition<TTask, TContext, TOutput>): this {
    this.handlers.set(definition.type, definition.handler)
    return this
  }

  registerMany(definitions: Array<TaskDefinition<TTask, TContext, TOutput>>): this {
    for (const definition of definitions) {
      this.register(definition)
    }
    return this
  }

  has(taskType: string): boolean {
    return this.handlers.has(taskType)
  }

  get(taskType: string): TaskHandler<TTask, TContext, TOutput> | undefined {
    return this.handlers.get(taskType)
  }

  listTypes(): string[] {
    return [...this.handlers.keys()]
  }

  async handle(task: TTask, context: TContext): Promise<TOutput> {
    const handler = this.get(task.type)
    if (!handler)
      throw new TaskNotImplementedError(task.type)
    return handler(task, context)
  }
}

export class TaskNotImplementedError extends Error {
  constructor(taskType: string) {
    super(`Task handler not implemented: ${taskType}`)
    this.name = 'TaskNotImplementedError'
  }
}

export function createTaskHandlerRegistry<TTask extends { type: string }, TContext, TOutput = Record<string, unknown> | undefined>(
  definitions: Array<TaskDefinition<TTask, TContext, TOutput>> = [],
): TaskHandlerRegistry<TTask, TContext, TOutput> {
  return new TaskHandlerRegistry<TTask, TContext, TOutput>().registerMany(definitions)
}

export async function completeTaskWithAdapter<TTask extends { id: string }, TOutput = Record<string, unknown> | undefined>(
  input: CompleteTaskWithAdapterInput<TTask, TOutput>,
): Promise<TTask | null> {
  const updatedTask = await input.adapter.markTaskSucceeded(input.task.id, input.output)
  if (updatedTask)
    await input.adapter.notifyTaskStatusChange(updatedTask)
  return updatedTask
}

/**
 * 通过 adapter 领取下一个可执行任务 — Worker 运行时编排保持，DB claim 实现注入
 *
 * @returns 被 claim 的 task，或 null（无 eligible task）
 */
export async function claimNextTaskWithAdapter<TTask>(
  input: ClaimNextTaskWithAdapterInput<TTask>,
): Promise<TTask | null> {
  return input.adapter.claimNextTask(input.workerId, input.claimTtlMs)
}

/**
 * 通过 adapter 恢复孤儿任务 — Worker 定时 sweep 编排保持，DB sweep 实现注入
 *
 * `input.timeoutMinutes` 为 undefined 时由 adapter 使用其默认值
 *
 * @returns 恢复的任务数量
 */
export async function sweepOrphanTasksWithAdapter(
  input: SweepOrphanTasksWithAdapterInput,
): Promise<number> {
  return input.adapter.sweepOrphanTasks(input.timeoutMinutes)
}

/**
 * 通过 adapter 延长任务锁 — heartbeat 定期续锁的续锁动作注入，task-engine 不依赖 DB
 *
 * @returns 续锁后的 task；adapter 返回 null 表示任务已不再 running（被 sweep/cancel）
 */
export async function extendTaskLockWithAdapter<TTask>(
  input: ExtendTaskLockWithAdapterInput<TTask>,
): Promise<TTask | null> {
  return input.adapter.extendTaskLock(input.taskId, input.workerId, input.claimTtlMs)
}

/**
 * 通过 adapter 取消任务 — 取消状态转换注入，task-engine 不依赖 DB
 *
 * 仅收口 `tasks` 表的取消动作；Canvas pipeline run / canvas_assets 取消属于业务边界，
 * 仍由外层 route 决定「取消哪个 run / 哪些资产」。
 *
 * @returns 被取消的 task；null 表示任务已不在可取消状态
 */
export async function cancelTaskWithAdapter<TTask>(
  input: CancelTaskWithAdapterInput<TTask>,
): Promise<TTask | null> {
  return input.adapter.cancelTask(input.taskId)
}

/**
 * 通过 adapter 暂停任务 — 暂停状态注入，task-engine 不依赖 DB
 *
 * @returns 被暂停的 task；null 表示任务已不在可暂停状态
 */
export async function pauseTaskWithAdapter<TTask>(
  input: PauseTaskWithAdapterInput<TTask>,
): Promise<TTask | null> {
  return input.adapter.pauseTask(input.taskId)
}

/**
 * 通过 adapter 恢复任务 — 从暂停恢复，task-engine 不依赖 DB
 *
 * @returns 恢复后的 task；null 表示任务已不在暂停状态
 */
export async function resumeTaskWithAdapter<TTask>(
  input: PauseTaskWithAdapterInput<TTask>,
): Promise<TTask | null> {
  return input.adapter.resumeTask(input.taskId)
}

export function canRequeueTask(task: TaskStatusCandidate): boolean {
  return task.status === 'failed' || task.status === 'retrying' || task.status === 'queued'
}

export function canCancelTask(task: TaskStatusCandidate): boolean {
  return task.status === 'queued' || task.status === 'running' || task.status === 'retrying'
}

export function canPauseTask(task: TaskStatusCandidate): boolean {
  return task.status === 'queued' || task.status === 'running' || task.status === 'retrying'
}

export function canResumeTask(task: TaskStatusCandidate): boolean {
  return task.status === 'paused'
}

export async function applyTaskFailureWithAdapter<TTask extends TaskRetryCandidate & { id: string }>(
  input: ApplyTaskFailureWithAdapterInput<TTask>,
): Promise<ApplyTaskFailureWithAdapterResult> {
  const failureAction = decideTaskFailureAction(input.task, input.error)
  if (failureAction.action === 'retry') {
    const nextRunAt = new Date((input.now?.() ?? Date.now()) + failureAction.delayMs)
    await input.adapter.markTaskRetrying(input.task.id, nextRunAt)
    return {
      action: 'retry',
      decision: failureAction.decision,
      delayMs: failureAction.delayMs,
      nextRunAt,
    }
  }

  const errorMessage = input.error instanceof Error ? input.error.message : String(input.error)
  const errorInfo = toTaskErrorInfo(failureAction.decision, errorMessage)
  await input.adapter.markTaskFailed(input.task.id, errorInfo, errorMessage)
  return {
    action: 'fail',
    decision: failureAction.decision,
    errorInfo,
    errorMessage,
  }
}

export function classifyTaskError(error: unknown): TaskErrorDecision {
  const message = error instanceof Error ? error.message : String(error)

  if (error instanceof TaskNotImplementedError) {
    return {
      category: 'validation',
      retriable: false,
      message,
    }
  }

  if (!(error instanceof Error)) {
    return {
      category: 'system',
      retriable: false,
      message,
    }
  }

  const code = extractErrorCode(error)
  const retriable = isRetriableTaskErrorCode(code)
  return {
    category: categorizeTaskErrorCode(code),
    retriable,
    ...(code && { code }),
    message,
  }
}

export function shouldRetryTask(
  error: unknown,
  attempts: number,
  maxAttempts: number,
): boolean {
  return classifyTaskError(error).retriable && attempts < maxAttempts
}

export function decideTaskFailureAction(task: TaskRetryCandidate, error: unknown): TaskFailureAction {
  const decision = classifyTaskError(error)
  if (decision.retriable && task.attempts < task.maxAttempts) {
    return {
      action: 'retry',
      decision,
      delayMs: computeRetryDelay(task.type, task.attempts),
    }
  }

  return {
    action: 'fail',
    decision,
  }
}

export function computeRetryDelay(taskType: string, attempts: number): number {
  if (taskType.includes('video') || taskType === 'canvas.videos' || taskType === 'generate.video') {
    return 60_000 * 2 ** Math.min(attempts - 1, 3)
  }
  return 30_000
}

export function extractErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error))
    return undefined
  const cause = error.cause as { code?: string } | undefined
  return cause?.code
}

function isRetriableTaskErrorCode(code: string | undefined): boolean {
  return code === 'ECONNREFUSED'
    || code === 'ETIMEDOUT'
    || code === 'ECONNRESET'
    || code === 'Throttling'
    || code === 'InternalError'
    || code === 'TIMEOUT'
}

function categorizeTaskErrorCode(code: string | undefined): TaskErrorCategory {
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'TIMEOUT')
    return 'timeout'
  if (code === 'Throttling' || code === 'InternalError' || code === 'ECONNRESET')
    return 'provider_error'
  return 'system'
}

function toTaskErrorInfo(decision: TaskErrorDecision, message: string): TaskErrorInfo {
  return {
    category: decision.category,
    retriable: decision.retriable,
    ...(decision.code && { code: decision.code }),
    message,
  }
}
