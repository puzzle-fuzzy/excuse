export type CanvasPipelinePhase
  = | 'analyze'
    | 'characters'
    | 'locations'
    | 'characterRefs'
    | 'locationRefs'
    | 'storyboard'
    | 'continuity'
    | 'rebuild'
    | 'videos'

export type CanvasAutoAdvanceSkipReason
  = | 'not_canvas_task'
    | 'unknown_phase'
    | 'last_phase'
    | 'auto_progress_disabled'
    | 'pause_before'

export interface CanvasTaskRef {
  type: string
  domain: string
  projectId: string | null
  accountId: string | null
}

export interface CanvasAutoAdvanceDecision {
  shouldAdvance: boolean
  currentPhase: CanvasPipelinePhase | null
  nextPhase: CanvasPipelinePhase | null
  reason?: CanvasAutoAdvanceSkipReason
}

export interface CanvasPipelineTaskAdapter<TRun extends { id: string }, TTask extends { id: string }> {
  createPipelineRun: (values: {
    projectId: string
    phase: CanvasPipelinePhase
    createdBy: string
  }) => Promise<TRun> | TRun
  createTask: (values: {
    accountId: string
    type: `canvas.${CanvasPipelinePhase}`
    domain: 'canvas'
    priority: number
    projectId: string
    targetType: 'pipeline_run'
    targetId: string
  }) => Promise<TTask> | TTask
  linkPipelineRunToTask: (runId: string, taskId: string) => Promise<unknown> | unknown
}

export interface CreateNextCanvasPipelineTaskInput<TRun extends { id: string }, TTask extends { id: string }> {
  projectId: string
  accountId: string
  nextPhase: CanvasPipelinePhase
  adapter: CanvasPipelineTaskAdapter<TRun, TTask>
}

export interface CreateNextCanvasPipelineTaskResult {
  runId: string
  taskId: string
  taskType: `canvas.${CanvasPipelinePhase}`
}

export const CANVAS_PHASE_ORDER: readonly CanvasPipelinePhase[] = [
  'analyze',
  'characters',
  'locations',
  'characterRefs',
  'locationRefs',
  'storyboard',
  'continuity',
  'rebuild',
  'videos',
]

export const CANVAS_PAUSE_BEFORE: ReadonlySet<CanvasPipelinePhase> = new Set([
  'storyboard',
  'videos',
])

/** 阶段是否需要用户确认才能继续（storyboard / videos） */
export function isPauseBeforePhase(phase: CanvasPipelinePhase): boolean {
  return CANVAS_PAUSE_BEFORE.has(phase)
}

export function phaseToTaskType(phase: CanvasPipelinePhase): `canvas.${CanvasPipelinePhase}` {
  return `canvas.${phase}`
}

export async function createNextCanvasPipelineTask<TRun extends { id: string }, TTask extends { id: string }>(
  input: CreateNextCanvasPipelineTaskInput<TRun, TTask>,
): Promise<CreateNextCanvasPipelineTaskResult> {
  const run = await input.adapter.createPipelineRun({
    projectId: input.projectId,
    phase: input.nextPhase,
    createdBy: input.accountId,
  })

  const taskType = phaseToTaskType(input.nextPhase)
  const task = await input.adapter.createTask({
    accountId: input.accountId,
    type: taskType,
    domain: 'canvas',
    priority: 5,
    projectId: input.projectId,
    targetType: 'pipeline_run',
    targetId: run.id,
  })

  await input.adapter.linkPipelineRunToTask(run.id, task.id)

  return {
    runId: run.id,
    taskId: task.id,
    taskType,
  }
}

export function getCanvasPhaseFromTaskType(taskType: string): CanvasPipelinePhase | null {
  if (!taskType.startsWith('canvas.'))
    return null

  const phase = taskType.slice('canvas.'.length) as CanvasPipelinePhase
  return isCanvasPipelinePhase(phase) ? phase : null
}

export function getNextCanvasPhase(currentPhase: CanvasPipelinePhase): CanvasPipelinePhase | null {
  const index = CANVAS_PHASE_ORDER.indexOf(currentPhase)
  if (index === -1 || index === CANVAS_PHASE_ORDER.length - 1)
    return null
  return CANVAS_PHASE_ORDER[index + 1]!
}

export function decideCanvasAutoAdvance(
  task: CanvasTaskRef,
  autoProgress: boolean,
): CanvasAutoAdvanceDecision {
  if (task.domain !== 'canvas' || !task.projectId || !task.accountId) {
    return {
      shouldAdvance: false,
      currentPhase: null,
      nextPhase: null,
      reason: 'not_canvas_task',
    }
  }

  const currentPhase = getCanvasPhaseFromTaskType(task.type)
  if (!currentPhase) {
    return {
      shouldAdvance: false,
      currentPhase: null,
      nextPhase: null,
      reason: 'unknown_phase',
    }
  }

  const nextPhase = getNextCanvasPhase(currentPhase)
  if (!nextPhase) {
    return {
      shouldAdvance: false,
      currentPhase,
      nextPhase: null,
      reason: 'last_phase',
    }
  }

  if (!autoProgress) {
    return {
      shouldAdvance: false,
      currentPhase,
      nextPhase,
      reason: 'auto_progress_disabled',
    }
  }

  if (isPauseBeforePhase(nextPhase)) {
    return {
      shouldAdvance: false,
      currentPhase,
      nextPhase,
      reason: 'pause_before',
    }
  }

  return {
    shouldAdvance: true,
    currentPhase,
    nextPhase,
  }
}

function isCanvasPipelinePhase(value: string): value is CanvasPipelinePhase {
  return CANVAS_PHASE_ORDER.includes(value as CanvasPipelinePhase)
}

// ===== Canvas pipeline run 状态规则 =====
// 纯状态判断，不依赖 DB/provider/server/worker runtime。
// PipelineRunStatus 镜像 @excuse/db 的 canvasPipelineRunStatusEnum（不 import，避免反向依赖）。

export type PipelineRunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/** 活跃状态 — 排队或执行中，可被取消、可阻止同阶段重复提交 */
export const CANVAS_ACTIVE_RUN_STATUSES: readonly PipelineRunStatus[] = ['pending', 'running']

/** 终态 — 成功/失败/取消，状态不再变化 */
export const CANVAS_TERMINAL_RUN_STATUSES: readonly PipelineRunStatus[] = ['succeeded', 'failed', 'cancelled']

/** 可重试终态 — failed 或 cancelled（succeeded 不可重试，active 需先取消） */
export const CANVAS_RETRYABLE_RUN_STATUSES: readonly PipelineRunStatus[] = ['failed', 'cancelled']

/** 最小 run 形状 — 只要求 status，便于对 DB 行或任意结构体复用规则 */
export interface PipelineRunLike {
  status: PipelineRunStatus
}

/** run 是否处于活跃状态（pending 或 running） */
export function isActivePipelineRun<T extends PipelineRunLike>(run: T): boolean {
  return CANVAS_ACTIVE_RUN_STATUSES.includes(run.status)
}

/** run 是否处于终态（succeeded/failed/cancelled） */
export function isTerminalPipelineRun<T extends PipelineRunLike>(run: T): boolean {
  return CANVAS_TERMINAL_RUN_STATUSES.includes(run.status)
}

/** run 是否可重新提交（failed 或 cancelled） */
export function isRetryablePipelineRun<T extends PipelineRunLike>(run: T): boolean {
  return CANVAS_RETRYABLE_RUN_STATUSES.includes(run.status)
}

/** 从 run 列表中筛出活跃 run，保留原始元素类型与顺序 */
export function filterActivePipelineRuns<T extends PipelineRunLike>(runs: readonly T[]): T[] {
  return runs.filter(isActivePipelineRun)
}

/** canAdvanceToPhase 选项 */
export interface CanAdvanceToPhaseOptions {
  /** 目标阶段是否已存在活跃 run（并发守卫） */
  hasActiveRun?: boolean
}

/**
 * 在已确定要自动推进的前提下，判断能否真正创建/执行目标阶段。
 *
 * 阻止条件：目标阶段是 pause-before（需用户确认），或已有活跃 run（并发守卫）。
 * 不关心 autoProgress —— 那是更上层的 decideCanvasAutoAdvance 职责。
 */
export function canAdvanceToPhase(phase: CanvasPipelinePhase, opts: CanAdvanceToPhaseOptions = {}): boolean {
  if (isPauseBeforePhase(phase))
    return false
  if (opts.hasActiveRun)
    return false
  return true
}

// ===== Batch outcome 规则 =====
// 批量结果分类：全部成功 / 部分失败 / 全部失败 / 仍在进行 / 空。
// 纯计算，不依赖 DB/provider/server/worker runtime。
// 解决"部分成功/全部失败/全部成功"判断散落在 server/worker 的问题。

export type BatchItemStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'cancelled'

/** 最小批量项形状 — 只要求 status，便于对 DB 行或任意结构体复用规则 */
export interface BatchItemLike {
  status: BatchItemStatus
}

export type BatchOutcome
  = | { type: 'empty' }
    | { type: 'in_progress', succeeded: number, failed: number, total: number }
    | { type: 'all_succeeded', succeeded: number, failed: number, total: number }
    | { type: 'all_failed', succeeded: number, failed: number, total: number }
    | { type: 'partial_failed', succeeded: number, failed: number, total: number }

/**
 * 对一批同质任务（如 Canvas 一个项目的全部 shots）做结果分类。
 *
 * 规则：
 *   - 空数组 → `empty`
 *   - 仍有 `pending` / `processing` → `in_progress`（尚未收口，不要误判为失败）
 *   - 全部 `succeeded` → `all_succeeded`
 *   - 全部 `failed` / `cancelled` → `all_failed`
 *   - 成功与失败/取消混合 → `partial_failed`
 *
 * `cancelled` 计入 failed count，便于 UI 和成本统计识别未完成项。
 * 不在此函数做项目状态字符串映射（如 'completed'/'partial_failed'），保持 outcome 层纯净。
 */
export function decideBatchOutcome(items: readonly BatchItemLike[]): BatchOutcome {
  const total = items.length
  if (total === 0)
    return { type: 'empty' }

  let succeeded = 0
  let failed = 0
  let inProgress = 0

  for (const item of items) {
    switch (item.status) {
      case 'succeeded':
        succeeded++
        break
      case 'failed':
      case 'cancelled':
        failed++
        break
      case 'pending':
      case 'processing':
      default:
        inProgress++
        break
    }
  }

  if (inProgress > 0)
    return { type: 'in_progress', succeeded, failed, total }

  if (succeeded === total)
    return { type: 'all_succeeded', succeeded, failed, total }

  if (failed === total)
    return { type: 'all_failed', succeeded, failed, total }

  return { type: 'partial_failed', succeeded, failed, total }
}

// ===== Pipeline command 规则 =====
// Canvas pipeline 的 command 决策（pause / resume / cancel / retry）纯规则。
// 只复用下层状态/阶段规则（isActivePipelineRun / isRetryablePipelineRun / isPauseBeforePhase），
// 不依赖 DB/provider/server/worker runtime。真正执行 command 的更高层 adapter 仍在 app 层。

/** Canvas pipeline 支持的 command 词汇（pause 待更高层 adapter 接入） */
export type WorkflowCommand = 'pause' | 'resume' | 'cancel' | 'retry'

/** command 判定的最小 run 形状 — status 必填，phase 可选（resume 用） */
export interface PipelineCommandRunLike {
  status: PipelineRunStatus
  phase?: CanvasPipelinePhase
}

/**
 * run 是否可取消。
 * 规则：只有活跃 run（pending / running）可取消；终态 run 不重复取消。
 */
export function canCancelPipelineRun(run: PipelineCommandRunLike): boolean {
  return isActivePipelineRun(run)
}

/**
 * run 是否可重试。
 * 规则：只有失败/取消（failed / cancelled）的 run 可重试；成功或活跃 run 不可重试。
 */
export function canRetryPipelineRun(run: PipelineCommandRunLike): boolean {
  return isRetryablePipelineRun(run)
}

/**
 * 是否允许从某阶段 resume。
 * 规则：只有 pause-before 阶段（storyboard / videos）是合法 resume 点 ——
 * 普通阶段由自动推进处理，不存在"暂停后继续"的语义。
 */
export function canResumeFromPhase(phase: CanvasPipelinePhase): boolean {
  return isPauseBeforePhase(phase)
}
