import type { AcceptedResponse, CanvasAssetsPoll, CanvasAssetsPollResponse, CanvasCharacterResponse, CanvasLocationResponse, CanvasMutationOkResponse, CanvasPipelineRunDTO, CanvasPipelineRunListResponse, CanvasProjectListResponse, CanvasProjectResponse, CanvasProjectSummaryResponse, CanvasShotResponse } from '@excuse/shared'
import { api, unwrapEden } from './client'

// ===== Canvas 流水线 API =====

export async function createCanvasProject(params: {
  title?: string
  storyText: string
}): Promise<CanvasProjectResponse> {
  return unwrapEden<CanvasProjectResponse>(
    await api.api.canvas.projects.post(params),
  )
}

export async function listCanvasProjects(): Promise<CanvasProjectListResponse> {
  return unwrapEden<CanvasProjectListResponse>(
    await api.api.canvas.projects.get(),
  )
}

export async function getCanvasProject(projectId: string): Promise<CanvasProjectResponse> {
  return unwrapEden<CanvasProjectResponse>(
    await api.api.canvas.projects({ projectId }).get(),
  )
}

/** 获取 Canvas 项目摘要（轻量版）— 主画布渲染，不含实体 JSONB 大字段 */
export async function fetchCanvasProjectSummary(projectId: string): Promise<CanvasProjectSummaryResponse> {
  return unwrapEden<CanvasProjectSummaryResponse>(
    await api.api.canvas.projects({ projectId }).summary.get(),
  )
}

/** 按需加载角色详情（供右侧详情面板使用） */
export async function fetchCanvasCharacterDetail(characterId: string): Promise<CanvasCharacterResponse> {
  return unwrapEden<CanvasCharacterResponse>(
    await api.api.canvas.characters({ characterId }).detail.get(),
  )
}

/** 按需加载场景详情（供右侧详情面板使用） */
export async function fetchCanvasLocationDetail(locationId: string): Promise<CanvasLocationResponse> {
  return unwrapEden<CanvasLocationResponse>(
    await api.api.canvas.locations({ locationId }).detail.get(),
  )
}

/** 按需加载镜头详情（供右侧详情面板使用） */
export async function fetchCanvasShotDetail(shotId: string): Promise<CanvasShotResponse> {
  return unwrapEden<CanvasShotResponse>(
    await api.api.canvas.shots({ shotId }).detail.get(),
  )
}

/** 轮询 Canvas 项目资产快照 — SSE 降级或补充性数据通道 */
export async function pollCanvasAssets(projectId: string): Promise<CanvasAssetsPoll> {
  const res = unwrapEden<CanvasAssetsPollResponse>(
    await api.api.canvas.projects({ projectId }).assets.poll.get(),
  )
  return res.data
}

export async function deleteCanvasProject(projectId: string): Promise<CanvasMutationOkResponse> {
  return unwrapEden<CanvasMutationOkResponse>(
    await api.api.canvas.projects({ projectId }).delete(),
  )
}

/** 更新项目标题/故事文本 */
export async function updateCanvasProject(projectId: string, patch: { title?: string, storyText?: string }): Promise<CanvasProjectResponse> {
  return unwrapEden<CanvasProjectResponse>(
    await api.api.canvas.projects({ projectId }).patch(patch),
  )
}

export async function analyzeCanvasProject(projectId: string): Promise<AcceptedResponse> {
  return unwrapEden<AcceptedResponse>(
    await api.api.canvas.projects({ projectId }).analyze.post(),
  )
}

export async function generateCanvasCharacters(projectId: string): Promise<AcceptedResponse> {
  return unwrapEden<AcceptedResponse>(
    await api.api.canvas.projects({ projectId }).characters.post(),
  )
}

export async function generateCanvasLocations(projectId: string): Promise<AcceptedResponse> {
  return unwrapEden<AcceptedResponse>(
    await api.api.canvas.projects({ projectId }).locations.post(),
  )
}

export async function generateCanvasCharacterRefs(projectId: string): Promise<AcceptedResponse> {
  return unwrapEden<AcceptedResponse>(
    await api.api.canvas.projects({ projectId })['character-refs'].post(),
  )
}

export async function generateCanvasLocationRefs(projectId: string): Promise<AcceptedResponse> {
  return unwrapEden<AcceptedResponse>(
    await api.api.canvas.projects({ projectId })['location-refs'].post(),
  )
}

export async function generateCanvasStoryboard(projectId: string): Promise<AcceptedResponse> {
  return unwrapEden<AcceptedResponse>(
    await api.api.canvas.projects({ projectId }).storyboard.post(),
  )
}

export async function checkCanvasContinuity(projectId: string): Promise<AcceptedResponse> {
  return unwrapEden<AcceptedResponse>(
    await api.api.canvas.projects({ projectId }).continuity.post(),
  )
}

export async function rebuildCanvasPrompts(projectId: string): Promise<AcceptedResponse> {
  return unwrapEden<AcceptedResponse>(
    await api.api.canvas.projects({ projectId })['rebuild-prompts'].post(),
  )
}

export async function generateCanvasVideos(projectId: string): Promise<AcceptedResponse> {
  return unwrapEden<AcceptedResponse>(
    await api.api.canvas.projects({ projectId })['generate-videos'].post(),
  )
}

/** 对白层 — 为每个 shot 生成对话/语气/环境音效 prompt（dialogue 阶段） */
export async function generateCanvasDialogue(projectId: string): Promise<AcceptedResponse> {
  return unwrapEden<AcceptedResponse>(
    await api.api.canvas.projects({ projectId }).dialogue.post(),
  )
}

/** 生成配乐 — FunMusic 按 genre/mood 生成 BGM（bgm 阶段） */
export async function generateCanvasBgm(projectId: string): Promise<AcceptedResponse> {
  return unwrapEden<AcceptedResponse>(
    await api.api.canvas.projects({ projectId }).bgm.post(),
  )
}

/** 合成成片 — FFmpeg 拼接镜头视频 + BGM（assemble 阶段，pause-before） */
export async function assembleCanvas(projectId: string): Promise<AcceptedResponse> {
  return unwrapEden<AcceptedResponse>(
    await api.api.canvas.projects({ projectId }).assemble.post(),
  )
}

export async function saveCanvasLayout(projectId: string, layout: import('@excuse/shared').CanvasLayoutDto): Promise<CanvasMutationOkResponse> {
  return unwrapEden<CanvasMutationOkResponse>(
    await api.api.canvas.projects({ projectId }).layout.post(layout),
  )
}

export async function updateCanvasModelPreferences(
  projectId: string,
  prefs: { textModel?: string, imageModel?: string, videoModel?: string, autoProgress?: boolean },
): Promise<CanvasProjectResponse> {
  return unwrapEden<CanvasProjectResponse>(
    await api.api.canvas.projects({ projectId })['model-preferences'].patch(prefs),
  )
}

export async function updateCanvasCharacter(characterId: string, patch: {
  name?: string
  role?: string
  description?: string
  identityPrompt?: string
  negativePrompt?: string
  referenceImageUrl?: string
  turnaroundSheetUrl?: string
  locked?: boolean
}): Promise<CanvasCharacterResponse> {
  return unwrapEden<CanvasCharacterResponse>(
    await api.api.canvas.characters({ characterId }).patch(patch),
  )
}

export async function updateCanvasLocation(locationId: string, patch: {
  name?: string
  type?: string
  scenePrompt?: string
  negativePrompt?: string
  referenceImageUrl?: string
  locked?: boolean
}): Promise<CanvasLocationResponse> {
  return unwrapEden<CanvasLocationResponse>(
    await api.api.canvas.locations({ locationId }).patch(patch),
  )
}

export async function updateCanvasShot(shotId: string, patch: {
  duration?: number
  locationId?: string
  characterIdsJson?: string[]
  narrative?: string
  cameraJson?: { shotSize: string, angle: string, movement: string, lens: string }
  environmentJson?: { backgroundMotion?: string, lighting?: string, mood?: string, style?: string }
  videoPrompt?: string
  referenceAssetsJson?: Array<{ assetId: string, url: string, role: 'character' | 'location' | 'style' | 'firstFrame' | 'other', label?: string, source?: 'asset_library' | 'uploaded_file' | 'manual' }>
}): Promise<CanvasShotResponse> {
  return unwrapEden<CanvasShotResponse>(
    await api.api.canvas.shots({ shotId }).patch(patch),
  )
}

/** 批量应用参考资产到多个镜头 */
export interface ApplyShotReferenceAssetsResponse {
  success: boolean
  applied: Array<{
    shotId: string
    beforeCount: number
    afterCount: number
    addedCount: number
    truncatedCount: number
  }>
}

export async function applyShotReferenceAssets(
  projectId: string,
  params: {
    sourceShotId?: string
    targetShotIds: string[]
    referenceAssetsJson: Array<{ assetId: string, url: string, role: 'character' | 'location' | 'style' | 'firstFrame' | 'other', label?: string, source?: 'asset_library' | 'uploaded_file' | 'manual' }>
    mode: 'append' | 'replace'
  },
): Promise<ApplyShotReferenceAssetsResponse> {
  return unwrapEden<ApplyShotReferenceAssetsResponse>(
    await api.api.canvas.projects({ projectId }).shots['reference-assets'].apply.post(params),
  )
}

export async function deleteCanvasCharacter(characterId: string): Promise<CanvasMutationOkResponse> {
  return unwrapEden<CanvasMutationOkResponse>(
    await api.api.canvas.characters({ characterId }).delete(),
  )
}

export async function deleteCanvasLocation(locationId: string): Promise<CanvasMutationOkResponse> {
  return unwrapEden<CanvasMutationOkResponse>(
    await api.api.canvas.locations({ locationId }).delete(),
  )
}

export async function deleteCanvasShot(shotId: string): Promise<CanvasMutationOkResponse> {
  return unwrapEden<CanvasMutationOkResponse>(
    await api.api.canvas.shots({ shotId }).delete(),
  )
}

export async function retryCanvasShot(shotId: string): Promise<AcceptedResponse> {
  return unwrapEden<AcceptedResponse>(
    await api.api.canvas.shots({ shotId }).retry.post(),
  )
}

export async function retryFailedCanvasShots(projectId: string): Promise<AcceptedResponse> {
  return unwrapEden<AcceptedResponse>(
    await api.api.canvas.projects({ projectId })['retry-failed-shots'].post(),
  )
}

/** 终止当前活跃阶段 — 取消 pipeline run + 关联 task + 活跃 canvas_assets */
export async function cancelCanvasActivePhase(projectId: string): Promise<{ cancelled: number, message: string }> {
  return unwrapEden<{ cancelled: number, message: string }>(
    await api.api.canvas.projects({ projectId })['cancel-active'].post(),
  )
}

export async function fetchCanvasPipelineRuns(projectId: string): Promise<CanvasPipelineRunDTO[]> {
  const res = await unwrapEden<CanvasPipelineRunListResponse>(
    await api.api.canvas.projects({ projectId }).runs.get(),
  )
  return res.items
}

export function getActivePipelineRun(runs: CanvasPipelineRunDTO[]): CanvasPipelineRunDTO | null {
  return runs.find(r => r.status === 'pending' || r.status === 'running') ?? null
}

// ── 单个实体重新生成 ──────────────────────────────────

export async function regenerateCanvasCharacter(characterId: string): Promise<AcceptedResponse> {
  return unwrapEden<AcceptedResponse>(
    await api.api.canvas.characters({ characterId }).regenerate.post(),
  )
}

export async function regenerateCanvasLocation(locationId: string): Promise<AcceptedResponse> {
  return unwrapEden<AcceptedResponse>(
    await api.api.canvas.locations({ locationId }).regenerate.post(),
  )
}

export async function regenerateCanvasShot(shotId: string): Promise<AcceptedResponse> {
  return unwrapEden<AcceptedResponse>(
    await api.api.canvas.shots({ shotId }).regenerate.post(),
  )
}

// ── 资产历史与选择 ──────────────────────────────────

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
