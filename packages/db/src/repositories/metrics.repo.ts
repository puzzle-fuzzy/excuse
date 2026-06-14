import { sql } from 'drizzle-orm'
import { getDb } from '../db'
import { canvasPipelineRuns, tasks } from '../schema'

export interface CanvasPhaseStatRow {
  phase: string
  status: string
  count: number
  durationP50Ms: number
  durationP95Ms: number
  durationAvgMs: number
}

export interface TaskQueueStatRow {
  domain: string
  status: string
  count: number
}

export async function getCanvasPhaseStats(windowHours = 24): Promise<CanvasPhaseStatRow[]> {
  const db = getDb()
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000)

  const rows = await db
    .select({
      phase: canvasPipelineRuns.phase,
      status: canvasPipelineRuns.status,
      count: sql<number>`count(*)::int`,
      durationP50Ms: sql<number>`coalesce(percentile_cont(0.5) within group (order by extract(epoch from (${canvasPipelineRuns.finishedAt} - ${canvasPipelineRuns.startedAt})) * 1000), 0)::float8`,
      durationP95Ms: sql<number>`coalesce(percentile_cont(0.95) within group (order by extract(epoch from (${canvasPipelineRuns.finishedAt} - ${canvasPipelineRuns.startedAt})) * 1000), 0)::float8`,
      durationAvgMs: sql<number>`coalesce(avg(extract(epoch from (${canvasPipelineRuns.finishedAt} - ${canvasPipelineRuns.startedAt})) * 1000), 0)::float8`,
    })
    .from(canvasPipelineRuns)
    .where(
      sql`${canvasPipelineRuns.finishedAt} IS NOT NULL AND ${canvasPipelineRuns.startedAt} IS NOT NULL AND ${canvasPipelineRuns.finishedAt} > ${cutoff.toISOString()}`,
    )
    .groupBy(canvasPipelineRuns.phase, canvasPipelineRuns.status)

  return rows.map(row => ({
    phase: String(row.phase),
    status: String(row.status),
    count: Number(row.count),
    durationP50Ms: Number(row.durationP50Ms),
    durationP95Ms: Number(row.durationP95Ms),
    durationAvgMs: Number(row.durationAvgMs),
  }))
}

export async function getTaskQueueStats(): Promise<TaskQueueStatRow[]> {
  const db = getDb()

  const rows = await db
    .select({
      domain: tasks.domain,
      status: tasks.status,
      count: sql<number>`count(*)::int`,
    })
    .from(tasks)
    .groupBy(tasks.domain, tasks.status)

  return rows.map(row => ({
    domain: String(row.domain),
    status: String(row.status),
    count: Number(row.count),
  }))
}
