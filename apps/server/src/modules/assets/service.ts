/**
 * 统一资产中心 service — 三来源（generation_records / canvas_assets / uploaded_files）
 * 合并查询与序列化的纯业务逻辑，从 `routes/assets.ts` 抽出。
 *
 * 职责：
 *   1. 查询参数规整（clamp / 日期 / 排序 / 标签解析）
 *   2. 来源映射（category → kind、统一 status → 各来源原始状态集合）
 *   3. 来源规划（source/kind/status/model → 需要查哪些表）
 *   4. 行 → AssetLibraryItem 序列化（previewUrl 优先稳定 publicUrl，不暴露 provider 临时 URL）
 *   5. `listAssetLibrary` — 并行查询三来源 + 收藏/标签集合，映射合并、排序、favorite/tag 注入与过滤、轻量分页
 *
 * 不涉及 HTTP 语义（query 解析、响应塑形、audit 由 route 负责）。
 */
import type {
  CanvasAssetCategory,
  CanvasAssetRow,
  CanvasAssetStatus,
  GenerationCategory,
  GenerationRecordRow,
  GenerationStatus,
  UploadedFileRow,
} from '@excuse/db'
import type {
  AssetLibraryItem,
  AssetLibraryKind,
  AssetLibrarySort,
  AssetLibrarySource,
  AssetLibraryStatusFilter,
} from '@excuse/shared'
import {
  listAssetFavoriteKeys,
  listAssetTagKeys,
  listAssetTags,
  listCanvasAssetsForLibrary,
  listGenerationRecords,
  listUploadedFilesForAccount,
} from '@excuse/db'
import { isImageOutput, isVideoOutput, parseOutputResult } from '@excuse/shared'

// ── 集中映射：canvas_assets.category → AssetLibraryKind ──────────────────────
//
// 图片/视频类资产按实体归类（角色/场景/镜头），便于浏览；
// 文本/JSON 类资产（分析、档案、分镜、连续性报告、视频提示词）统一归到 project（项目文档）。
const CANVAS_CATEGORY_KIND: Record<CanvasAssetCategory, AssetLibraryKind> = {
  characterPortrait: 'character',
  characterTurnaround: 'character',
  locationRef: 'location',
  shotVideo: 'shot',
  analysis: 'project',
  characterProfile: 'project',
  locationProfile: 'project',
  storyboard: 'project',
  continuityReport: 'project',
  videoPrompt: 'project',
}

/** generation_records.category → AssetLibraryKind（直接对应） */
function genCategoryToKind(category: GenerationCategory): AssetLibraryKind {
  switch (category) {
    case 'image': return 'image'
    case 'video': return 'video'
    case 'text': return 'text'
    case 'subtitle': return 'subtitle'
    default: return 'text'
  }
}

/** kind → 该 kind 覆盖的 canvas_assets.category 列表（用于 SQL 预筛） */
function canvasCategoriesForKind(kind: AssetLibraryKind): CanvasAssetCategory[] | undefined {
  const entries = Object.entries(CANVAS_CATEGORY_KIND) as Array<[CanvasAssetCategory, AssetLibraryKind]>
  const matched = entries.filter(([, k]) => k === kind).map(([cat]) => cat)
  return matched.length > 0 ? matched : undefined
}

/** kind → 是否落在 generation_records 维度（image/video/text/subtitle） */
function kindIsGenCategory(kind: AssetLibraryKind): boolean {
  return kind === 'image' || kind === 'video' || kind === 'text' || kind === 'subtitle'
}

// ── 集中映射：统一 status 过滤 → 各来源原始状态集合 ──────────────────────────

/** generation_records 原始状态中属于“生成中（running）”的集合 */
const GEN_RUNNING_STATUSES: GenerationStatus[] = ['submitting', 'processing', 'saving_output']

/** 统一 status 过滤 → generation_records 状态集合（undefined 表示不过滤） */
function genStatusesFor(status: AssetLibraryStatusFilter | 'all'): GenerationStatus[] | undefined {
  switch (status) {
    case 'succeeded': return ['succeeded']
    case 'failed': return ['failed']
    case 'cancelled': return ['cancelled']
    case 'running': return [...GEN_RUNNING_STATUSES]
    case 'queued': return ['pending']
    default: return undefined // all
  }
}

/** 统一 status 过滤 → canvas_assets 状态集合（undefined 表示不过滤） */
function canvasStatusesFor(status: AssetLibraryStatusFilter | 'all'): CanvasAssetStatus[] | undefined {
  switch (status) {
    case 'succeeded': return ['succeeded']
    case 'failed': return ['failed']
    case 'cancelled': return ['cancelled']
    case 'running': return ['running']
    case 'queued': return ['queued']
    default: return undefined // all
  }
}

// ── 标量提取（安全读取 JSONB） ──────────────────────────────────────────────

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** 从 generation_records.outputResult 提取稳定预览 URL（savedUrls 优先于临时 URL） */
function previewUrlFromOutput(outputResult: unknown): string | null {
  const output = parseOutputResult(outputResult)
  if (!output)
    return null
  if (isImageOutput(output) && output.savedUrls.length > 0)
    return output.savedUrls[0] ?? null
  if (isImageOutput(output) && output.urls?.length)
    return output.urls[0] ?? null
  if (isVideoOutput(output) && output.savedUrls.length > 0)
    return output.savedUrls[0] ?? null
  if (isVideoOutput(output))
    return output.video_url ?? output.originalUrl ?? null
  return null
}

// ── 来源 → DTO 映射 ─────────────────────────────────────────────────────────

function mapGenerationRecord(record: GenerationRecordRow): AssetLibraryItem {
  const inputParams = (record.inputParams ?? {}) as Record<string, unknown>
  return {
    id: record.id,
    source: 'generation_record',
    kind: genCategoryToKind(record.category),
    status: record.status,
    title: record.model || record.category,
    model: record.model,
    previewUrl: previewUrlFromOutput(record.outputResult),
    downloadUrl: previewUrlFromOutput(record.outputResult),
    projectId: readString(inputParams.projectId),
    targetEntityType: null,
    targetEntityId: null,
    prompt: readString(inputParams.prompt),
    costCents: record.totalPriceCents ?? null,
    createdAt: record.createdAt.toISOString(),
    // route 在 favorite 注入阶段会用 favoriteSet 覆盖；这里给默认值满足类型。
    isFavorite: false,
    // route 在 tagNames 注入阶段会用 assetTagsMap 覆盖；这里给默认值满足类型。
    tagNames: [],
  }
}

function mapCanvasAsset(asset: CanvasAssetRow): AssetLibraryItem {
  const inputJson = (asset.inputJson ?? {}) as Record<string, unknown>
  return {
    id: asset.id,
    source: 'canvas_asset',
    kind: CANVAS_CATEGORY_KIND[asset.category] ?? 'project',
    status: asset.status,
    title: asset.model || asset.category,
    model: asset.model,
    // 优先稳定 publicUrl，不暴露 provider 临时 URL
    previewUrl: asset.publicUrl ?? null,
    downloadUrl: asset.publicUrl ?? null,
    projectId: asset.projectId,
    targetEntityType: asset.targetEntityType,
    targetEntityId: asset.targetEntityId,
    prompt: readString(inputJson.prompt),
    costCents: asset.totalPriceCents ?? null,
    createdAt: asset.createdAt.toISOString(),
    isFavorite: false,
    tagNames: [],
  }
}

function mapUploadedFile(file: UploadedFileRow): AssetLibraryItem {
  return {
    id: file.id,
    source: 'uploaded_file',
    kind: 'upload',
    status: 'succeeded',
    title: file.fileName,
    model: null,
    previewUrl: file.publicUrl ?? null,
    downloadUrl: file.publicUrl ?? null,
    projectId: null,
    targetEntityType: null,
    targetEntityId: null,
    prompt: null,
    costCents: null,
    createdAt: file.createdAt.toISOString(),
    isFavorite: false,
    tagNames: [],
  }
}

// ── 来源解析：source + kind + status + model → 需要查询哪些表 ─────────────────

interface SourcePlan {
  gen: boolean
  canvas: boolean
  upload: boolean
}

/**
 * 根据查询条件决定需要查询哪些来源表
 *
 * 跳过 uploaded_files 的两种情况：
 *   - 非终态过滤（status=running/queued/failed/cancelled）：上传文件只有 succeeded。
 *   - model 非空：uploaded_files 没有 model 列，按模型筛选时无意义。
 */
function resolveSourcePlan(
  source: 'all' | AssetLibrarySource,
  kind: 'all' | AssetLibraryKind,
  status: AssetLibraryStatusFilter | 'all',
  hasModel: boolean,
): SourcePlan {
  const uploadEligibleByStatus = status === 'all' || status === 'succeeded'
  const uploadEligible = uploadEligibleByStatus && !hasModel

  if (source !== 'all') {
    return {
      gen: source === 'generation_record',
      canvas: source === 'canvas_asset',
      upload: source === 'uploaded_file' && uploadEligible,
    }
  }

  // source=all：按 kind 缩窄
  if (kind !== 'all') {
    if (kindIsGenCategory(kind))
      return { gen: true, canvas: false, upload: false }
    if (kind === 'upload')
      return { gen: false, canvas: false, upload: uploadEligible }
    // character/location/shot/project → canvas_assets
    return { gen: false, canvas: true, upload: false }
  }

  return { gen: true, canvas: true, upload: uploadEligible }
}

// ── 查询参数规整（clamp / 日期解析 / 排序 / 标签解析） ──────────────────────────

const MAX_LIMIT = 200

/** 合法的排序值（与 AssetLibrarySort 联合类型一一对应） */
const ALLOWED_SORTS: AssetLibrarySort[] = ['created_desc', 'created_asc', 'title_asc', 'title_desc']

/** 把 query.sort 解析为合法 AssetLibrarySort，非法值回落到默认 created_desc */
export function resolveSort(raw: string | undefined): AssetLibrarySort {
  return raw && ALLOWED_SORTS.includes(raw as AssetLibrarySort) ? raw as AssetLibrarySort : 'created_desc'
}

/** 把 query 里的 limit/offset 规整为安全整数（clamp 到合理区间） */
export function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value == null || Number.isNaN(value))
    return fallback
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

/** 解析 ISO 日期字符串为 Date；非法/空时返回 undefined（不过滤） */
export function parseDateParam(value: unknown): Date | undefined {
  if (typeof value !== 'string' || value.length === 0)
    return undefined
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d
}

/** 把逗号分隔的 tagIds 字符串解析为 tagId 列表（去空白、去空，OR 关系） */
export function parseTagIdFilter(raw: string | undefined): Set<string> {
  if (!raw)
    return new Set()
  return new Set(
    raw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
  )
}

/** 对合并后的统一 items 数组按指定排序方式重排 */
function sortAssetLibraryItems(items: AssetLibraryItem[], sort: AssetLibrarySort): void {
  switch (sort) {
    case 'created_asc':
      items.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      break
    case 'title_asc':
      items.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
      break
    case 'title_desc':
      items.sort((a, b) => b.title.localeCompare(a.title, 'zh-CN'))
      break
    case 'created_desc':
    default:
      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      break
  }
}

// ── 主查询：合并三来源 + 收藏/标签注入与过滤 + 轻量分页 ──────────────────────────

/** listAssetLibrary 的查询上下文（route 解析 query 后构造） */
export interface AssetLibraryQuery {
  source: 'all' | AssetLibrarySource
  kind: 'all' | AssetLibraryKind
  status: AssetLibraryStatusFilter | 'all'
  projectId?: string
  model?: string
  search?: string
  createdFrom?: Date
  createdTo?: Date
  sort: AssetLibrarySort
  favorite: boolean
  tagIdFilter: Set<string>
  limit: number
  offset: number
}

/** listAssetLibrary 返回 — route 映射为 AssetLibraryListResponse */
export interface AssetLibraryPage {
  items: AssetLibraryItem[]
  total: number
  hasMore: boolean
}

/**
 * 合并查询三来源资产并应用过滤/排序/分页。
 *
 * - 各来源按 accountId 隔离，model / 时间窗口下推到 SQL。
 * - 收藏与标签各一次性查回当前用户全量 key 集合（避免逐条 SQL），再在内存里注入 + 过滤。
 * - 轻量分页（Plan A）：返回条数 >= limit 即 hasMore=true，不做 SQL count；
 *   favorite/tagIds 过滤后 items 可能少于 limit，但 hasMore 仍按原 limit 触发（v1 已知限制，
 *   避免为 favorite/tagIds 做 SQL JOIN）。
 */
export async function listAssetLibrary(accountId: string, q: AssetLibraryQuery): Promise<AssetLibraryPage> {
  const plan = resolveSourcePlan(q.source, q.kind, q.status, Boolean(q.model))

  // 并行查询各来源 + 当前用户收藏 key 集合 + 标签集合（按 accountId 隔离，model/时间下推到 SQL）
  const [genRows, canvasRows, uploadRows, favoriteKeys, tagRows, assignmentKeys] = await Promise.all([
    plan.gen
      ? listGenerationRecords({
          accountId,
          statuses: genStatusesFor(q.status),
          category: q.kind !== 'all' && kindIsGenCategory(q.kind) ? q.kind as GenerationCategory : undefined,
          projectId: q.projectId,
          model: q.model,
          search: q.search,
          createdFrom: q.createdFrom,
          createdTo: q.createdTo,
          excludeHidden: true,
          limit: q.limit,
          offset: q.offset,
        })
      : Promise.resolve([]),
    plan.canvas
      ? listCanvasAssetsForLibrary(accountId, {
          statuses: canvasStatusesFor(q.status),
          categories: q.kind !== 'all' ? canvasCategoriesForKind(q.kind) : undefined,
          projectId: q.projectId,
          model: q.model,
          search: q.search,
          createdFrom: q.createdFrom,
          createdTo: q.createdTo,
          excludeHidden: true,
          limit: q.limit,
          offset: q.offset,
        })
      : Promise.resolve([]),
    // uploaded_files 无 model 列；plan.upload 在 model 非空时已为 false
    plan.upload
      ? listUploadedFilesForAccount(accountId, { search: q.search, createdFrom: q.createdFrom, createdTo: q.createdTo, limit: q.limit, offset: q.offset })
      : Promise.resolve([]),
    // 一次性查回当前用户全部收藏 key，避免对每条资产发一次 SQL
    listAssetFavoriteKeys(accountId),
    // 一次性查回当前用户全部标签定义（id → name 映射）
    listAssetTags(accountId),
    // 一次性查回当前用户全部 (tagId, source, assetId) 集合
    listAssetTagKeys(accountId),
  ])

  const favoriteSet = new Set(favoriteKeys.map(k => `${k.source}:${k.assetId}`))
  const tagNameMap = new Map(tagRows.map(t => [t.id, t.name]))
  const assetTagsMap = new Map<string, Set<string>>() // key: `${source}:${assetId}`，value: tagId 集合
  for (const k of assignmentKeys) {
    const key = `${k.source}:${k.assetId}`
    let set = assetTagsMap.get(key)
    if (!set) {
      set = new Set<string>()
      assetTagsMap.set(key, set)
    }
    set.add(k.tagId)
  }

  // 映射 + 合并
  const items: AssetLibraryItem[] = [
    ...genRows.map(mapGenerationRecord),
    ...canvasRows.map(mapCanvasAsset),
    ...uploadRows.map(mapUploadedFile),
  ]

  // 按 sort 参数统一排序（各来源已各自 createdAt desc，但合并后需按用户选择重排）
  sortAssetLibraryItems(items, q.sort)

  // 注入 isFavorite + favorite 过滤（在排序之后、hasMore 计算之前）
  const filteredFavorite = items.filter((item) => {
    item.isFavorite = favoriteSet.has(`${item.source}:${item.id}`)
    if (q.favorite && !item.isFavorite)
      return false
    return true
  })

  // 注入 tagNames + tagIds 过滤（在 favorite 注入之后、hasMore 计算之前）
  const filtered = filteredFavorite.filter((item) => {
    const tagIds = assetTagsMap.get(`${item.source}:${item.id}`)
    item.tagNames = tagIds
      ? [...tagIds].map(id => tagNameMap.get(id)).filter((n): n is string => Boolean(n))
      : []
    if (q.tagIdFilter.size > 0) {
      const hasAny = tagIds ? [...tagIds].some(id => q.tagIdFilter.has(id)) : false
      if (!hasAny)
        return false
    }
    return true
  })

  // 轻量分页（Plan A）：返回条数 >= limit 时认为“可能有更多”，不做 SQL count。
  const hasMore = items.length >= q.limit

  return { items: filtered, total: filtered.length, hasMore }
}

export { MAX_LIMIT }
