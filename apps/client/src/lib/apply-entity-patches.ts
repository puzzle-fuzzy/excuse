import type { CanvasEntityPatch, CanvasShotStatus, ProjectDTO } from '@excuse/shared'

/**
 * SSE pipeline_node_update 的实体状态 → CanvasShotStatus。
 *
 * 后端实体事件只发 `running | completed | failed`，而 CanvasShotStatus 用
 * `generating`（而非 `running`）表达「生成中」。直接透传会把非法值写入 shot.status，
 * 破坏类型不变量并可能导致渲染分支误判。未知 status 返回 null —— 该实体本次不 patch，
 * 由 {@link useCanvasAssetsPolling} 的 hasCanvasPollDelta 兜底收敛。
 */
function sseStatusToShotStatus(status: string): CanvasShotStatus | null {
  switch (status) {
    case 'running':
      return 'generating'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    default:
      return null
  }
}

/**
 * 将实体补丁原位应用到项目，避免 projectVersion 递增触发的全量 reload。
 *
 * **仅 shot 有可即时 patch 的字段**（status / errorMessage / videoUrl）。
 * character / location 的参考图 URL 由后端写入 DB、不随 pipeline_node_update 事件下发
 * （`notifyNode` 的 data 目前为 `undefined`，见 server modules/canvas/references.ts），
 * 故其事件不在此 patch —— 新 URL / 新实体由轮询快照的 hasCanvasPollDelta 检测后触发 reload 收敛。
 *
 * 找不到 nodeId 的补丁（如 regenerate 产生的新实体、或已被删除的实体）会被跳过：
 * 新实体会被轮询的「not found」分支捕获并 reload，无需此处处理。
 *
 * 后端若将来在事件 data 里下发 videoUrl（events 包 mapGenerationNotifyToSSEEvents），
 * 下方条件分支会自动拾取，无需改本函数。
 */
export function applyEntityPatches(project: ProjectDTO, patches: CanvasEntityPatch[]): ProjectDTO {
  let updated = project

  for (const patch of patches) {
    if (patch.nodeType !== 'shot')
      continue

    const status = sseStatusToShotStatus(patch.status)
    if (!status)
      continue

    updated = {
      ...updated,
      shots: updated.shots.map((s) => {
        if (s.id !== patch.nodeId)
          return s
        return {
          ...s,
          status,
          // completed 清空历史错误；failed 写入错误；running 保持原值
          errorMessage: patch.status === 'completed' ? null : (patch.error ?? s.errorMessage),
          ...(typeof patch.data?.videoUrl === 'string' ? { videoUrl: patch.data.videoUrl } : {}),
        }
      }),
    }
  }

  return updated
}
