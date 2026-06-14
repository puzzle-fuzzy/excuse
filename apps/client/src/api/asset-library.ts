import type { AssetLibrarySource, AssetTagDTO } from '@excuse/shared'
import type { AssetLibraryFilters } from '@/lib/asset-library'
import { fetchAssetLibrary } from '@/api/client'

/** 将页面筛选条件转换为 API query 参数 */
export function filtersToQueryParams(
  filters: AssetLibraryFilters,
  projectId: string | null,
  limit: number,
  offset: number,
) {
  return {
    source: filters.source !== 'all' ? filters.source as AssetLibrarySource : undefined,
    kind: filters.kind !== 'all' ? filters.kind : undefined,
    status: filters.status !== 'all' ? filters.status : undefined,
    search: filters.search.trim() || undefined,
    model: filters.model || undefined,
    createdFrom: filters.createdFrom || undefined,
    createdTo: filters.createdTo || undefined,
    sort: filters.sort,
    favorite: filters.favorite ? true : undefined,
    tagIds: filters.tagIds.length > 0 ? filters.tagIds.join(',') : undefined,
    projectId: projectId ?? undefined,
    limit,
    offset,
  }
}

/** React Query queryFn — 资产列表 */
export async function queryAssetLibrary({
  filters,
  projectId,
  limit,
  offset,
}: {
  filters: AssetLibraryFilters
  projectId: string | null
  limit: number
  offset: number
}) {
  return fetchAssetLibrary(filtersToQueryParams(filters, projectId, limit, offset))
}

/** 隐藏资产（从资产中心移除，不删除 DB 记录或存储文件） */
export async function hideAsset(
  source: AssetLibrarySource & ('generation_record' | 'canvas_asset'),
  id: string,
): Promise<void> {
  // Use fetch directly since Eden treaty path is complex for nested source/id/hide
  const baseUrl = '' // relative path works with Vite proxy
  const res = await fetch(`${baseUrl}/api/assets/${source}/${id}/hide`, {
    method: 'POST',
    credentials: 'include', // httpOnly cookie auth
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: '隐藏资产失败' }))
    throw new Error(body.error ?? `隐藏失败 (${res.status})`)
  }
}

/** Toggle favorite — POST 收藏 / DELETE 取消收藏，返回权威 isFavorite 状态 */
export async function toggleAssetFavorite(
  source: AssetLibrarySource,
  id: string,
  favorite: boolean,
): Promise<boolean> {
  const baseUrl = ''
  const res = await fetch(`${baseUrl}/api/assets/${source}/${id}/favorite`, {
    method: favorite ? 'POST' : 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: '收藏操作失败' }))
    throw new Error(body.error ?? `收藏失败 (${res.status})`)
  }
  const json = (await res.json()) as { data?: { isFavorite?: boolean } }
  return json.data?.isFavorite ?? favorite
}

// ── 标签 CRUD + assign/unassign ────────────────────────────────────────────
//
// 与 hideAsset / toggleAssetFavorite 一致用 fetch（避免 Eden treaty 嵌套路径问题）。

async function parseError(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => ({ error: fallback }))
  return new Error(body.error ?? `${fallback} (${res.status})`)
}

/** 列出当前用户全部标签（按 createdAt desc） */
export async function listAssetTags(): Promise<AssetTagDTO[]> {
  const res = await fetch('/api/asset-tags/', { credentials: 'include' })
  if (!res.ok)
    throw await parseError(res, '获取标签列表失败')
  const json = (await res.json()) as { items?: AssetTagDTO[] }
  return json.items ?? []
}

/** 创建标签（同账号重名 409） */
export async function createAssetTag(name: string): Promise<AssetTagDTO> {
  const res = await fetch('/api/asset-tags/', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok)
    throw await parseError(res, '创建标签失败')
  const json = (await res.json()) as { data: AssetTagDTO }
  return json.data
}

/** 删除标签（幂等，不存在返回 200；该标签下的 assignment 通过 ON DELETE CASCADE 级联删除） */
export async function deleteAssetTag(id: string): Promise<void> {
  const res = await fetch(`/api/asset-tags/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok)
    throw await parseError(res, '删除标签失败')
}

/** 给资产打标签（幂等；tagId 不存在或不属于当前用户时 404） */
export async function assignAssetTag(
  source: AssetLibrarySource,
  id: string,
  tagId: string,
): Promise<void> {
  const res = await fetch(`/api/assets/${source}/${id}/tags/${tagId}`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!res.ok)
    throw await parseError(res, '打标签失败')
}

/** 取消资产的标签（幂等） */
export async function unassignAssetTag(
  source: AssetLibrarySource,
  id: string,
  tagId: string,
): Promise<void> {
  const res = await fetch(`/api/assets/${source}/${id}/tags/${tagId}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok)
    throw await parseError(res, '取消标签失败')
}
