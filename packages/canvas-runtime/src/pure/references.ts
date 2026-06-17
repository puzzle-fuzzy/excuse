/**
 * 纯函数：镜头视频引用解析
 *
 * 无 IO 依赖，纯数据变换。
 * resolveShotVideoReferences 按 URL 去重角色/场景/用户引用。
 * toPromptReferenceEntries 生成 prompt 指代条目（[Image N]）。
 */

import type { PromptReferenceEntry } from '@excuse/prompt-engine'
import type { CanvasShotReferenceAsset, CanvasVideoReference } from '@excuse/shared'

export interface ResolveShotVideoReferencesInput {
  shot: {
    characterIdsJson: string[]
    locationId: string | null
    referenceAssetsJson?: CanvasShotReferenceAsset[] | null
  }
  characters: ReadonlyArray<{ id: string, turnaroundSheetUrl?: string | null, referenceImageUrl?: string | null }>
  locations: ReadonlyArray<{ id: string, referenceImageUrl?: string | null }>
}

/**
 * 解析镜头视频引用为带 role 的参考列表。
 *
 * 顺序：角色自动引用 → 场景自动引用 → 用户额外引用。
 * 按 URL 去重，保留首次出现。
 * 角色图优先取 turnaroundSheetUrl（三视图），缺失才回退 referenceImageUrl。
 */
export function resolveShotVideoReferences(
  input: ResolveShotVideoReferencesInput,
): CanvasVideoReference[] {
  const characterMap = new Map(input.characters.map(c => [c.id, c]))
  const locationMap = new Map(input.locations.map(l => [l.id, l]))

  const refs: CanvasVideoReference[] = []

  for (const id of input.shot.characterIdsJson) {
    const character = characterMap.get(id)
    const url = character?.turnaroundSheetUrl || character?.referenceImageUrl
    if (url) refs.push({ url, role: 'character', characterId: id })
  }

  if (input.shot.locationId) {
    const url = locationMap.get(input.shot.locationId)?.referenceImageUrl
    if (url) refs.push({ url, role: 'location', locationId: input.shot.locationId })
  }

  for (const asset of input.shot.referenceAssetsJson ?? []) {
    if (asset.url) refs.push({ url: asset.url, role: asset.role })
  }

  const seen = new Set<string>()
  return refs.filter((ref) => {
    if (seen.has(ref.url)) return false
    seen.add(ref.url)
    return true
  })
}

/**
 * 把 resolveShotVideoReferences 的结果转换为 prompt builder 用参考图指代条目。
 */
export function toPromptReferenceEntries(
  references: ReadonlyArray<CanvasVideoReference>,
): PromptReferenceEntry[] {
  const entries: PromptReferenceEntry[] = []
  references.forEach((ref, index) => {
    const targetId = ref.characterId ?? ref.locationId
    if (targetId) entries.push({ targetId, imageNumber: index + 1 })
  })
  return entries
}
