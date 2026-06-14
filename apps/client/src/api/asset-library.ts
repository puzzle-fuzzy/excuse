import type { AssetLibrarySource } from '@excuse/shared'
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
