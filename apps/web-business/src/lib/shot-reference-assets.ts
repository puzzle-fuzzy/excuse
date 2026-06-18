/**
 * 镜头参考资产选择（P1-2 v0.2）— 资产 → 镜头参考的转换、去重、批量应用
 *
 * 从 lib/asset-library.ts 拆分，原与资产筛选/统计/Canvas 深链混在一起。
 */
import type { ApplyReferenceAssetsMode, AssetLibraryItem, CanvasShotReferenceAsset, CanvasShotReferenceRole, ReferenceAssetApplyPreview, ReferenceAssetApplyTarget } from '@excuse/shared'
import { getAssetLibraryPreviewKind } from './asset-library'

// ── 镜头参考资产候选判断 ──────────────────────────────────────

/** 镜头参考资产数量上限（与服务端 PATCH schema maxItems: 8 对齐） */
export const MAX_SHOT_REFERENCE_ASSETS = 8

/**
 * 判断资产是否可作为镜头参考资产候选
 *
 * 只允许图片类候选（image/character/location，以及 upload 中实际是图片的），
 * 排除 video/shot/text/subtitle/project 以及无稳定 URL 的资产。
 * 不要只用 `kind=image` 判断，否则会漏掉 Canvas 角色图、场景图和上传图片。
 */
export function isReferenceAssetCandidate(item: AssetLibraryItem): boolean {
  // 必须有稳定 URL：优先 downloadUrl，其次 previewUrl
  if (!item.downloadUrl && !item.previewUrl)
    return false

  switch (item.kind) {
    case 'image':
    case 'character':
    case 'location':
      return true
    case 'upload':
      // upload 按 URL 扩展名复用 previewKind 判断是否图片
      return getAssetLibraryPreviewKind(item) === 'image'
    case 'video':
    case 'shot':
    case 'text':
    case 'subtitle':
    case 'project':
    default:
      return false
  }
}

/**
 * 根据资产 kind 推断参考角色
 *
 * - character → character
 * - location → location
 * - 其他图片 → other
 */
export function inferReferenceRole(item: AssetLibraryItem): CanvasShotReferenceRole {
  if (item.kind === 'character')
    return 'character'
  if (item.kind === 'location')
    return 'location'
  return 'other'
}

/**
 * 将资产条目转换为镜头参考资产
 *
 * - assetId = item.id
 * - url = downloadUrl ?? previewUrl
 * - role = inferReferenceRole(item)
 * - label = item.title
 * - source = uploaded_file → uploaded_file，其余 → asset_library
 *
 * 非候选资产（isReferenceAssetCandidate=false）返回 null。
 */
export function assetToShotReferenceAsset(item: AssetLibraryItem): CanvasShotReferenceAsset | null {
  if (!isReferenceAssetCandidate(item))
    return null
  const url = item.downloadUrl ?? item.previewUrl
  // isReferenceAssetCandidate 已保证 url 非空，这里二次防御
  if (!url)
    return null
  return {
    assetId: item.id,
    url,
    role: inferReferenceRole(item),
    label: item.title,
    source: item.source === 'uploaded_file' ? 'uploaded_file' : 'asset_library',
  }
}

// ── 去重与合并 ─────────────────────────────────────────────

/**
 * 合并已有参考资产与新加入参考资产
 *
 * - 按 assetId 或 url 去重（任一命中即视为重复）
 * - 保留已有资产顺序，新加入资产追加到末尾
 * - 默认最多 8 个，超出截断
 */
export function mergeShotReferenceAssets(
  current: CanvasShotReferenceAsset[],
  incoming: CanvasShotReferenceAsset[],
  max: number = MAX_SHOT_REFERENCE_ASSETS,
): CanvasShotReferenceAsset[] {
  const seenAssetIds = new Set<string>()
  const seenUrls = new Set<string>()
  const result: CanvasShotReferenceAsset[] = []

  const push = (asset: CanvasShotReferenceAsset) => {
    if (result.length >= max)
      return
    if (seenAssetIds.has(asset.assetId) || seenUrls.has(asset.url))
      return
    seenAssetIds.add(asset.assetId)
    seenUrls.add(asset.url)
    result.push(asset)
  }

  for (const asset of current)
    push(asset)
  for (const asset of incoming)
    push(asset)

  return result
}

/** 判断资产是否已存在于参考资产列表（按 assetId 或 url 匹配） */
export function isReferenceAssetAdded(existing: CanvasShotReferenceAsset[], item: AssetLibraryItem): boolean {
  const url = item.downloadUrl ?? item.previewUrl
  return existing.some(a => a.assetId === item.id || (url != null && a.url === url))
}

// ── 批量应用参考资产（P1-2 v0.5）─────────────────────────────

/**
 * 预览批量应用参考资产的结果
 *
 * - `replace`：目标 assets = source assets 截断到 max
 * - `append`：复用 mergeShotReferenceAssets，按 assetId/url 去重，截断到 max
 * - `addedCount`：实际新增数量
 *   - replace：afterCount（全部为新放置）
 *   - append：afterCount - beforeCount（净增）
 * - `truncatedCount`：因上限被截断的数量
 */
export function previewApplyReferenceAssets(
  targets: ReferenceAssetApplyTarget[],
  sourceAssets: CanvasShotReferenceAsset[],
  mode: ApplyReferenceAssetsMode,
  max: number = MAX_SHOT_REFERENCE_ASSETS,
): ReferenceAssetApplyPreview[] {
  return targets.map((target) => {
    const beforeCount = target.referenceAssets.length
    if (mode === 'replace') {
      const assets = sourceAssets.slice(0, max)
      return {
        shotId: target.shotId,
        beforeCount,
        afterCount: assets.length,
        addedCount: assets.length,
        truncatedCount: Math.max(0, sourceAssets.length - max),
        assets,
      }
    }
    // append mode
    const assets = mergeShotReferenceAssets(target.referenceAssets, sourceAssets, max)
    const totalUnique = countUniqueMerged(target.referenceAssets, sourceAssets)
    return {
      shotId: target.shotId,
      beforeCount,
      afterCount: assets.length,
      addedCount: Math.max(0, assets.length - beforeCount),
      truncatedCount: Math.max(0, totalUnique - max),
      assets,
    }
  })
}

/** 计算合并后去重但不截断的总数量 */
function countUniqueMerged(current: CanvasShotReferenceAsset[], incoming: CanvasShotReferenceAsset[]): number {
  const seenAssetIds = new Set<string>()
  const seenUrls = new Set<string>()
  let count = 0
  for (const asset of current) {
    if (seenAssetIds.has(asset.assetId) || seenUrls.has(asset.url))
      continue
    seenAssetIds.add(asset.assetId)
    seenUrls.add(asset.url)
    count++
  }
  for (const asset of incoming) {
    if (seenAssetIds.has(asset.assetId) || seenUrls.has(asset.url))
      continue
    seenAssetIds.add(asset.assetId)
    seenUrls.add(asset.url)
    count++
  }
  return count
}
