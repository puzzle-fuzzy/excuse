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
  AssetLibraryListResponse,
  AssetLibrarySource,
  AssetLibraryStatusFilter,
} from '@excuse/shared'
import type { ServerConfig } from '../config'
import {
  listCanvasAssetsForLibrary,
  listGenerationRecords,
  listUploadedFilesForAccount,
} from '@excuse/db'
import { isImageOutput, isVideoOutput, parseOutputResult } from '@excuse/shared'
import { Elysia, t } from 'elysia'
import { createRequireAuthPlugin } from '../plugins/auth'

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
      // clamp：limit ∈ [1, 200]，offset ≥ 0
      const limit = clampInt(query.limit, 1, MAX_LIMIT, 100)
      const offset = clampInt(query.offset, 0, Number.MAX_SAFE_INTEGER, 0)

      const plan = resolveSourcePlan(source, kind, status, Boolean(model))

      // 并行查询各来源（按 accountId 隔离，model/时间下推到 SQL）
      const [genRows, canvasRows, uploadRows] = await Promise.all([
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
              limit,
              offset,
            })
          : Promise.resolve([]),
        // uploaded_files 无 model 列；plan.upload 在 model 非空时已为 false
        plan.upload
          ? listUploadedFilesForAccount(userId, { search, createdFrom, createdTo, limit, offset })
          : Promise.resolve([]),
      ])

      // 映射 + 合并
      const items: AssetLibraryItem[] = [
        ...genRows.map(mapGenerationRecord),
        ...canvasRows.map(mapCanvasAsset),
        ...uploadRows.map(mapUploadedFile),
      ]

      // 按 createdAt desc 统一排序（各来源已各自 desc，但合并后需重排）
      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

      // 轻量分页（Plan A）：返回条数 >= limit 时认为“可能有更多”，不做 SQL count。
      const hasMore = items.length >= limit

      return { success: true, items, total: items.length, hasMore } satisfies AssetLibraryListResponse
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
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
      }),
      detail: {
        summary: '获取统一资产列表',
        description: '合并 generation_records / canvas_assets / uploaded_files 三种来源，支持按 source（来源表）、kind（资产类别）、status（状态）、projectId、model、search（关键词搜索）、createdFrom/createdTo 过滤，limit/offset 分页（limit 上限 200）。所有查询按当前用户隔离。previewUrl 优先稳定 publicUrl。hasMore 为轻量分页标记（返回条数 >= limit 时为 true）。search 与其他过滤条件为 AND 关系，服务端 trim 后生效，限长 120 字符。',
        tags: ['资产'],
        security: [{ bearerAuth: [] }],
      },
    })
}
