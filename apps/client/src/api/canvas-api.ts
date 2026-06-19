import type { AcceptedResponse, CanvasAssetsPoll, CanvasAssetsPollResponse, CanvasCharacterResponse, CanvasLocationResponse, CanvasMutationOkResponse, CanvasProjectListResponse, CanvasProjectResponse, CanvasProjectSummaryResponse, CanvasShotResponse } from '@excuse/shared'
import { api, unwrapEden } from './client'

// ===== 项目 CRUD =====

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

// ===== Pipeline 阶段触发 =====

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

// ===== Layout + Model Preferences =====

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
