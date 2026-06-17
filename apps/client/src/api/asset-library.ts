import type { AssetLibrarySource } from '@excuse/shared'
import type { AssetLibraryFilters } from '@/lib/asset-library'
import {
  assignTagToAsset,
  createAssetTag as createAssetTagClient,
  deleteAssetTag as deleteAssetTagClient,
  fetchAssetLibrary,
  hideAsset as hideAssetClient,
  listAssetTags as listAssetTagsClient,
  toggleFavoriteAsset,
  unassignTagFromAsset,
} from '@/api/client'

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

// ── 所有 fetch() 调用已替换为 Eden treaty ──────────────────────────────
//
// 参见 TODO2 §3.4：10 处手写 fetch 全部收敛为 Eden treaty + unwrapEden，
// 保持原函数签名以兼容调用方（Assets.tsx、SubjectLibrary.tsx 等）。

/** 隐藏资产（从资产中心移除，不删除 DB 记录或存储文件） */
export const hideAsset = hideAssetClient

/** Toggle favorite — POST 收藏 / DELETE 取消收藏，返回权威 isFavorite 状态 */
export const toggleAssetFavorite = toggleFavoriteAsset

/** 列出当前用户全部标签（按 createdAt desc） */
export const listAssetTags = listAssetTagsClient

/** 创建标签（同账号重名 409） */
export const createAssetTag = createAssetTagClient

/** 删除标签（幂等，不存在返回 200） */
export const deleteAssetTag = deleteAssetTagClient

/** 给资产打标签（幂等；tagId 不存在或不属于当前用户时 404） */
export const assignAssetTag = assignTagToAsset

/** 取消资产的标签（幂等） */
export const unassignAssetTag = unassignTagFromAsset
