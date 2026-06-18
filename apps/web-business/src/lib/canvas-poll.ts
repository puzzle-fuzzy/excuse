import type { CanvasAssetsPoll, CanvasProjectStatus, CanvasShotStatus } from '@excuse/shared'

/**
 * 轮询差异比对所需的最小项目切片。
 *
 * 用窄类型而非完整 {@link ProjectDTO}，既让本模块只声明真正依赖的字段，
 * 又让测试可以用最小 fixture 驱动；完整 ProjectDTO 结构上满足此类型，
 * 因此 CanvasEditor 可直接传入。
 */
export interface CanvasPollDeltaTarget {
  status: CanvasProjectStatus
  characters: Array<{ id: string, referenceImageUrl: string | null, turnaroundSheetUrl: string | null }>
  locations: Array<{ id: string, referenceImageUrl: string | null }>
  shots: Array<{ id: string, status: CanvasShotStatus }>
}

/**
 * 检测 pollData 与本地 project 之间是否存在需要重新加载项目的差异。
 *
 * SSE 降级（polling fallback）时的兜底通道：当 SSE 断开或漏事件时，
 * 前端拿到的轮询快照与本地 project 比对，发现状态/资产变化即触发 loadProject，
 * 让页面最终收敛到正确状态，不必依赖手动刷新。
 *
 * 比对维度：
 *   1. 项目状态（projectStatus）——阶段推进、完成、失败
 *   2. 镜头状态（shot.status）——视频生成中/完成/失败
 *   3. 角色参考图/转面图 URL——characterRefs 阶段逐个完成的图片，
 *      SSE 断线时只能靠轮询的 URL 变化发现，否则要等到阶段结束才回显
 *   4. 场景参考图 URL——locationRefs 同理
 */
export function hasCanvasPollDelta(project: CanvasPollDeltaTarget, pollData: CanvasAssetsPoll): boolean {
  if (pollData.projectStatus !== project.status)
    return true

  // 镜头状态（视频生成进度）
  for (const ps of pollData.shots) {
    const projectShot = project.shots.find(s => s.id === ps.shotId)
    if (projectShot?.status !== ps.status)
      return true
  }

  // 角色参考图/转面图：polling 模式下逐个完成只能靠 URL 比对发现
  for (const pc of pollData.characters) {
    const projectChar = project.characters.find(c => c.id === pc.characterId)
    if (!projectChar)
      return true
    if (projectChar.referenceImageUrl !== pc.referenceImageUrl)
      return true
    if (projectChar.turnaroundSheetUrl !== pc.turnaroundSheetUrl)
      return true
  }

  // 场景参考图
  for (const pl of pollData.locations) {
    const projectLoc = project.locations.find(l => l.id === pl.locationId)
    if (!projectLoc)
      return true
    if (projectLoc.referenceImageUrl !== pl.referenceImageUrl)
      return true
  }

  return false
}

/**
 * 从轮询快照构建「角色/场景 → 活跃图片任务 ID」映射。
 *
 * buildNodesAndEdges 用此结果给 CharacterNode/LocationNode 注入 activeImageTaskIds，
 * 从而在图片生成期间显示「正在生成参考图…」占位与「生成中」角标。
 * 抽成纯函数便于单测，避免 React 组件内嵌的映射逻辑无法被覆盖。
 *
 * @returns 两个 Map，只包含有活跃任务的实体；无活跃任务或 pollData 为空时返回空 Map
 */
export function buildActiveImageTaskMaps(pollData: CanvasAssetsPoll | null | undefined): {
  character: Map<string, string[]>
  location: Map<string, string[]>
} {
  const character = new Map<string, string[]>()
  const location = new Map<string, string[]>()

  if (!pollData)
    return { character, location }

  for (const c of pollData.characters) {
    if (c.activeImageTaskIds.length > 0)
      character.set(c.characterId, c.activeImageTaskIds)
  }
  for (const l of pollData.locations) {
    if (l.activeImageTaskIds.length > 0)
      location.set(l.locationId, l.activeImageTaskIds)
  }

  return { character, location }
}
