import type { CanvasPipelineRunDTO, CanvasPipelineRunListResponse } from '@excuse/shared'
import { api, unwrapEden } from './client'

// ===== 资产历史与选择 =====

export interface CanvasAssetDTO {
  id: string
  projectId: string
  category: string
  targetEntityType: string
  targetEntityId: string
  status: string
  model: string | null
  inputJson: Record<string, unknown> | null
  outputJson: Record<string, unknown> | null
  publicUrl: string | null
  storagePath: string | null
  providerUrl: string | null
  errorMessage: string | null
  isActive: boolean
  locked: boolean
  createdAt: string
  updatedAt: string
}

/** 查询目标实体（角色/场景/镜头）的历史资产 */
export async function listCanvasAssetsByTarget(targetEntityType: string, targetEntityId: string): Promise<CanvasAssetDTO[]> {
  const res = await unwrapEden<{ success: boolean, data: CanvasAssetDTO[] }>(
    await api.api.canvas.assets({ targetEntityType })({ targetEntityId }).get(),
  )
  return res.data
}

/** 将资产设为当前活跃版本（同时取消其他同类别资产的 isActive） */
export async function activateCanvasAsset(assetId: string): Promise<CanvasAssetDTO> {
  const res = await unwrapEden<{ success: boolean, data: CanvasAssetDTO }>(
    await api.api.canvas.asset({ assetId }).activate.patch(),
  )
  return res.data
}

/** 设置资产锁定状态（锁定后不会被后续生成自动覆盖） */
export async function lockCanvasAsset(assetId: string, locked: boolean): Promise<CanvasAssetDTO> {
  const res = await unwrapEden<{ success: boolean, data: CanvasAssetDTO }>(
    await api.api.canvas.asset({ assetId }).lock.patch({ locked }),
  )
  return res.data
}

// ===== Pipeline 运行记录 =====

export async function fetchCanvasPipelineRuns(projectId: string): Promise<CanvasPipelineRunDTO[]> {
  const res = await unwrapEden<CanvasPipelineRunListResponse>(
    await api.api.canvas.projects({ projectId }).runs.get(),
  )
  return res.items
}

export function getActivePipelineRun(runs: CanvasPipelineRunDTO[]): CanvasPipelineRunDTO | null {
  return runs.find(r => r.status === 'pending' || r.status === 'running') ?? null
}
