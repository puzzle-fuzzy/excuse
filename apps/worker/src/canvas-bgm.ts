import type { DashScopeClient } from '@excuse/provider'
import type { AssetStorage } from '@excuse/storage'
import { runBgmPhase } from '@excuse/canvas-runtime'
import { getCanvasProjectDetail, updateCanvasProject } from '@excuse/db'

export interface CanvasBgmResult extends Record<string, unknown> {
  phase: 'bgm'
  projectId: string
  bgmUrl: string
  durationSeconds: number
}

/**
 * Canvas bgm 阶段执行核心
 *
 * 基于 story summary + 镜头主导情绪生成 BGM，转存到长期存储后写回 canvas_projects.bgm_url。
 * run 状态流转与 PG NOTIFY 由 handler 信封（canvas-handlers.ts）负责。
 */
export async function executeCanvasBgm(
  projectId: string,
  client: DashScopeClient,
  storage: AssetStorage,
): Promise<CanvasBgmResult> {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')

  const result = await runBgmPhase({ projectId, detail, client, storage })
  await updateCanvasProject(projectId, { bgmUrl: result.audioUrl })

  return {
    phase: 'bgm',
    projectId,
    bgmUrl: result.audioUrl,
    durationSeconds: result.durationSeconds,
  }
}
