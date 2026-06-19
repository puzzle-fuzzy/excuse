import type { TaskErrorInfo, TaskOutput } from '../domain-types'
import type { TaskInsert, TaskRow } from '../types'
import type { UserTaskDTO, UserTaskDomain, UserTaskListQuery, UserTaskStatus } from '@excuse/shared'
import { sanitizeErrorMessage } from '@excuse/shared'
import { and, desc, eq, getTableColumns, inArray, sql } from 'drizzle-orm'
import { getDb, pgClient } from '../db'

import { generationRecords } from '../schema/generation-records'
import { tasks } from '../schema/tasks'

// 构建反向映射：snake_case 列名 → camelCase 属性名
function buildSnakeToCamelMap() {
  const cols = getTableColumns(tasks)
  const map = new Map<string, string>()
  for (const [camelKey, info] of Object.entries(cols)) {
    map.set(info.name, camelKey)
  }
  return map
}
const SNAKE_TO_CAMEL = buildSnakeToCamelMap()

function mapRowToTaskRow(row: Record<string, unknown>): TaskRow {
  const mapped: Record<string, unknown> = {}
  for (const [snakeKey, val] of Object.entries(row)) {
    mapped[SNAKE_TO_CAMEL.get(snakeKey) ?? snakeKey] = val
  }
  return mapped as TaskRow
}

// ===== CRUD =====

/** 创建任务 — insert + returning */
export async function createTask(values: TaskInsert) {
  const [task] = await getDb().insert(tasks).values(values).returning()
  return task!
}

/** 按 ID 查询单条任务 */
export async function getTaskById(id: string) {
  const [task] = await getDb()
    .select()
    .from(tasks)
    .where(eq(tasks.id, id))
    .limit(1)
  return task ?? null
}

/** 按 project 查 canvas 任务 */
export async function listTasksByProject(projectId: string) {
  return getDb()
    .select()
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .orderBy(desc(tasks.createdAt))
}

const USER_TASK_STATUSES: UserTaskStatus[] = ['queued', 'running', 'retrying', 'succeeded', 'failed', 'cancelled']
const USER_TASK_DOMAINS: UserTaskDomain[] = ['generate', 'canvas', 'subtitle', 'gateway']

function iso(value: Date | string | null | undefined): string | null {
  if (!value)
    return null
  return value instanceof Date ? value.toISOString() : value
}

function isUserTaskStatus(value: string | undefined): value is UserTaskStatus {
  return USER_TASK_STATUSES.includes(value as UserTaskStatus)
}

function isUserTaskDomain(value: string | undefined): value is UserTaskDomain {
  return USER_TASK_DOMAINS.includes(value as UserTaskDomain)
}

function mapGenerationStatus(status: string): UserTaskStatus {
  switch (status) {
    case 'pending':
      return 'queued'
    case 'submitting':
    case 'processing':
    case 'saving_output':
      return 'running'
    case 'succeeded':
    case 'failed':
    case 'cancelled':
      return status
    default:
      return 'running'
  }
}

function mapTaskDomain(domain: string): UserTaskDomain {
  return isUserTaskDomain(domain) ? domain : 'generate'
}

function generationStatusesFor(status: UserTaskStatus | undefined): Array<typeof generationRecords.$inferSelect.status> | undefined {
  switch (status) {
    case 'queued':
      return ['pending']
    case 'running':
      return ['submitting', 'processing', 'saving_output']
    case 'succeeded':
      return ['succeeded']
    case 'failed':
      return ['failed']
    case 'cancelled':
      return ['cancelled']
    default:
      return undefined
  }
}

function generationCategoriesFor(domain: UserTaskDomain | undefined): Array<typeof generationRecords.$inferSelect.category> | undefined {
  switch (domain) {
    case 'generate':
      return ['text', 'image', 'video']
    case 'subtitle':
      return ['subtitle']
    default:
      return undefined
  }
}

function taskTitle(domain: string, type: string): string {
  if (domain === 'canvas')
    return `Canvas ${type.replace(/^canvas\./, '')}`
  if (domain === 'subtitle')
    return '字幕处理任务'
  if (domain === 'gateway')
    return 'API 调用任务'
  return '生成任务'
}

function generationTitle(category: string, model: string): string {
  const categoryLabel: Record<string, string> = {
    text: '文本生成',
    image: '图片生成',
    video: '视频生成',
    subtitle: '字幕生成',
  }
  return `${categoryLabel[category] ?? '生成任务'} · ${model}`
}

function userError(message: string | null, status: UserTaskStatus): UserTaskDTO['error'] {
  if (!message)
    return null
  return {
    code: status === 'cancelled' ? 'task_cancelled' : 'task_failed',
    message,
    retryable: status === 'failed',
    nextAction: status === 'failed' ? 'retry' : 'none',
  }
}

function serializeTaskForUser(row: TaskRow): UserTaskDTO {
  const status = isUserTaskStatus(row.status) ? row.status : 'running'
  const domain = mapTaskDomain(row.domain)
  const projectHref = row.projectId ? `/canvas/${row.projectId}` : null
  return {
    id: row.id,
    source: 'task',
    domain,
    type: row.type,
    status,
    title: taskTitle(row.domain, row.type),
    description: row.errorMessage ?? `${row.domain} / ${row.type}`,
    progress: status === 'succeeded' ? 100 : null,
    currentStep: row.type,
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
    finishedAt: iso(row.finishedAt),
    canRetry: status === 'failed' || status === 'retrying',
    canCancel: status === 'queued' || status === 'running' || status === 'retrying',
    billing: {
      estimatedCents: null,
      reservedCents: null,
      actualCents: null,
      status: 'none',
    },
    target: row.projectId
      ? { type: 'project', id: row.projectId, href: projectHref! }
      : row.generationRecordId
        ? { type: 'generation_record', id: row.generationRecordId, href: `/records/${row.generationRecordId}` }
        : null,
    error: userError(row.errorMessage, status),
  }
}

function serializeGenerationForUser(row: typeof generationRecords.$inferSelect): UserTaskDTO {
  const status = mapGenerationStatus(row.status)
  const actualCents = row.totalPriceCents == null ? null : Math.round(Number(row.totalPriceCents))
  return {
    id: row.id,
    source: 'generation_record',
    domain: row.category === 'subtitle' ? 'subtitle' : 'generate',
    type: row.category,
    status,
    title: generationTitle(row.category, row.model),
    description: row.errorMessage ?? `使用 ${row.model} 创建 ${row.category} 内容`,
    progress: status === 'succeeded' ? 100 : null,
    currentStep: status === 'running' ? row.status : null,
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
    finishedAt: status === 'succeeded' || status === 'failed' || status === 'cancelled' ? iso(row.updatedAt) : null,
    canRetry: status === 'failed' || status === 'cancelled',
    canCancel: status === 'queued' || status === 'running',
    billing: {
      estimatedCents: actualCents,
      reservedCents: null,
      actualCents,
      status: actualCents == null ? 'none' : status === 'succeeded' ? 'debited' : 'estimated',
    },
    target: { type: 'generation_record', id: row.id, href: `/records/${row.id}` },
    error: userError(row.errorMessage, status),
  }
}

export async function listUserTasks(accountId: string, query: UserTaskListQuery = {}): Promise<{ items: UserTaskDTO[], total: number }> {
  const limit = Math.min(Math.max(query.limit ?? 40, 1), 100)
  const offset = Math.max(query.offset ?? 0, 0)
  const candidateLimit = Math.min(limit + offset + 100, 300)
  const taskDomain = isUserTaskDomain(query.domain) ? query.domain : undefined
  const taskStatus = isUserTaskStatus(query.status) ? query.status : undefined
  const generationStatuses = generationStatusesFor(taskStatus)
  const generationCategories = generationCategoriesFor(taskDomain)

  const [taskRows, generationRows, taskTotalRows, generationTotalRows] = await Promise.all([
    getDb()
      .select()
      .from(tasks)
      .where(and(
        eq(tasks.accountId, accountId),
        taskDomain ? eq(tasks.domain, taskDomain) : undefined,
        taskStatus ? eq(tasks.status, taskStatus) : undefined,
      ))
      .orderBy(desc(tasks.updatedAt))
      .limit(candidateLimit),
    getDb()
      .select()
      .from(generationRecords)
      .where(and(
        eq(generationRecords.accountId, accountId),
        generationStatuses ? inArray(generationRecords.status, generationStatuses) : undefined,
        generationCategories ? inArray(generationRecords.category, generationCategories) : undefined,
      ))
      .orderBy(desc(generationRecords.updatedAt))
      .limit(candidateLimit),
    getDb()
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(
        eq(tasks.accountId, accountId),
        taskDomain ? eq(tasks.domain, taskDomain) : undefined,
        taskStatus ? eq(tasks.status, taskStatus) : undefined,
      )),
    getDb()
      .select({ count: sql<number>`count(*)::int` })
      .from(generationRecords)
      .where(and(
        eq(generationRecords.accountId, accountId),
        generationStatuses ? inArray(generationRecords.status, generationStatuses) : undefined,
        generationCategories ? inArray(generationRecords.category, generationCategories) : undefined,
      )),
  ])

  const linkedGenerationIds = new Set(taskRows.map(task => task.generationRecordId).filter(Boolean))
  const items = [
    ...taskRows.map(serializeTaskForUser),
    ...generationRows
      .filter(record => !linkedGenerationIds.has(record.id))
      .map(serializeGenerationForUser),
  ]
    .filter(item => !query.domain || item.domain === query.domain)
    .filter(item => !query.status || item.status === query.status)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))

  return {
    items: items.slice(offset, offset + limit),
    total: Number(taskTotalRows[0]?.count ?? 0) + Number(generationTotalRows[0]?.count ?? 0),
  }
}

export async function getUserTaskById(accountId: string, id: string): Promise<UserTaskDTO | null> {
  const task = await getTaskById(id)
  if (task?.accountId === accountId)
    return serializeTaskForUser(task)

  const [record] = await getDb()
    .select()
    .from(generationRecords)
    .where(and(eq(generationRecords.id, id), eq(generationRecords.accountId, accountId)))
    .limit(1)
  return record ? serializeGenerationForUser(record) : null
}

/** 并发守卫：查找同一项目同一类型中 queued/running/retrying 的任务，防止重复提交 */
export async function findActiveTaskForType(projectId: string, type: string) {
  const [task] = await getDb()
    .select()
    .from(tasks)
    .where(and(
      eq(tasks.projectId, projectId),
      eq(tasks.type, type),
      inArray(tasks.status, ['queued', 'running', 'retrying']),
    ))
    .limit(1)
  return task ?? null
}

// ===== Claim / Lock =====

/**
 * 原子 claim 下一个可执行任务 — FOR UPDATE SKIP LOCKED
 *
 * 参考 puzzle-bobble/apps/worker/src/index.ts 的 claimNextTask()
 * 多个 Worker 可并发调用，不会 race：SKIP LOCKED 跳过已被其他 Worker 锁定的行
 *
 * @param workerId Worker 标识（如 'worker-1'）
 * @param claimTtlMs claim 锁定时长（毫秒），如 30_000（30 秒）
 * @returns 被 claim 的 task，或 null（无 eligible task）
 */
export async function claimNextTask(workerId: string, claimTtlMs: number): Promise<TaskRow | null> {
  const result = await getDb().execute(sql`
    UPDATE tasks
    SET status = 'running',
        locked_by = ${workerId},
        locked_until = now() + (${claimTtlMs} || ' milliseconds')::interval,
        attempts = attempts + 1,
        started_at = COALESCE(started_at, now()),
        updated_at = now()
    WHERE id = (
      SELECT id FROM tasks
      WHERE status IN ('queued', 'retrying')
        AND next_run_at <= now()
        AND (locked_until IS NULL OR locked_until < now())
      ORDER BY priority ASC, next_run_at ASC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *
  `)

  // Drizzle execute(rawSql) 返回原始 PostgreSQL 行，列名为 snake_case。
  // mapRowToTaskRow 将 snake_case 列名转为 camelCase 属性名（与 TaskRow 类型一致）。
  const rawRows = result as unknown as Array<Record<string, unknown>>
  return rawRows.length > 0 ? mapRowToTaskRow(rawRows[0]!) : null
}

/**
 * 延长任务锁定时间 — heartbeat 定期调用
 *
 * Worker 在执行长任务期间定期调用，防止 lockedUntil 过期导致任务被其他 Worker claim
 * @param id 任务 ID
 * @param workerId Worker 标识（必须与 claim 时的 lockedBy 一致）
 * @param claimTtlMs 新的锁定时长（毫秒）
 */
export async function extendTaskLock(id: string, workerId: string, claimTtlMs: number) {
  const [updated] = await getDb()
    .update(tasks)
    .set({
      lockedUntil: sql`now() + (${claimTtlMs} || ' milliseconds')::interval`,
      updatedAt: new Date(),
    })
    .where(and(eq(tasks.id, id), eq(tasks.lockedBy, workerId), eq(tasks.status, 'running')))
    .returning()
  return updated ?? null
}

/** 释放任务锁 — 清除 lockedBy/lockedUntil（取消时使用） */
export async function releaseTaskLock(id: string) {
  await getDb()
    .update(tasks)
    .set({
      lockedBy: '',
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, id))
}

// ===== 状态转换 =====

/**
 * Mark task as succeeded — append-only guard：只在 status='running' 时生效
 * @param id 任务 ID
 * @param output 任务输出结果（可选）
 */
export async function markTaskSucceeded(id: string, output?: TaskOutput) {
  const [updated] = await getDb()
    .update(tasks)
    .set({
      status: 'succeeded',
      finishedAt: new Date(),
      ...(output && { output }),
      updatedAt: new Date(),
    })
    .where(and(eq(tasks.id, id), eq(tasks.status, 'running')))
    .returning()
  return updated ?? null
}

/**
 * Mark task as failed — 区分 retriable vs permanent
 *
 * 如果 errorJson.retriable=true 且 attempts < maxAttempts：
 *   Worker 应调用 markTaskRetrying() 设置 nextRunAt + status='retrying'
 * 如果不可重试或超过 maxAttempts：
 *   直接调用本函数设 status='failed'
 *
 * @param id 任务 ID
 * @param errorInfo 结构化错误信息（可选）
 * @param errorMessage 简短错误描述
 */
export async function markTaskFailed(id: string, errorInfo?: TaskErrorInfo, errorMessage?: string) {
  const sanitized = errorMessage ? sanitizeErrorMessage(errorMessage) : undefined
  const [updated] = await getDb()
    .update(tasks)
    .set({
      status: 'failed',
      finishedAt: new Date(),
      ...(errorInfo && { errorJson: errorInfo }),
      ...(sanitized && { errorMessage: sanitized }),
      updatedAt: new Date(),
    })
    .where(and(eq(tasks.id, id), eq(tasks.status, 'running')))
    .returning()
  return updated ?? null
}

/**
 * Mark task as retrying — 设置 nextRunAt 推迟下次 claim
 *
 * Worker 判断 retriable 且 attempts < maxAttempts 时调用，
 * 任务进入 'retrying' 状态，等待 nextRunAt 时间后由 claimNextTask 重新 claim
 *
 * @param id 任务 ID
 * @param nextRunAt 下次可执行时间
 */
export async function markTaskRetrying(id: string, nextRunAt: Date) {
  const [updated] = await getDb()
    .update(tasks)
    .set({
      status: 'retrying',
      nextRunAt,
      finishedAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(tasks.id, id), eq(tasks.status, 'running')))
    .returning()
  return updated ?? null
}

/** Mark task as cancelled — 只在 queued/running 状态时生效 */
export async function cancelTask(id: string) {
  const [updated] = await getDb()
    .update(tasks)
    .set({
      status: 'cancelled',
      finishedAt: new Date(),
      lockedBy: '',
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(and(eq(tasks.id, id), inArray(tasks.status, ['queued', 'running'])))
    .returning()
  return updated ?? null
}

// ===== Orphan Sweep =====

/**
 * 恢复孤儿任务 — 找到 lock 过期 timeoutMinutes 分钟以上的 running 任务，恢复为 queued
 *
 * 参考 puzzle-bobble/apps/worker/src/index.ts 的 sweepOrphanTasks()
 * attempts 减 1（GREATEST(attempts-1, 0)）确保 crash 的那次 attempt 不计入 retry 预算
 *
 * @param timeoutMinutes 锁过期多久才视为孤儿（默认 5 分钟）
 * @returns 恢复的任务数量
 */
export async function sweepOrphanTasks(timeoutMinutes = 5): Promise<number> {
  const result = await getDb().execute(sql`
    UPDATE tasks
    SET status = 'queued',
        locked_by = '',
        locked_until = NULL,
        attempts = GREATEST(attempts - 1, 0),
        updated_at = now()
    WHERE status = 'running'
      AND locked_until < now() - (${timeoutMinutes} || ' minutes')::interval
  `)
  // RowList has .count property from postgres.js ResultQueryMeta
  return (result as unknown as { count: number }).count
}

// ===== Reconcile =====

/** 漂移对：task 与关联 pipeline run 状态不一致 */
export interface DriftedTaskRunPair {
  taskId: string
  taskStatus: string
  runId: string
  projectId: string | null
  phase: string | null
}

/**
 * 查找 task 与关联 canvas_pipeline_runs 状态漂移的对。
 *
 * task 已终态（succeeded/failed/cancelled）但 run 仍为 running → 视为漂移。
 * 典型场景：Worker 在 markRunSucceeded 与 completeTask 之间崩溃，
 * task 已 succeed 但 run 仍 running。
 *
 * 每轮 poll 周期末尾调用一次，频率低、开销可控。
 */
export async function findDriftedTaskRunPairs(): Promise<DriftedTaskRunPair[]> {
  const result = await getDb().execute(sql`
    SELECT
      t.id AS "taskId",
      t.status AS "taskStatus",
      r.id AS "runId",
      r.project_id AS "projectId",
      r.phase AS "phase"
    FROM tasks t
    JOIN canvas_pipeline_runs r ON r.task_id = t.id
    WHERE t.status IN ('succeeded', 'failed', 'cancelled')
      AND r.status = 'running'
  `)

  const rows = result as unknown as Array<Record<string, unknown>>
  return rows.map(row => ({
    taskId: String(row.taskId ?? ''),
    taskStatus: String(row.taskStatus ?? ''),
    runId: String(row.runId ?? ''),
    projectId: row.projectId ? String(row.projectId) : null,
    phase: row.phase ? String(row.phase) : null,
  }))
}

// ===== Notify =====

/**
 * 任务状态变化后发送 PostgreSQL NOTIFY
 *
 * 参考 puzzle-bobble 的三层模型：Worker 写 DB → NOTIFY → Server LISTEN → SSE → 前端
 * 与现有 generation_records notify 模式一致，channel 名为 'task_status_changed'
 */
export async function notifyTaskStatusChange(task: TaskRow) {
  const payload = JSON.stringify({
    taskId: task.id,
    accountId: task.accountId,
    status: task.status,
    domain: task.domain,
    type: task.type,
    projectId: task.projectId,
    targetType: task.targetType,
    targetId: task.targetId,
    errorMessage: task.errorMessage,
    traceId: task.traceId,
  })
  await pgClient.notify('task_status_changed', payload)
}
