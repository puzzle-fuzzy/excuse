import type { AssetLibraryItem, AssetLibraryKind, AssetLibrarySort, AssetLibrarySource, AssetLibraryStatusFilter } from '@excuse/shared'
import { isImageUrl, isVideoUrl } from './generation-utils'

/**
 * 统一资产中心纯函数 — 从 Assets.tsx 抽出的可测试逻辑
 *
 * 这些函数不依赖 React/IO，便于在 vitest 中直接测试。
 * 服务端 /api/assets 已经做了过滤；这些是页面层的本地筛选/统计/展示决策。
 */

/** 卡片缩略预览类别 — 决定卡片缩略区渲染图片/视频/图标 */
export type AssetPreviewKind = 'image' | 'video' | 'text' | 'file'

/** kind → 中文标签 */
export const KIND_LABELS: Record<AssetLibraryKind, string> = {
  image: '图片',
  video: '视频',
  text: '文本',
  subtitle: '字幕',
  audio: '音频',
  upload: '上传',
  character: '角色',
  location: '场景',
  shot: '镜头',
  project: '项目',
}

/** source → 中文标签（来源 badge） */
export const SOURCE_LABELS: Record<AssetLibrarySource, string> = {
  generation_record: '生成',
  canvas_asset: 'Canvas',
  uploaded_file: '上传',
}

/** 统一 status → 中文标签（状态 badge） */
export const STATUS_LABELS: Record<string, string> = {
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
  running: '运行中',
  queued: '排队中',
  pending: '等待中',
  submitting: '提交中',
  processing: '处理中',
  saving_output: '保存中',
}

/**
 * 判断资产卡片是否可显示删除按钮
 *
 * 只有 source=uploaded_file 的资产才允许删除。
 * 其他来源（generation_record / canvas_asset）不走此删除路径。
 */
export function canDeleteAsset(item: AssetLibraryItem): boolean {
  return item.source === 'uploaded_file'
}

/**
 * 根据资产 kind + previewUrl 决定卡片缩略区的渲染类别
 *
 * - image/character/location：图片预览（需要 previewUrl）
 * - video/shot：视频预览（需要 previewUrl）
 * - text/subtitle/project：文本图标
 * - upload：按 URL 扩展名判断图片/视频，否则文件图标
 */
export function getAssetLibraryPreviewKind(item: AssetLibraryItem): AssetPreviewKind {
  switch (item.kind) {
    case 'image':
    case 'character':
    case 'location':
      return 'image'
    case 'video':
    case 'shot':
      return 'video'
    case 'text':
    case 'subtitle':
    case 'project':
      return 'text'
    case 'upload':
      if (item.previewUrl && isImageUrl(item.previewUrl))
        return 'image'
      if (item.previewUrl && isVideoUrl(item.previewUrl))
        return 'video'
      return 'file'
    default:
      return 'text'
  }
}

/** 合法的排序值（与 AssetLibrarySort 联合类型一一对应） */
const ALLOWED_SORTS: AssetLibrarySort[] = ['created_desc', 'created_asc', 'title_asc', 'title_desc']

/** 把 URL params 里的 sort 值规整为合法 AssetLibrarySort，非法/缺省回落 created_desc */
function resolveSortParam(raw: string | null): AssetLibrarySort {
  return raw && ALLOWED_SORTS.includes(raw as AssetLibrarySort) ? raw as AssetLibrarySort : 'created_desc'
}

// ── 创建时间区间预设（资产库筛选条） ────────────────────────────────────────

/**
 * 资产库「创建时间」筛选的预设区间。
 *
 * 不再用裸 `<input type="date">` 暴露起止日期，而是用一组高频预设
 * （全部 / 今天 / 最近 7 天 / 最近 30 天）。后端契约不变，前端把预设
 * 换算成 createdFrom/createdTo 写入 filter。URL 仍存真实日期，刷新可还原。
 */
export type AssetDateRangePreset = 'all' | 'today' | '7d' | '30d'

export const DATE_RANGE_OPTIONS: Array<{ value: AssetDateRangePreset, label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'today', label: '今天' },
  { value: '7d', label: '最近 7 天' },
  { value: '30d', label: '最近 30 天' },
]

/** 把「YYYY-MM-DD」格式化为当天本地零点 */
function toDateOnly(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * 根据预设区间换算 {createdFrom, createdTo}（本地日期，YYYY-MM-DD）。
 *
 * - all：不限制（空串）
 * - today：当天
 * - 7d/30d：从今天往前推 6/29 天（含当天），覆盖完整 7/30 天窗口
 *
 * @param preset 预设值
 * @param now    当前时间（可注入便于单测）
 */
export function resolveDateRange(
  preset: AssetDateRangePreset,
  now: Date = new Date(),
): { createdFrom: string, createdTo: string } {
  if (preset === 'all')
    return { createdFrom: '', createdTo: '' }
  const todayStr = toDateOnly(now)
  if (preset === 'today')
    return { createdFrom: todayStr, createdTo: todayStr }
  const days = preset === '7d' ? 6 : 29
  const from = new Date(now)
  from.setDate(now.getDate() - days)
  return { createdFrom: toDateOnly(from), createdTo: todayStr }
}

/**
 * 由真实 createdFrom/createdTo 反推预设区间（UI 高亮用）。
 *
 * 精确匹配 today/7d/30d 时返回对应预设，否则返回 null（表示自定义区间，
 * 当前 UI 不产生自定义区间，null 仅用于从 URL 还原未知值时的降级）。
 */
export function inferDateRangePreset(
  createdFrom: string,
  createdTo: string,
  now: Date = new Date(),
): AssetDateRangePreset | null {
  if (!createdFrom && !createdTo)
    return 'all'
  const todayStr = toDateOnly(now)
  for (const preset of ['today', '7d', '30d'] as const) {
    const range = resolveDateRange(preset, now)
    if (range.createdFrom === createdFrom && range.createdTo === createdTo)
      return preset
  }
  // today 边界：用户跨天访问时 createdTo 可能是昨天，单独容错
  if (createdFrom === todayStr)
    return 'today'
  return null
}

/** 页面本地筛选条件 — 与 URL query 同步，服务端下推过滤 */
export interface AssetLibraryFilters {
  source: 'all' | AssetLibrarySource
  kind: 'all' | AssetLibraryKind
  status: 'all' | AssetLibraryStatusFilter
  /** 关键词搜索（空字符串=不过滤） */
  search: string
  /** 模型精确匹配（空字符串=不过滤） */
  model: string
  /** 创建时间下界（ISO 日期字符串，空=不过滤） */
  createdFrom: string
  /** 创建时间上界（ISO 日期字符串，空=不过滤） */
  createdTo: string
  /** 排序方式 */
  sort: AssetLibrarySort
  /** 仅看收藏（true=只返回当前用户已收藏的资产） */
  favorite: boolean
  /** 按标签筛选（tagId 数组，OR 关系） */
  tagIds: string[]
}

export const DEFAULT_FILTERS: AssetLibraryFilters = {
  source: 'all',
  kind: 'all',
  status: 'all',
  search: '',
  model: '',
  createdFrom: '',
  createdTo: '',
  sort: 'created_desc',
  favorite: false,
  tagIds: [],
}

/** 从 URLSearchParams 解析筛选条件，缺省值用 DEFAULT_FILTERS */
export function normalizeAssetLibraryFiltersFromSearchParams(params: URLSearchParams): AssetLibraryFilters {
  return {
    source: (params.get('source') as 'all' | AssetLibrarySource) ?? DEFAULT_FILTERS.source,
    kind: (params.get('kind') as 'all' | AssetLibraryKind) ?? DEFAULT_FILTERS.kind,
    status: (params.get('status') as 'all' | AssetLibraryStatusFilter) ?? DEFAULT_FILTERS.status,
    search: params.get('search') ?? DEFAULT_FILTERS.search,
    model: params.get('model') ?? DEFAULT_FILTERS.model,
    createdFrom: params.get('createdFrom') ?? DEFAULT_FILTERS.createdFrom,
    createdTo: params.get('createdTo') ?? DEFAULT_FILTERS.createdTo,
    sort: resolveSortParam(params.get('sort')),
    favorite: params.get('favorite') === 'true',
    tagIds: params.get('tagIds')?.split(',').map(s => s.trim()).filter(Boolean) ?? [],
  }
}

/** 生成稳定的 React Query query key */
export function createAssetLibraryQueryKey(filters: AssetLibraryFilters, projectId: string | null, limit: number): readonly unknown[] {
  return ['asset-library', filters, projectId, limit] as const
}

/**
 * 客户端二次筛选 — 对已加载的 items 按 source/kind/status 过滤
 *
 * 用于筛选栏交互：服务端已按相同语义过滤，但页面统一加载后本地筛选可避免重复请求。
 * status 使用统一过滤语义（running=生成中、queued=排队中），与 /api/assets 一致。
 */
export function filterAssetLibraryItems(items: AssetLibraryItem[], filters: AssetLibraryFilters): AssetLibraryItem[] {
  return items.filter((item) => {
    if (filters.source !== 'all' && item.source !== filters.source)
      return false
    if (filters.kind !== 'all' && item.kind !== filters.kind)
      return false
    if (filters.status !== 'all' && !matchesUnifiedStatus(item.status, filters.status))
      return false
    // search 本地兜底过滤（主路径是服务端下推，此处做本地二次筛选）
    if (filters.search) {
      const q = filters.search.toLowerCase()
      const haystack = [item.title, item.model, item.prompt].filter(Boolean).join(' ').toLowerCase()
      if (!haystack.includes(q))
        return false
    }
    return true
  })
}

/** 统一 status 过滤值 → 原始 status 是否匹配 */
function matchesUnifiedStatus(rawStatus: string, unified: AssetLibraryStatusFilter): boolean {
  switch (unified) {
    case 'succeeded': return rawStatus === 'succeeded'
    case 'failed': return rawStatus === 'failed'
    case 'cancelled': return rawStatus === 'cancelled'
    case 'running': return ['submitting', 'processing', 'saving_output', 'running'].includes(rawStatus)
    case 'queued': return ['pending', 'queued'].includes(rawStatus)
    default: return true
  }
}

/** 统计卡片聚合 — 按来源、kind、状态汇总 */
export interface AssetLibraryStats {
  total: number
  bySource: Record<AssetLibrarySource, number>
  byKind: Record<AssetLibraryKind, number>
  succeeded: number
  failed: number
  running: number
}

const EMPTY_STATS: AssetLibraryStats = {
  total: 0,
  bySource: { generation_record: 0, canvas_asset: 0, uploaded_file: 0 },
  byKind: { image: 0, video: 0, text: 0, subtitle: 0, audio: 0, upload: 0, character: 0, location: 0, shot: 0, project: 0 },
  succeeded: 0,
  failed: 0,
  running: 0,
}

/** 从 items 计算统计卡片数据 */
export function buildAssetLibraryStats(items: AssetLibraryItem[]): AssetLibraryStats {
  const stats: AssetLibraryStats = {
    total: items.length,
    bySource: { ...EMPTY_STATS.bySource },
    byKind: { ...EMPTY_STATS.byKind },
    succeeded: 0,
    failed: 0,
    running: 0,
  }

  for (const item of items) {
    stats.bySource[item.source] = (stats.bySource[item.source] ?? 0) + 1
    stats.byKind[item.kind] = (stats.byKind[item.kind] ?? 0) + 1
    if (matchesUnifiedStatus(item.status, 'succeeded'))
      stats.succeeded += 1
    else if (matchesUnifiedStatus(item.status, 'failed'))
      stats.failed += 1
    else if (matchesUnifiedStatus(item.status, 'running'))
      stats.running += 1
  }

  return stats
}

/**
 * 构造”打开 Canvas 项目”跳转目标
 *
 * 有 projectId 的资产（Canvas 资产、部分生成记录）可回到项目编辑器。
 */
export function getCanvasProjectUrl(item: AssetLibraryItem): string | null {
  return item.projectId ? `/canvas/${item.projectId}` : null
}

// ── 子模块 re-export（向后兼容，保持对外 API 不变）────────────

export {
  findProjectLabel,
  formatProjectOptionLabel,
  getCanvasAssetUrl,
  getCanvasFocusParam,
  getCanvasSourceLabel,
  parseFocusParam,
  resolveFocusNodeWithProject,
} from './canvas-deep-link'
export type { FocusProjectLike } from './canvas-deep-link'

export {
  assetToShotReferenceAsset,
  inferReferenceRole,
  isReferenceAssetAdded,
  isReferenceAssetCandidate,
  MAX_SHOT_REFERENCE_ASSETS,
  mergeShotReferenceAssets,
  previewApplyReferenceAssets,
} from './shot-reference-assets'
