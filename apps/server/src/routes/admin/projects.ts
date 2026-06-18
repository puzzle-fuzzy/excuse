import type { AdminProjectItem, AdminProjectListResponse } from '@excuse/shared'
import { listAdminProjects } from '@excuse/db'

export async function handleListProjects(query: {
  search?: string
  status?: string
  isDeleted?: boolean
  limit?: number
  offset?: number
}): Promise<AdminProjectListResponse> {
  const result = await listAdminProjects({
    search: query.search,
    status: query.status,
    isDeleted: query.isDeleted,
    limit: query.limit,
    offset: query.offset,
  })
  const items: AdminProjectItem[] = result.items.map((row) => {
    const prefs = row.modelPreferencesJson as Record<string, string> | null
    const parts: string[] = []
    if (prefs?.textModel)
      parts.push(`文本:${prefs.textModel}`)
    if (prefs?.imageModel)
      parts.push(`图片:${prefs.imageModel}`)
    if (prefs?.videoModel)
      parts.push(`视频:${prefs.videoModel}`)
    return {
      id: row.id,
      accountId: row.accountId,
      username: row.username,
      title: row.title ?? '',
      status: row.status,
      shotCount: row.shotCount,
      completedShotCount: row.completedShotCount,
      modelSummary: parts.join(' ') || '默认',
      isDeleted: row.isDeleted,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt?.toISOString() ?? null,
    }
  })
  return { success: true, items, total: result.total }
}
