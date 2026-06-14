import type { UploadedFileInsert } from '../types'
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import { getDb } from '../db'
import { uploadedFiles } from '../schema'

/**
 * 创建上传文件记录
 */
export async function createUploadedFile(values: UploadedFileInsert) {
  const [record] = await getDb().insert(uploadedFiles).values(values).returning()
  return record!
}

/**
 * 按 ID 查询单条上传文件记录
 */
export async function getUploadedFileById(id: string) {
  const [record] = await getDb()
    .select()
    .from(uploadedFiles)
    .where(eq(uploadedFiles.id, id))
    .limit(1)
  return record ?? null
}

/**
 * 按 ID 列表批量查询上传文件记录
 */
export async function getUploadedFilesByIds(ids: string[]) {
  if (ids.length === 0)
    return []
  return getDb()
    .select()
    .from(uploadedFiles)
    .where(inArray(uploadedFiles.id, ids))
}

/**
 * 按 ID 列表批量查询属于指定用户的上传文件记录
 */
export async function getUploadedFilesByIdsForAccount(ids: string[], accountId: string) {
  if (ids.length === 0)
    return []
  return getDb()
    .select()
    .from(uploadedFiles)
    .where(and(inArray(uploadedFiles.id, ids), eq(uploadedFiles.accountId, accountId)))
}

/**
 * 资产中心 — 按 account 查询上传文件列表（分页，createdAt desc）
 *
 * 用于 `/api/assets` 统一资产中心。按 accountId 隔离权限。
 * 上传文件无 model 列，因此只支持 createdFrom/createdTo 时间范围过滤（按模型筛选时
 * 路由层直接跳过 uploaded_files，不会走到这里）。
 */
export async function listUploadedFilesForAccount(
  accountId: string,
  filter: { createdFrom?: Date, createdTo?: Date, limit?: number, offset?: number } = {},
) {
  const { createdFrom, createdTo, limit = 100, offset = 0 } = filter
  const conditions = [eq(uploadedFiles.accountId, accountId)]
  if (createdFrom)
    conditions.push(gte(uploadedFiles.createdAt, createdFrom))
  if (createdTo)
    conditions.push(lte(uploadedFiles.createdAt, createdTo))
  return getDb()
    .select()
    .from(uploadedFiles)
    .where(and(...conditions))
    .orderBy(desc(uploadedFiles.createdAt))
    .limit(limit)
    .offset(offset)
}

/** 按 ID 删除单个上传文件记录 */
export async function deleteUploadedFileById(id: string) {
  await getDb().delete(uploadedFiles).where(eq(uploadedFiles.id, id))
}
