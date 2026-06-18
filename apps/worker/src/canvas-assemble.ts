import type { AssetStorage } from '@excuse/storage'
import { runAssemblePhase } from '@excuse/canvas-runtime'
import { getCanvasProjectDetail, updateCanvasProject } from '@excuse/db'
import { createWorkerFfmpegAdapter } from './canvas-adapter-factory'
import { checkTaskOwnership } from './task-ownership'

export interface CanvasAssembleResult extends Record<string, unknown> {
  phase: 'assemble'
  projectId: string
  finalVideoUrl: string
  shotsConcatenated: number
  bgmOverlaid: boolean
}

/**
 * Canvas assemble 阶段执行核心
 *
 * 拼接所有已完成镜头视频 + 叠加 BGM，产出最终合成视频，写回 canvas_projects.final_video_url。
 * run 状态流转与 PG NOTIFY 由 handler 信封（canvas-handlers.ts）负责。
 *
 * 子操作间调用 `checkTaskOwnership()` — 如果 heartbeat 续锁失败，
 * 立即中止而非继续数分钟 FFmpeg 到最后才发现锁丢失。
 */
export async function executeCanvasAssemble(
  projectId: string,
  storage: AssetStorage,
  storageRoot: string,
): Promise<CanvasAssembleResult> {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')

  const ffmpeg = createWorkerFfmpegAdapter()
  const result = await runAssemblePhase({
    projectId,
    detail,
    storage,
    storageRoot,
    ffmpeg,
    onCheckpoint: checkTaskOwnership,
  })
  await updateCanvasProject(projectId, { finalVideoUrl: result.finalVideoUrl })

  return {
    phase: 'assemble',
    projectId,
    finalVideoUrl: result.finalVideoUrl,
    shotsConcatenated: result.shotsConcatenated,
    bgmOverlaid: result.bgmOverlaid,
  }
}
