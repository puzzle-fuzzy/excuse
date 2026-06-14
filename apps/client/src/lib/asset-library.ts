import type { AssetLibraryItem, AssetLibraryKind, AssetLibrarySource, AssetLibraryStatusFilter } from '@excuse/shared'
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

/**
 * 根据 targetEntityType 返回来源定位按钮文案
 *
 * Canvas 资产可按实体类型显示更具体的按钮文案：
 *   - character → “打开角色所在项目”
 *   - location → “打开场景所在项目”
 *   - shot → “打开镜头所在项目”
 *   - 其他 → “打开项目”
 *
 * 无 projectId 时返回空字符串（不显示按钮）。
 */
export function getCanvasSourceLabel(item: AssetLibraryItem): string {
  if (!item.projectId)
    return ''
  switch (item.targetEntityType) {
    case 'character': return '打开角色所在项目'
    case 'location': return '打开场景所在项目'
    case 'shot': return '打开镜头所在项目'
    default: return '打开项目'
  }
}
