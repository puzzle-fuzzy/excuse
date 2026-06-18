import type { SubtitleProjectInsert, SubtitleProjectRow } from '../types'
import { desc, eq } from 'drizzle-orm'
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
export async function pollPendingASRProjects() {
  return getDb()
    .select()
    .from(subtitleProjects)
    .where(eq(subtitleProjects.status, 'asr_processing'))
    .limit(50)
}
