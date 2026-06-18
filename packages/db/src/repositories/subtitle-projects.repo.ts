import type { SubtitleProjectInsert, SubtitleProjectRow } from '../types'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { getDb } from '../db'
import { subtitleProjects } from '../schema'

/** 创建字幕项目 */
export async function createSubtitleProject(values: SubtitleProjectInsert) {
  const [record] = await getDb().insert(subtitleProjects).values(values).returning()
  return record!
}

/** 按 ID 查询字幕项目 */
export async function getSubtitleProjectById(id: string) {
  const [record] = await getDb()
    .select()
    .from(subtitleProjects)
    .where(eq(subtitleProjects.id, id))
    .limit(1)
  return record ?? null
}

/** 按 ID + accountId 查询字幕项目（权限校验） */
export async function getSubtitleProjectForAccount(id: string, accountId: string) {
  const [record] = await getDb()
    .select()
    .from(subtitleProjects)
    .where(eq(subtitleProjects.id, id))
    .limit(1)
  if (!record || record.accountId !== accountId)
    return null
  return record
}

/** 列出用户的所有字幕项目（按创建时间倒序） */
export async function listSubtitleProjectsByAccount(accountId: string) {
  return getDb()
    .select()
    .from(subtitleProjects)
    .where(eq(subtitleProjects.accountId, accountId))
    .orderBy(desc(subtitleProjects.createdAt))
}

/** 更新字幕项目状态 */
export async function updateSubtitleProjectStatus(id: string, status: SubtitleProjectRow['status'], extra?: Partial<{ audioFileUrl: string, videoDurationMs: number, asrRecordId: string, errorMessage: string | null }>) {
  const updateData: Partial<typeof subtitleProjects.$inferInsert> = {
    status,
    updatedAt: new Date(),
  }
  if (extra) {
    if (extra.audioFileUrl !== undefined)
      updateData.audioFileUrl = extra.audioFileUrl
    if (extra.videoDurationMs !== undefined)
      updateData.videoDurationMs = extra.videoDurationMs
    if (extra.asrRecordId !== undefined)
      updateData.asrRecordId = extra.asrRecordId
    if (extra.errorMessage !== undefined)
      updateData.errorMessage = extra.errorMessage ?? null
  }
  await getDb()
    .update(subtitleProjects)
    .set(updateData)
    .where(eq(subtitleProjects.id, id))
}

/** 更新字幕句子列表（ASR 完成后或用户编辑后） */
export async function updateSubtitleSentences(id: string, sentences: SubtitleProjectRow['sentences'], rawTranscription?: SubtitleProjectRow['rawTranscription']) {
  const updateData: Partial<typeof subtitleProjects.$inferInsert> = {
    sentences,
    updatedAt: new Date(),
  }
  if (rawTranscription !== undefined)
    updateData.rawTranscription = rawTranscription
  await getDb()
    .update(subtitleProjects)
    .set(updateData)
    .where(eq(subtitleProjects.id, id))
}

/** 更新字幕样式配置 */
export async function updateSubtitleStyle(id: string, styleConfig: SubtitleProjectRow['styleConfig']) {
  await getDb()
    .update(subtitleProjects)
    .set({ styleConfig, updatedAt: new Date() })
    .where(eq(subtitleProjects.id, id))
}

/** 更新导出信息 */
export async function updateSubtitleExport(id: string, exportRecordId: string, exportedVideoUrl?: string) {
  const updateData: Partial<typeof subtitleProjects.$inferInsert> = {
    exportRecordId,
    updatedAt: new Date(),
  }
  if (exportedVideoUrl !== undefined)
    updateData.exportedVideoUrl = exportedVideoUrl
  await getDb()
    .update(subtitleProjects)
    .set(updateData)
    .where(eq(subtitleProjects.id, id))
}

/** 删除字幕项目 */
export async function deleteSubtitleProject(id: string) {
  await getDb().delete(subtitleProjects).where(eq(subtitleProjects.id, id))
}

/** 轮询所有需要处理的 ASR 字幕项目（Worker 专用） */
export async function pollPendingASRProjects(workerId = 'test-worker', claimTtlMs = 30_000, limit = 50) {
  const claimedIds = await claimPendingASRProjectIds(workerId, claimTtlMs, limit)
  if (claimedIds.length === 0)
    return []

  return getDb()
    .select()
    .from(subtitleProjects)
    .where(inArray(subtitleProjects.id, claimedIds))
}

async function claimPendingASRProjectIds(workerId: string, claimTtlMs: number, limit: number): Promise<string[]> {
  const result = await getDb().execute(sql`
    UPDATE subtitle_projects
    SET locked_by = ${workerId},
        locked_until = now() + (${claimTtlMs} || ' milliseconds')::interval
    WHERE id IN (
      SELECT id FROM subtitle_projects
      WHERE status = 'asr_processing'
        AND (locked_until IS NULL OR locked_until < now())
        AND (next_poll_at IS NULL OR next_poll_at <= now())
      ORDER BY updated_at ASC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    RETURNING id
  `)
  const rows = result as unknown as Array<{ id: string }>
  return rows.map(row => row.id)
}

/** 释放遗留 ASR 轮询 claim 锁；只释放当前 worker 自己持有的 active 行。 */
export async function releaseASRProjectClaims(ids: string[], workerId: string) {
  if (ids.length === 0)
    return

  await getDb()
    .update(subtitleProjects)
    .set({ lockedBy: '', lockedUntil: null })
    .where(and(
      inArray(subtitleProjects.id, ids),
      eq(subtitleProjects.lockedBy, workerId),
      eq(subtitleProjects.status, 'asr_processing'),
    ))
}

/** 遗留 ASR provider FAILED 后重新排队轮询，不进入终态 failed。 */
export async function scheduleASRProjectProviderRetry(id: string, errorMessage: string, nextPollAt: Date) {
  await getDb()
    .update(subtitleProjects)
    .set({
      status: 'asr_processing',
      errorMessage,
      providerFailureCount: sql`${subtitleProjects.providerFailureCount} + 1`,
      nextPollAt,
      lockedBy: '',
      lockedUntil: null,
    })
    .where(eq(subtitleProjects.id, id))
}
