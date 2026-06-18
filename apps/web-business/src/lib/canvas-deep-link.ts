/**
 * Canvas 深链 — 从资产条目推导 Canvas 项目跳转目标与 focus 定位
 *
 * 从 lib/asset-library.ts 拆分，原与资产筛选/统计/镜头参考混在一起。
 */
import type { AssetLibraryItem } from '@excuse/shared'

// ── Canvas 项目 URL 跳转 ─────────────────────────────────────────

/**
 * 构造"打开 Canvas 项目"跳转目标
 *
 * 有 projectId 的资产（Canvas 资产、部分生成记录）可回到项目编辑器。
 */
export function getCanvasProjectUrl(item: AssetLibraryItem): string | null {
  return item.projectId ? `/canvas/${item.projectId}` : null
}

// ── Canvas 深链（v1.2：资产来源精确定位）──────────────────────────

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
  // 项目级资产不加 focus — 避免误导用户以为"定位到了某个节点"
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
 * v1.2 更新：有 focus 深链时更精准（"定位角色节点"），
 * 无 focus 时沿用原有文案（"打开角色所在项目"）。
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

// ── Canvas focus 解析 ──────────────────────────────────────────

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

// ── Canvas 项目选择器辅助函数 ──────────────────────────────────

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
