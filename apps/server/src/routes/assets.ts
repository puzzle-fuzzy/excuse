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
  AssetDeleteResponse,
  AssetLibraryItem,
  AssetLibraryKind,
  AssetLibraryListResponse,
  AssetLibrarySort,
  AssetLibrarySource,
  AssetLibraryStatusFilter,
  AssetRestoreResponse,
} from '@excuse/shared'
import type { ServerConfig } from '../config'
import {
  addAssetFavorite,
  assignAssetTag,
  findAssetTagById,
  getAssetReferences,
  getCanvasAssetByIdForAccount,
  getGenerationRecordByIdForAccount,
  getUploadedFileByIdForAccount,
  hideCanvasAsset,
  hideGenerationRecord,
  listAssetFavoriteKeys,
  listAssetTagKeys,
  listAssetTags,
  listCanvasAssetsForLibrary,
  listGenerationRecords,
  listUploadedFilesForAccount,
  removeAssetFavorite,
  restoreCanvasAsset,
  restoreGenerationRecord,
  restoreUploadedFile,
  softDeleteCanvasAsset,
  softDeleteGenerationRecord,
  softDeleteUploadedFile,
  unassignAssetTag,
  unhideCanvasAsset,
  unhideGenerationRecord,
} from '@excuse/db'
import { isImageOutput, isVideoOutput, parseOutputResult } from '@excuse/shared'
import { Elysia, t } from 'elysia'
import { createRequireAuthPlugin } from '../plugins/auth'
import { audit } from '../services/audit'
import { ConflictError, NotFoundError, ValidationError } from '../utils/app-errors'

/**
 * 统一资产中心路由 — GET /api/assets
 *
 * 把三种来源（generation_records / canvas_assets / uploaded_files）合并成同一份
 * AssetLibraryItem 列表。映射规则集中在本文件，不散落到各 if。
 *
 * 关键约束：
 *   - 所有查询按 accountId 隔离（createRequireAuthPlugin 保证 userId 存在）。
 *   - previewUrl / downloadUrl 优先稳定 publicUrl，不暴露 provider 临时 URL。
 *   - 不把 inputJson / outputJson 原样返回给前端，只提取标量字段。
 */

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

// ── 查询参数规整（clamp / 日期解析） ──────────────────────────────────────────

const MAX_LIMIT = 200

/** 合法的排序值（与 AssetLibrarySort 联合类型一一对应） */
const ALLOWED_SORTS: AssetLibrarySort[] = ['created_desc', 'created_asc', 'title_asc', 'title_desc']

/** 把 query.sort 解析为合法 AssetLibrarySort，非法值回落到默认 created_desc */
function resolveSort(raw: string | undefined): AssetLibrarySort {
  return raw && ALLOWED_SORTS.includes(raw as AssetLibrarySort) ? raw as AssetLibrarySort : 'created_desc'
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

/** 把 query 里的 limit/offset 规整为安全整数（clamp 到合理区间） */
function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value == null || Number.isNaN(value))
    return fallback
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

/** 解析 ISO 日期字符串为 Date；非法/空时返回 undefined（不过滤） */
function parseDateParam(value: unknown): Date | undefined {
  if (typeof value !== 'string' || value.length === 0)
    return undefined
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d
}

// ── 路由 ──────────────────────────────────────────────────────────────────────

export function createAssetsRoutes(config: ServerConfig) {
  return new Elysia({ prefix: '/api' })
    .use(createRequireAuthPlugin(config))
    .get('/assets', async ({ query, userId }) => {
      const source = (query.source ?? 'all') as 'all' | AssetLibrarySource
      const kind = (query.kind ?? 'all') as 'all' | AssetLibraryKind
      const status = (query.status ?? 'all') as AssetLibraryStatusFilter | 'all'
      const projectId = typeof query.projectId === 'string' && query.projectId.length > 0 ? query.projectId : undefined
      const model = typeof query.model === 'string' && query.model.length > 0 ? query.model : undefined
      // search：trim + 限长 120 字符，空等同未传
      const rawSearch = typeof query.search === 'string' ? query.search.trim() : ''
      const search = rawSearch.length > 0 ? rawSearch.slice(0, 120) : undefined
      const createdFrom = parseDateParam(query.createdFrom)
      const createdTo = parseDateParam(query.createdTo)
      const sort = resolveSort(typeof query.sort === 'string' ? query.sort : undefined)
      const favorite = query.favorite === true
      // clamp：limit ∈ [1, 200]，offset ≥ 0
      const limit = clampInt(query.limit, 1, MAX_LIMIT, 100)
      const offset = clampInt(query.offset, 0, Number.MAX_SAFE_INTEGER, 0)

      const plan = resolveSourcePlan(source, kind, status, Boolean(model))

      // 并行查询各来源 + 当前用户收藏 key 集合 + 标签集合（按 accountId 隔离，model/时间下推到 SQL）
      const [genRows, canvasRows, uploadRows, favoriteKeys, tagRows, assignmentKeys] = await Promise.all([
        plan.gen
          ? listGenerationRecords({
              accountId: userId,
              statuses: genStatusesFor(status),
              category: kind !== 'all' && kindIsGenCategory(kind) ? kind as GenerationCategory : undefined,
              projectId,
              model,
              search,
              createdFrom,
              createdTo,
              excludeHidden: true,
              limit,
              offset,
            })
          : Promise.resolve([]),
        plan.canvas
          ? listCanvasAssetsForLibrary(userId, {
              statuses: canvasStatusesFor(status),
              categories: kind !== 'all' ? canvasCategoriesForKind(kind) : undefined,
              projectId,
              model,
              search,
              createdFrom,
              createdTo,
              excludeHidden: true,
              limit,
              offset,
            })
          : Promise.resolve([]),
        // uploaded_files 无 model 列；plan.upload 在 model 非空时已为 false
        plan.upload
          ? listUploadedFilesForAccount(userId, { search, createdFrom, createdTo, limit, offset })
          : Promise.resolve([]),
        // 一次性查回当前用户全部收藏 key，避免对每条资产发一次 SQL
        listAssetFavoriteKeys(userId),
        // 一次性查回当前用户全部标签定义（id → name 映射）
        listAssetTags(userId),
        // 一次性查回当前用户全部 (tagId, source, assetId) 集合
        listAssetTagKeys(userId),
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

      // 解析 tagIds 查询参数（逗号分隔字符串 → tagId 列表，OR 关系）
      const tagIdFilterRaw = typeof query.tagIds === 'string' ? query.tagIds : ''
      const tagIdFilter = tagIdFilterRaw
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
      const tagIdFilterSet = new Set(tagIdFilter)

      // 映射 + 合并
      const items: AssetLibraryItem[] = [
        ...genRows.map(mapGenerationRecord),
        ...canvasRows.map(mapCanvasAsset),
        ...uploadRows.map(mapUploadedFile),
      ]

      // 按 sort 参数统一排序（各来源已各自 createdAt desc，但合并后需按用户选择重排）
      sortAssetLibraryItems(items, sort)

      // 注入 isFavorite + favorite 过滤（在排序之后、hasMore 计算之前）
      const filteredFavorite = items.filter((item) => {
        item.isFavorite = favoriteSet.has(`${item.source}:${item.id}`)
        if (favorite && !item.isFavorite)
          return false
        return true
      })

      // 注入 tagNames + tagIds 过滤（在 favorite 注入之后、hasMore 计算之前）
      const filtered = filteredFavorite.filter((item) => {
        const tagIds = assetTagsMap.get(`${item.source}:${item.id}`)
        item.tagNames = tagIds
          ? [...tagIds].map(id => tagNameMap.get(id)).filter((n): n is string => Boolean(n))
          : []
        if (tagIdFilterSet.size > 0) {
          const hasAny = tagIds ? [...tagIds].some(id => tagIdFilterSet.has(id)) : false
          if (!hasAny)
            return false
        }
        return true
      })

      // 轻量分页（Plan A）：返回条数 >= limit 时认为“可能有更多”，不做 SQL count。
      // 注意：favorite=true 或 tagIds 非空时，实际 items 可能少于 limit，但 hasMore 仍按原 limit 触发，
      // 这是 v1 已知限制（避免为了 favorite/tagIds 做 SQL JOIN）。
      const hasMore = items.length >= limit

      return { success: true, items: filtered, total: filtered.length, hasMore } satisfies AssetLibraryListResponse
    }, {
      query: t.Object({
        source: t.Optional(t.String()),
        kind: t.Optional(t.String()),
        status: t.Optional(t.String()),
        projectId: t.Optional(t.String()),
        model: t.Optional(t.String()),
        search: t.Optional(t.String({ description: '关键词搜索' })),
        createdFrom: t.Optional(t.String()),
        createdTo: t.Optional(t.String()),
        sort: t.Optional(t.String({ description: '排序：created_desc（默认） / created_asc / title_asc / title_desc' })),
        favorite: t.Optional(t.Boolean({ description: '仅返回当前用户已收藏的资产（默认 false）' })),
        tagIds: t.Optional(t.String({ description: '标签 ID 列表（逗号分隔），OR 关系：返回打了任一标签的资产' })),
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
      }),
      detail: {
        summary: '获取统一资产列表',
        description: '合并 generation_records / canvas_assets / uploaded_files 三种来源，支持按 source（来源表）、kind（资产类别）、status（状态）、projectId、model、search（关键词搜索）、createdFrom/createdTo 过滤，sort 排序（created_desc / created_asc / title_asc / title_desc，默认 created_desc，非法值静默回落），favorite=true 时仅返回当前用户已收藏的资产并在每条 item 上注入 isFavorite 字段，tagIds（逗号分隔）按 OR 关系过滤并注入 tagNames 字段（用户私有标签），limit/offset 分页（limit 上限 200）。所有查询按当前用户隔离。previewUrl 优先稳定 publicUrl。hasMore 为轻量分页标记（返回条数 >= limit 时为 true；favorite/tagIds 过滤后可能少于 limit，但 hasMore 仍按原 limit 触发，v1 已知限制）。search 与其他过滤条件为 AND 关系，服务端 trim 后生效，限长 120 字符。',
        tags: ['资产'],
        security: [{ bearerAuth: [] }],
      },
    })

    // ── 隐藏资产（从资产中心移除，不删除 DB 记录） ──────────────────────────
    .post('/assets/:source/:id/hide', async ({ params: { source, id }, userId }) => {
      if (source === 'generation_record') {
        const record = await getGenerationRecordByIdForAccount(id, userId)
        if (!record)
          throw new NotFoundError('生成记录不存在或无权限访问')
        await hideGenerationRecord(id)
        audit('asset_hide', { accountId: userId, targetId: id, detail: { source, id } })
        return { success: true }
      }

      if (source === 'canvas_asset') {
        const asset = await getCanvasAssetByIdForAccount(id, userId)
        if (!asset)
          throw new NotFoundError('Canvas 资产不存在或无权限访问')
        // 拒绝隐藏正在生成中的资产
        if (asset.status === 'queued' || asset.status === 'running')
          throw new ConflictError('正在生成中的资产不能隐藏')
        await hideCanvasAsset(id)
        audit('asset_hide', { accountId: userId, targetId: id, detail: { source, id } })
        return { success: true }
      }

      throw new ValidationError('只支持隐藏 generation_record 或 canvas_asset')
    }, {
      params: t.Object({
        source: t.Union([t.Literal('generation_record'), t.Literal('canvas_asset')]),
        id: t.String(),
      }),
      detail: {
        summary: '隐藏资产',
        description: '将 generation_record 或 canvas_asset 从资产中心隐藏（设置 hiddenAt），不删除 DB 记录或存储文件。canvas_asset 状态为 queued/running 时拒绝隐藏（返回 409）。uploaded_file 请使用独立的删除接口。',
        tags: ['资产'],
        security: [{ bearerAuth: [] }],
      },
    })

    // ── 取消隐藏（恢复误隐藏资产） ──────────────────────────────────────────
    .post('/assets/:source/:id/unhide', async ({ params: { source, id }, userId }) => {
      if (source === 'generation_record') {
        const record = await getGenerationRecordByIdForAccount(id, userId)
        if (!record)
          throw new NotFoundError('生成记录不存在或无权限访问')
        await unhideGenerationRecord(id)
      }
      else if (source === 'canvas_asset') {
        const asset = await getCanvasAssetByIdForAccount(id, userId)
        if (!asset)
          throw new NotFoundError('Canvas 资产不存在或无权限访问')
        await unhideCanvasAsset(id)
      }
      else {
        throw new ValidationError('只支持取消隐藏 generation_record 或 canvas_asset')
      }
      audit('asset_hide', { accountId: userId, targetId: id, detail: { source, id, action: 'unhide' } })
      return { success: true, source, id } satisfies AssetRestoreResponse
    }, {
      params: t.Object({
        source: t.Union([t.Literal('generation_record'), t.Literal('canvas_asset')]),
        id: t.String(),
      }),
      detail: {
        summary: '取消隐藏资产',
        description: '清除 hiddenAt，把误隐藏的 generation_record / canvas_asset 恢复到资产中心。',
        tags: ['资产'],
        security: [{ bearerAuth: [] }],
      },
    })

    // ── 软删除（引用守卫：仍被引用则 retained，不物理清除） ────────────────────
    .delete('/assets/:source/:id', async ({ params: { source, id }, userId }) => {
      // 归属校验 + 正在生成的 canvas_asset 拒绝删除
      if (source === 'canvas_asset') {
        const asset = await getCanvasAssetByIdForAccount(id, userId)
        if (!asset)
          throw new NotFoundError('Canvas 资产不存在或无权限访问')
        if (asset.status === 'queued' || asset.status === 'running')
          throw new ConflictError('正在生成中的资产不能删除')
      }
      else if (source === 'generation_record') {
        const record = await getGenerationRecordByIdForAccount(id, userId)
        if (!record)
          throw new NotFoundError('生成记录不存在或无权限访问')
      }
      else if (source === 'uploaded_file') {
        const file = await getUploadedFileByIdForAccount(id, userId)
        if (!file)
          throw new NotFoundError('上传文件不存在或无权限访问')
      }

      // 引用守卫：决定 retained 标记（仍被引用 → GC 不物理清除）
      const references = await getAssetReferences(source, userId, id)

      // 软删除（置 deletedAt）
      if (source === 'canvas_asset')
        await softDeleteCanvasAsset(id, userId)
      else if (source === 'generation_record')
        await softDeleteGenerationRecord(id, userId)
      else
        await softDeleteUploadedFile(id, userId)

      audit('admin_action', { accountId: userId, targetId: id, detail: { source, id, action: 'soft_delete', retained: references.retained } })
      return { success: true, source, id, retained: references.retained, references } satisfies AssetDeleteResponse
    }, {
      params: t.Object({
        source: t.Union([t.Literal('generation_record'), t.Literal('canvas_asset'), t.Literal('uploaded_file')]),
        id: t.String(),
      }),
      detail: {
        summary: '软删除资产',
        description: '置 deletedAt 软删除，从资产中心移除。删除前做引用守卫：若仍被项目 / 镜头 / 生成记录引用（referenceAssetsJson / isActive 版本 / videoFileId / referenceFileIds），标记 retained=true，retention GC 不会物理清除其存储文件，保证 Canvas 预览与后续生成不破裂；未引用则过宽限期后由 GC 物理清除。canvas_asset 状态为 queued/running 时拒绝删除（409）。',
        tags: ['资产'],
        security: [{ bearerAuth: [] }],
      },
    })

    // ── 恢复（un-delete）软删除的资产 ────────────────────────────────────────
    .post('/assets/:source/:id/restore', async ({ params: { source, id }, userId }) => {
      let restored = false
      if (source === 'canvas_asset')
        restored = await restoreCanvasAsset(id, userId)
      else if (source === 'generation_record')
        restored = await restoreGenerationRecord(id, userId)
      else
        restored = await restoreUploadedFile(id, userId)

      if (!restored)
        throw new NotFoundError('资产不存在或无权限访问')

      audit('admin_action', { accountId: userId, targetId: id, detail: { source, id, action: 'restore' } })
      return { success: true, source, id } satisfies AssetRestoreResponse
    }, {
      params: t.Object({
        source: t.Union([t.Literal('generation_record'), t.Literal('canvas_asset'), t.Literal('uploaded_file')]),
        id: t.String(),
      }),
      detail: {
        summary: '恢复软删除的资产',
        description: '清除 deletedAt，把误删除的资产恢复到资产中心（GC 物理清除前均可恢复）。',
        tags: ['资产'],
        security: [{ bearerAuth: [] }],
      },
    })

    // ── 收藏 toggle（用户级收藏标记，幂等） ─────────────────────────────────
    //
    // 不走 audit：audit_action 枚举当前不含 asset_favorite_add/remove，
    // 扩枚举会触碰既有 schema 文件，与本轮边界冲突；favorite toggle 是用户对
    // 个人资产的轻量标记，参照 notify/SSE 等高频内部操作也不进 audit 的做法。
    // 如产品后续要求审计，下一轮单独扩 audit 枚举。
    .post('/assets/:source/:id/favorite', async ({ params: { source, id }, userId }) => {
      // source 校验已由 params schema 完成（t.Union Literal）。
      await addAssetFavorite({ accountId: userId, source, assetId: id })
      return { success: true as const, data: { isFavorite: true as const } }
    }, {
      params: t.Object({
        source: t.Union([
          t.Literal('generation_record'),
          t.Literal('canvas_asset'),
          t.Literal('uploaded_file'),
        ]),
        id: t.String(),
      }),
      detail: {
        summary: '收藏资产',
        description: '将 generation_record / canvas_asset / uploaded_file 三种来源的资产加入当前用户收藏（幂等，已收藏则保持）。返回 { success: true, data: { isFavorite: true } } 作为权威状态。',
        tags: ['资产'],
        security: [{ bearerAuth: [] }],
      },
    })

    .delete('/assets/:source/:id/favorite', async ({ params: { source, id }, userId }) => {
      await removeAssetFavorite({ accountId: userId, source, assetId: id })
      return { success: true as const, data: { isFavorite: false as const } }
    }, {
      params: t.Object({
        source: t.Union([
          t.Literal('generation_record'),
          t.Literal('canvas_asset'),
          t.Literal('uploaded_file'),
        ]),
        id: t.String(),
      }),
      detail: {
        summary: '取消收藏资产',
        description: '将资产从当前用户收藏中移除（幂等，未收藏则保持）。返回 { success: true, data: { isFavorite: false } } 作为权威状态。',
        tags: ['资产'],
        security: [{ bearerAuth: [] }],
      },
    })

    // ── 标签 assign/unassign（用户私有标签，幂等） ───────────────────────────
    //
    // 不走 audit：与 favorite toggle 一致，避免扩 audit 枚举触碰既有 schema。
    // assign 时校验 tag 属于当前用户（避免给不存在 / 他人的标签打标）。
    // 资产本身的归属校验（assetId 是否属于当前用户）v1 暂不做（与 favorite endpoint 一致）。
    .post('/assets/:source/:id/tags/:tagId', async ({ params: { source, id, tagId }, userId }) => {
      const tag = await findAssetTagById({ accountId: userId, tagId })
      if (!tag)
        throw new NotFoundError('标签不存在')
      await assignAssetTag({ accountId: userId, tagId, source, assetId: id })
      return { success: true as const }
    }, {
      params: t.Object({
        source: t.Union([
          t.Literal('generation_record'),
          t.Literal('canvas_asset'),
          t.Literal('uploaded_file'),
        ]),
        id: t.String(),
        tagId: t.String(),
      }),
      detail: {
        summary: '给资产打标签',
        description: '将指定标签打在资产上（幂等，已打标则保持）。tagId 不存在或不属于当前用户时返回 404。source 必须是 generation_record / canvas_asset / uploaded_file 之一。',
        tags: ['资产'],
        security: [{ bearerAuth: [] }],
      },
    })

    .delete('/assets/:source/:id/tags/:tagId', async ({ params: { source, id, tagId }, userId }) => {
      await unassignAssetTag({ accountId: userId, tagId, source, assetId: id })
      return { success: true as const }
    }, {
      params: t.Object({
        source: t.Union([
          t.Literal('generation_record'),
          t.Literal('canvas_asset'),
          t.Literal('uploaded_file'),
        ]),
        id: t.String(),
        tagId: t.String(),
      }),
      detail: {
        summary: '取消资产的标签',
        description: '将指定标签从资产上移除（幂等，未打标则保持）。不校验 tagId 归属（unassign 不存在的标签同样幂等成功）。',
        tags: ['资产'],
        security: [{ bearerAuth: [] }],
      },
    })
}
