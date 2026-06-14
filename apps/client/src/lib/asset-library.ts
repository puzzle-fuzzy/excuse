import type { AssetLibraryItem, AssetLibraryKind, AssetLibrarySource, AssetLibraryStatusFilter, CanvasShotReferenceAsset, CanvasShotReferenceRole } from '@excuse/shared'
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
  byKind: { image: 0, video: 0, text: 0, subtitle: 0, upload: 0, character: 0, location: 0, shot: 0, project: 0 },
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

// ── Canvas 深链（v1.2：资产来源精确定位）───────────────────────────────────

/**
 * 从资产条目推导 Canvas focus query 参数
 *
 * focus 参数约定：
 *   - character → char:<entityId>
 *   - location → loc:<entityId>
 *   - shot → shot:<entityId>
 *   - story / analysis → story / analysis（通用节点）
 *   - 其他/项目 → 不加 focus（避免误导）
 *
 * 非 canvas_asset 来源或无 projectId 时返回 null。
 */
export function getCanvasFocusParam(item: AssetLibraryItem): string | null {
  if (!item.projectId)
    return null

  if (item.targetEntityType === 'character' && item.targetEntityId)
    return `char:${item.targetEntityId}`
  if (item.targetEntityType === 'location' && item.targetEntityId)
    return `loc:${item.targetEntityId}`
  if (item.targetEntityType === 'shot' && item.targetEntityId)
    return `shot:${item.targetEntityId}`
  // 项目级资产不加 focus — 避免误导用户以为”定位到了某个节点”
  return null
}

/**
 * 生成带 focus 深链的 Canvas 资产 URL
 *
 * 有 projectId + 可定位的 targetEntityType → /canvas/:projectId?focus=xxx
 * 有 projectId 但无具体实体 → /canvas/:projectId（不加 focus）
 * 无 projectId → null
 */
export function getCanvasAssetUrl(item: AssetLibraryItem): string | null {
  if (!item.projectId)
    return null
  const focus = getCanvasFocusParam(item)
  if (!focus)
    return `/canvas/${item.projectId}`
  return `/canvas/${item.projectId}?focus=${focus}`
}

/** focus 可定位的实体类型 → 按钮文案 */
const CANVAS_FOCUS_LABELS: Record<string, string> = {
  character: '定位角色节点',
  location: '定位场景节点',
  shot: '定位镜头节点',
}

/**
 * 根据 targetEntityType 返回来源定位按钮文案
 *
 * v1.2 更新：有 focus 深链时更精准（”定位角色节点”），
 * 无 focus 时沿用原有文案（”打开角色所在项目”）。
 */
export function getCanvasSourceLabel(item: AssetLibraryItem): string {
  if (!item.projectId)
    return ''
  const focus = getCanvasFocusParam(item)
  if (focus)
    return CANVAS_FOCUS_LABELS[item.targetEntityType ?? ''] ?? '定位节点'
  // 无 focus 时沿用原有通用文案
  switch (item.targetEntityType) {
    case 'character': return '打开角色所在项目'
    case 'location': return '打开场景所在项目'
    case 'shot': return '打开镜头所在项目'
    default: return '打开项目'
  }
}

/**
 * Canvas 深链 focus 解析 — 将 URL focus 参数转换为 ReactFlow 节点定位信息
 *
 * 约定：
 *   story → { id: 'story', type: 'storyInput' }
 *   analysis → { id: 'analysis', type: 'analysis' }
 *   char:<id> → { id: 'char-<id>', type: 'character' }
 *   loc:<id> → { id: 'loc-<id>', type: 'location' }
 *   shot:<id> → { id: 'shot-<id>', type: 'shot' }
 *   continuity → { id: 'continuity', type: 'continuityCheck' }
 *
 * 无效 focus → null（不报错，忽略即可）
 *
 * 第二步校验（resolveFocusNodeWithProject）在项目数据加载后验证实体是否存在。
 */
export function parseFocusParam(focus: string | null): { id: string, type: string } | null {
  if (!focus)
    return null

  // 固定节点名
  if (focus === 'story')
    return { id: 'story', type: 'storyInput' }
  if (focus === 'analysis')
    return { id: 'analysis', type: 'analysis' }
  if (focus === 'continuity')
    return { id: 'continuity', type: 'continuityCheck' }

  // 实体引用格式：char:<id> / loc:<id> / shot:<id>
  const colonIdx = focus.indexOf(':')
  if (colonIdx === -1)
    return null
  const prefix = focus.slice(0, colonIdx)
  const entityId = focus.slice(colonIdx + 1)
  if (!entityId)
    return null

  switch (prefix) {
    case 'char': return { id: `char-${entityId}`, type: 'character' }
    case 'loc': return { id: `loc-${entityId}`, type: 'location' }
    case 'shot': return { id: `shot-${entityId}`, type: 'shot' }
    default: return null
  }
}

/** ProjectDTO 最小接口 — resolveFocusNodeWithProject 只读 id + 子资源列表 */
export interface FocusProjectLike {
  characters: Array<{ id: string }>
  locations: Array<{ id: string }>
  shots: Array<{ id: string }>
  analysis: unknown | null
  continuityIssues: Array<unknown>
}

/**
 * 在项目数据加载后校验 focus 目标是否真实存在
 *
 * - char:<id> → characters 中必须有对应 id
 * - loc:<id> → locations 中必须有对应 id
 * - shot:<id> → shots 中必须有对应 id
 * - analysis → project.analysis 必须存在
 * - continuity → continuityIssues.length > 0
 * - story → 总是存在（每个项目都有故事文本节点）
 *
 * 不存在时返回 null（静默忽略，不报错）。
 */
export function resolveFocusNodeWithProject(
  focus: string | null,
  project: FocusProjectLike,
): { id: string, type: string } | null {
  const parsed = parseFocusParam(focus)
  if (!parsed)
    return null

  switch (parsed.type) {
    case 'storyInput':
      return parsed // story 总是存在
    case 'analysis':
      return project.analysis ? parsed : null
    case 'character':
      return project.characters.some(c => c.id === parsed.id.slice('char-'.length)) ? parsed : null
    case 'location':
      return project.locations.some(l => l.id === parsed.id.slice('loc-'.length)) ? parsed : null
    case 'shot':
      return project.shots.some(s => s.id === parsed.id.slice('shot-'.length)) ? parsed : null
    case 'continuityCheck':
      return project.continuityIssues.length > 0 ? parsed : null
    default:
      return null
  }
}

// ── Canvas 项目选择器辅助函数 ──────────────────────────────────────────────────

/** 项目选项标签 — 有标题用标题，无标题用 id 前 8 位 */
export function formatProjectOptionLabel(project: { id: string, title: string | null }): string {
  return project.title || `未命名项目 (${project.id.slice(0, 8)})`
}

/** 在项目列表中找到 projectId 对应的显示标签 */
export function findProjectLabel(projects: Array<{ id: string, title: string | null }>, projectId: string | null): string {
  if (!projectId)
    return ''
  const project = projects.find(p => p.id === projectId)
  return project ? formatProjectOptionLabel(project) : projectId.slice(0, 8)
}

// ── 镜头参考资产选择（P1-2 v0.2）─────────────────────────────────────────────

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
