import type { AssetLibraryListResponse, AssetLibraryQuery, AssetTagCreateResponse, AssetTagDTO, AssetTagListResponse } from '@excuse/shared'
import { api, unwrapEden } from './client'

// ===== 资产中心 API =====

/** 拉取统一资产列表（generation_records + canvas_assets + uploaded_files） */
export async function fetchAssetLibrary(params?: AssetLibraryQuery): Promise<AssetLibraryListResponse> {
  return unwrapEden<AssetLibraryListResponse>(
    await api.api.assets.get({
      query: {
        source: params?.source || undefined,
        kind: params?.kind || undefined,
        status: params?.status || undefined,
        projectId: params?.projectId || undefined,
        search: params?.search || undefined,
        model: params?.model || undefined,
        createdFrom: params?.createdFrom || undefined,
        createdTo: params?.createdTo || undefined,
        limit: params?.limit ?? 100,
        offset: params?.offset ?? 0,
      },
    }),
  )
}

// ===== 资产隐藏 / 收藏 / 标签 =====

/** 隐藏资产（从资产中心移除，不删除 DB 记录或存储文件） */
export async function hideAsset(source: string, id: string): Promise<void> {
  await unwrapEden(await api.api.assets({ source })({ id }).hide.post())
}

/** Toggle favorite — POST 收藏 / DELETE 取消收藏，返回权威 isFavorite 状态 */
export async function toggleFavoriteAsset(source: string, id: string, favorite: boolean): Promise<boolean> {
  const res = favorite
    ? await unwrapEden<{ data?: { isFavorite?: boolean } }>(await api.api.assets({ source })({ id }).favorite.post())
    : await unwrapEden<{ data?: { isFavorite?: boolean } }>(await api.api.assets({ source })({ id }).favorite.delete())
  return res.data?.isFavorite ?? favorite
}

/** 给资产打标签（幂等；tagId 不存在或不属于当前用户时 404） */
export async function assignTagToAsset(source: string, id: string, tagId: string): Promise<void> {
  await unwrapEden(await api.api.assets({ source })({ id }).tags({ tagId }).post())
}

/** 取消资产的标签（幂等） */
export async function unassignTagFromAsset(source: string, id: string, tagId: string): Promise<void> {
  await unwrapEden(await api.api.assets({ source })({ id }).tags({ tagId }).delete())
}

// ===== 资产标签 CRUD =====

/** 列出当前用户全部标签（按 createdAt desc） */
export async function listAssetTags(): Promise<AssetTagDTO[]> {
  const res = await unwrapEden<AssetTagListResponse>(await api.api['asset-tags'].get())
  return res.items
}

/** 创建标签（同账号重名 409） */
export async function createAssetTag(name: string): Promise<AssetTagDTO> {
  const res = await unwrapEden<AssetTagCreateResponse>(await api.api['asset-tags'].post({ name }))
  return res.data
}

/** 删除标签（幂等，不存在返回 200） */
export async function deleteAssetTag(id: string): Promise<void> {
  await unwrapEden(await api.api['asset-tags']({ id }).delete())
}

// ===== 主体资产库 API =====

/** 主体资产行（API 返回形状） */
export interface SubjectRow {
  id: string
  subjectType: string
  name: string
  referenceImageUrl: string | null
  tags: string[] | null
  isFavorite: boolean
  usageCount: number
  createdAt: string
  updatedAt: string
  identityPrompt: string | null
  scenePrompt: string | null
}

/** 列出主体资产（支持搜索/类型/收藏筛选） */
export async function listSubjects(params: {
  subjectType?: string
  search?: string
  limit?: number
  offset?: number
}): Promise<{ success: boolean, items: SubjectRow[], total: number }> {
  return unwrapEden(await api.api.subjects.get({ query: params as Record<string, string | number | undefined> }))
}

/** 删除主体资产 */
export async function deleteSubject(id: string): Promise<{ success: boolean }> {
  return unwrapEden(await api.api.subjects({ id }).delete())
}

/** 切换主体收藏状态 */
export async function toggleSubjectFavorite(id: string): Promise<{ success: boolean, isFavorite: boolean }> {
  return unwrapEden(await api.api.subjects({ id }).favorite.post())
}
