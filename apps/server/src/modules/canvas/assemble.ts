/**
 * 合成服务 — Phase 11
 *
 * 把项目已完成镜头视频拼接为最终视频（含对话音频），可选叠加 BGM，
 * 上传存储并写入 canvas_projects.final_video_url。
 */

import type { DashScopeClient } from '@excuse/provider'
import type { AssetStorage } from '@excuse/storage'
import { getCanvasProjectDetail, updateCanvasProject } from '@excuse/db'
import { NotFoundError } from '../../utils/app-errors'

export async function assembleProject(
  projectId: string,
  _client: DashScopeClient,
  storage: AssetStorage,
  storageRoot: string,
) {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new NotFoundError('项目不存在')

  const { runAssemblePhase } = await import('@excuse/canvas-runtime')

  const result = await runAssemblePhase({ projectId, detail, storage, storageRoot })

  await updateCanvasProject(projectId, { finalVideoUrl: result.finalVideoUrl })

  return result
}
