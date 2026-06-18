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

export interface TaskPriorityInput {
  type: string
  domain: string
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

/**
 * 任务输入非法 — JSONB task.input 解析失败（缺字段 / 类型错 / 坏数据）。
 *
 * 这类错误是输入侧问题，重试不会自愈 → 分类为 validation / retriable=false，
 * 直接永久失败（markTaskFailed），不进入重试队列。
 */
export class TaskInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TaskInputError'
  }
}

/**
 * 任务锁丢失 — worker 在执行过程中丢失了对任务的锁所有权。
 *
 * 原因：heartbeat 续锁失败（DB 瞬断 / 临时中断），或孤儿 sweep 已将任务重置为 queued。
 * 此错误是系统级瞬态问题 → retriable=true，任务应重新排队而非永久失败。
 */
export class TaskLockLostError extends Error {
  constructor(taskId: string, workerId: string) {
    super(`Lock ownership lost for task ${taskId} (worker ${workerId})`)
    this.name = 'TaskLockLostError'
    this.code = 'LOCK_LOST'
  }

  code: string
}

export function createTaskHandlerRegistry<TTask extends { type: string }, TContext, TOutput = Record<string, unknown> | undefined>(
  definitions: Array<TaskDefinition<TTask, TContext, TOutput>> = [],
): TaskHandlerRegistry<TTask, TContext, TOutput> {
  return new TaskHandlerRegistry<TTask, TContext, TOutput>().registerMany(definitions)
}

/**
 * 统一任务优先级策略。
 *
 * 数字越小越早被 `claimNextTask` 领取。Worker 当前单进程串行执行 task，
 * 因此 priority 是用户可感知公平性的第一道调度边界。
 */
export function getTaskPriority(input: TaskPriorityInput): number {
  if (input.type === 'generate.video')
    return 4
  if (input.type === 'subtitle.asr')
    return 4
  if (input.type === 'media.extract-audio')
    return 3
  if (input.type === 'media.burn-subtitle')
    return 3
  if (input.type === 'canvas.videos')
    return 6
  if (input.domain === 'canvas')
    return 5
  return 5
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

  // 任务输入非法 → validation / 永久失败，重试不会自愈
  if (error instanceof TaskInputError) {
    return {
      category: 'validation',
      retriable: false,
      message,
    }
  }

  // 任务锁丢失 → system / 可重试，任务应重新排队
  if (error instanceof TaskLockLostError) {
    return {
      category: 'system',
      retriable: true,
      code: 'LOCK_LOST',
      message,
    }
  }

  // FFmpeg 操作超时 → timeout / 可重试（由 @excuse/ffmpeg 的 spawnFfmpeg 抛出）
  if (error instanceof Error && error.name === 'FfmpegTimeoutError') {
    return {
      category: 'timeout',
      retriable: true,
      code: 'FFMPEG_TIMEOUT',
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

/**
 * 统一任务退避策略（与 getTaskPriority 同属 task-engine 持有的「策略表」）。
 *
 * 慢阶段（video）用指数退避（60s → 120s → 240s → 480s，封顶 4 次），其余固定 30s。
 *
 * 设计说明（TODO2 §4.2，接受现状 + 文档化）：priority/backoff 按已知 phase/type 字符串
 * 特判确实让 task-engine（生命周期）越界懂了 workflow-engine（phase 编排）的词汇，
 * 但策略无处更合适安放——挪到 workflow-engine 会让 task-engine 无法独立计算退避。
 * 故保留此策略表，新增「慢阶段」时在此一处登记即可（无需改机制）。
 */
export function computeRetryDelay(taskType: string, attempts: number): number {
  // 轮询型 task（generate.video / subtitle.asr）：固定 5s 间隔重新 poll
  if (taskType === 'generate.video' || taskType === 'subtitle.asr') {
    return 5_000
  }
  if (taskType.includes('video') || taskType === 'canvas.videos') {
    return 60_000 * 2 ** Math.min(attempts - 1, 3)
  }
  return 30_000
}

export function extractErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error))
    return undefined
  // provider guard 抛出的 ModelDegradedError 把 code 放在 error 自身（非 cause），
  // 此处一并识别，让降级快速失败被分类为可重试的 provider_error。
  const ownCode = (error as { code?: string }).code
  if (ownCode)
    return ownCode
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
    || code === 'MODEL_DEGRADED'
    || code === 'LOCK_LOST'
}

function categorizeTaskErrorCode(code: string | undefined): TaskErrorCategory {
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'TIMEOUT')
    return 'timeout'
  if (code === 'Throttling' || code === 'InternalError' || code === 'ECONNRESET' || code === 'MODEL_DEGRADED')
    return 'provider_error'
  if (code === 'LOCK_LOST')
    return 'system'
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
