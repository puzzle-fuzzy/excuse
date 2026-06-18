/**
 * BGM 生成服务 — Phase 10
 *
 * 从项目故事摘要 + 镜头主导情绪，调用 FunMusic (fun-music-v1) 生成 BGM，
 * 转存 OSS 并写入 canvas_projects.bgm_url。
 */

import type { DashScopeClient } from '@excuse/provider'
import type { AssetStorage } from '@excuse/storage'
import { getCanvasProjectDetail, updateCanvasProject } from '@excuse/db'
import { NotFoundError } from '../../utils/app-errors'
import { createServerProviderAdapter } from './adapter-factory'

export async function generateBgm(projectId: string, client: DashScopeClient, storage: AssetStorage) {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new NotFoundError('项目不存在')

  const { runBgmPhase } = await import('@excuse/canvas-runtime')

  const provider = createServerProviderAdapter()

  const result = await runBgmPhase({ projectId, detail, client, storage, provider })

  await updateCanvasProject(projectId, { bgmUrl: result.audioUrl })

  return result
}
