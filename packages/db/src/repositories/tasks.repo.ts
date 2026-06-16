import type { TaskErrorInfo, TaskOutput } from '../domain-types'
import type { TaskInsert, TaskRow } from '../types'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { getDb, pgClient } from '../db'
import { tasks } from '../schema/tasks'

// ===== 列名映射工具 =====
// `db.execute(rawSql)` 返回原始 PostgreSQL 行，列名为 snake_case，
// 而 Drizzle 的 TaskRow 期望 camelCase。此映射解决类型安全缺口。
import { getTableColumns } from 'drizzle-orm'

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
  const [updated] = await getDb()
    .update(tasks)
    .set({
      status: 'failed',
      finishedAt: new Date(),
      ...(errorInfo && { errorJson: errorInfo }),
      ...(errorMessage && { errorMessage }),
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
  })
  await pgClient.notify('task_status_changed', payload)
}
