import type { AcceptedResponse, AdminOverview, AdminOverviewResponse, AdminTaskItem, AdminTaskListQuery, AdminTaskListResponse, AdminTaskMutationResponse, AssetLibraryListResponse, AssetLibraryQuery, AuthCurrentUserResponse, AuthResponse, BillingBalanceResponse, BillingStatisticsResponse, BillingTransactionsResponse, CanvasAssetsPoll, CanvasAssetsPollResponse, CanvasCharacterResponse, CanvasLocationResponse, CanvasMutationOkResponse, CanvasPipelineRunDTO, CanvasPipelineRunListResponse, CanvasProjectListResponse, CanvasProjectResponse, CanvasProjectSummaryResponse, CanvasShotResponse, DeleteGenerationRecordResponse, GenerateResponse, GenerationRecord, GenerationRecordListResponse, GenerationRecordResponse, ModelConfig, MutationOkResponse, OpenAIGatewayUsageResponse, SubtitleMutationOkResponse, SubtitleProjectDTO, SubtitleProjectListResponse, SubtitleProjectResponse, SubtitleSentence, SubtitleStyleConfig, UploadResponse } from '@excuse/shared'
import type { App } from '../../../server/src/index'
import { treaty } from '@elysia/eden'
import { sseClient } from './sse'

/**
 * Eden Treaty 客户端 — 端到端类型安全
 *
 * 通过 Vite 代理 (/api → localhost:5007) 与后端通信
 * 类型从 Drizzle schema → @excuse/db → @excuse/shared 单向推导
 *
 * 注意：Eden 从 Elysia 路由推导的类型与 @excuse/shared 的手动定义
 * 存在微妙差异（联合类型结构、字段可选性等），不能直接赋值。
 * unwrapEden 封装了必要的类型转换，保留 Eden 的运行时错误处理。
 */

// ===== Token 管理 =====

/**
 * 认证 token — 仅存内存，用于 SSE Authorization header
 * 浏览器 API 请求通过 httpOnly cookie 自动认证（无需手动设置 header）
 */
let authToken: string | null = null

/** 设置认证 token（内存 + 联动 SSE 连接） */
export function setAuthToken(token: string | null) {
  authToken = token
  if (token) {
    sseClient.connect()
  }
  else {
    sseClient.disconnect()
  }
}

/** 获取当前 token（SSE 使用） */
export function getAuthToken() {
  return authToken
}

// ===== Eden Treaty 客户端 =====

function normalizeApiBaseUrl(baseUrl: string | undefined): string {
  if (!baseUrl)
    return ''
  return baseUrl.replace(/\/api\/?$/, '')
}

export function resolveApiBaseUrl() {
  const normalized = normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL)
  if (normalized)
    return normalized
  if (typeof window !== 'undefined' && window.location?.origin)
    return window.location.origin
  return 'http://localhost:5007'
}

export const api = treaty<App>(resolveApiBaseUrl())

// ===== 导出共享类型 =====

export type { ModelConfig, ModelParameter } from '@excuse/shared'
export type { AcceptedResponse, GenerateResponse, GenerationRecord } from '@excuse/shared'
export type { AdminOverview, AdminTaskItem, AdminTaskListQuery } from '@excuse/shared'
export type { AssetLibraryItem, AssetLibraryKind, AssetLibraryListResponse, AssetLibraryQuery, AssetLibrarySource, AssetLibraryStatusFilter } from '@excuse/shared'
export type { BillingStatistics } from '@excuse/shared'
export type CostDetail = GenerationRecord['cost']

/**
 * Eden 响应中的错误结构
 * Eden 将非 2xx 响应包装为 { status, statusText, headers, ... } 等
 */
interface EdenError {
  status?: number
  statusText?: string
  message?: string
  value?: unknown
}

interface ApiErrorValue {
  error: string
}

function isApiErrorValue(value: unknown): value is ApiErrorValue {
  return typeof value === 'object'
    && value !== null
    && 'error' in value
    && typeof value.error === 'string'
}

/**
 * 解包 Eden Treaty 响应：提取 data 或抛出结构化错误
 *
 * Eden 返回 { data, error }，data 类型是 Eden 从 Elysia 推导的，
 * 与 @excuse/shared 的类型有细微结构差异无法直接赋值。
 * 此函数将 data 转为 shared 包定义的类型 T，封装必要的转换。
 *
 * 错误处理策略：
 *   - 401/403: 认证问题，触发登录态清理
 *   - 422: 参数校验失败，展示具体字段错误
 *   - 其他: 展示通用错误消息
 */
function unwrapEden<T>(response: { data: unknown, error: unknown }): T {
  if (response.error) {
    const edenErr = response.error as EdenError
    const message = isApiErrorValue(edenErr.value)
      ? edenErr.value.error || edenErr.statusText || '请求失败'
      : edenErr.message || edenErr.statusText || '请求失败'
    const error = new Error(message) as Error & { status?: number }
    error.status = edenErr.status
    throw error
  }
  return response.data as T
}

// ===== 认证 API =====

export async function registerRequest(username: string, email: string, password: string): Promise<AuthResponse> {
  return unwrapEden<AuthResponse>(
    await api.api.auth.register.post({ username, email, password }),
  )
}

export async function loginRequest(email: string, password: string): Promise<AuthResponse> {
  return unwrapEden<AuthResponse>(
    await api.api.auth.login.post({ email, password }),
  )
}

export async function fetchCurrentUser(): Promise<AuthCurrentUserResponse> {
  return unwrapEden<AuthCurrentUserResponse>(
    await api.api.auth.me.get(),
  )
}

export async function logoutRequest(): Promise<MutationOkResponse> {
  return unwrapEden<MutationOkResponse>(
    await api.api.auth.logout.post(),
  )
}

// ===== 业务 API =====

export async function fetchModels(): Promise<{ models: ModelConfig[] }> {
  return unwrapEden<{ models: ModelConfig[] }>(
    await api.api.models.get(),
  )
}

/** 发起生成 — 返回完整 GenerationRecord */
export async function generate(params: {
  model: string
  parameters: Record<string, unknown>
  referenceFileIds?: string[]
}): Promise<GenerateResponse> {
  return unwrapEden<GenerateResponse>(
    await api.api.generate.post(params),
  )
}

export async function fetchRecords(params?: {
  category?: string
  status?: string
  limit?: number
  offset?: number
}): Promise<GenerationRecordListResponse> {
  return unwrapEden<GenerationRecordListResponse>(
    await api.api.records.get({
      query: {
        category: params?.category || undefined,
        status: params?.status || undefined,
        limit: params?.limit ?? 50,
        offset: params?.offset ?? 0,
      },
    }),
  )
}

export async function fetchRecord(id: string): Promise<GenerationRecordResponse> {
  return unwrapEden<GenerationRecordResponse>(
    await api.api.records({ id }).get(),
  )
}

export async function deleteRecord(id: string): Promise<DeleteGenerationRecordResponse> {
  return unwrapEden<DeleteGenerationRecordResponse>(
    await api.api.records({ id }).delete(),
  )
}

export async function retryRecord(id: string): Promise<GenerateResponse> {
  return unwrapEden<GenerateResponse>(
    await api.api.records({ id }).retry.post(),
  )
}

export async function cancelRecord(id: string): Promise<GenerationRecordResponse> {
  return unwrapEden<GenerationRecordResponse>(
    await api.api.records({ id }).cancel.post(),
  )
}

export async function uploadFile(file: File): Promise<UploadResponse> {
  return unwrapEden<UploadResponse>(
    await api.api.upload.post({ file }),
  )
}

export async function deleteUploadedFile(id: string): Promise<MutationOkResponse> {
  return unwrapEden<MutationOkResponse>(
    await api.api.upload({ id }).delete(),
  )
}

/** 编辑上传文件（重命名/用途） — 返回更新后的 DTO */
export async function updateUploadedFile(
  id: string,
  patch: { fileName?: string, purpose?: string },
): Promise<UploadResponse> {
  return unwrapEden<UploadResponse>(
    await api.api.upload({ id }).patch(patch),
  )
}

export async function fetchBillingStatistics(): Promise<BillingStatisticsResponse> {
  return unwrapEden<BillingStatisticsResponse>(
    await api.api.billing.statistics.get(),
  )
}

export async function fetchBillingBalance(): Promise<BillingBalanceResponse> {
  return unwrapEden<BillingBalanceResponse>(
    await api.api.billing.balance.get(),
  )
}

export async function fetchBillingTransactions(params?: { limit?: number, offset?: number }): Promise<BillingTransactionsResponse> {
  return unwrapEden<BillingTransactionsResponse>(
    await api.api.billing.transactions.get({
      query: {
        limit: params?.limit,
        offset: params?.offset,
      },
    }),
  )
}

export async function fetchAdminOverview(): Promise<AdminOverview> {
  const response = unwrapEden<AdminOverviewResponse>(
    await api.api.admin.overview.get(),
  )
  return response.data
}

export async function fetchAdminTasks(params?: AdminTaskListQuery): Promise<AdminTaskListResponse> {
  return unwrapEden<AdminTaskListResponse>(
    await api.api.admin.tasks.get({
      query: {
        status: params?.status || undefined,
        domain: params?.domain || undefined,
        search: params?.search || undefined,
        limit: params?.limit ?? 40,
        offset: params?.offset ?? 0,
      },
    }),
  )
}

export async function requeueAdminTask(id: string): Promise<AdminTaskItem> {
  const response = unwrapEden<AdminTaskMutationResponse>(
    await api.api.admin.tasks({ id }).requeue.post(),
  )
  return response.data
}

export async function cancelAdminTask(id: string): Promise<AdminTaskItem> {
  const response = unwrapEden<AdminTaskMutationResponse>(
    await api.api.admin.tasks({ id }).cancel.post(),
  )
  return response.data
}

// ===== 统一资产中心 API =====

/** 拉取统一资产列表（generation_records + canvas_assets + uploaded_files） */
export async function fetchAssetLibrary(params?: AssetLibraryQuery): Promise<AssetLibraryListResponse> {
  return unwrapEden<AssetLibraryListResponse>(
    await api.api.assets.get({
      query: {
        source: params?.source || undefined,
        kind: params?.kind || undefined,
        status: params?.status || undefined,
        projectId: params?.projectId || undefined,
        search: params?.search || undefined,
        model: params?.model || undefined,
        createdFrom: params?.createdFrom || undefined,
        createdTo: params?.createdTo || undefined,
        limit: params?.limit ?? 100,
        offset: params?.offset ?? 0,
      },
    }),
  )
}

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

// ===== 字幕 API =====

export type SubtitleProject = SubtitleProjectDTO

export async function createSubtitleProject(videoFileId: string): Promise<SubtitleProjectResponse> {
  return unwrapEden<SubtitleProjectResponse>(
    await api.api.subtitle.projects.post({ videoFileId }),
  )
}

export async function listSubtitleProjects(): Promise<SubtitleProjectListResponse> {
  return unwrapEden<SubtitleProjectListResponse>(
    await api.api.subtitle.projects.get(),
  )
}

export async function getSubtitleProject(id: string): Promise<SubtitleProjectResponse> {
  return unwrapEden<SubtitleProjectResponse>(
    await api.api.subtitle.projects({ id }).get(),
  )
}

export async function updateSubtitleSentences(id: string, sentences: SubtitleSentence[]): Promise<SubtitleProjectResponse> {
  return unwrapEden<SubtitleProjectResponse>(
    await api.api.subtitle.projects({ id }).sentences.patch({ sentences }),
  )
}

export async function updateSubtitleStyle(id: string, styleConfig: SubtitleStyleConfig): Promise<SubtitleProjectResponse> {
  return unwrapEden<SubtitleProjectResponse>(
    await api.api.subtitle.projects({ id }).style.patch({ styleConfig }),
  )
}

export async function exportSubtitleProject(id: string): Promise<SubtitleMutationOkResponse> {
  return unwrapEden<SubtitleMutationOkResponse>(
    await api.api.subtitle.projects({ id }).export.post(),
  )
}

export async function retrySubtitleProject(id: string): Promise<SubtitleProjectResponse> {
  return unwrapEden<SubtitleProjectResponse>(
    await api.api.subtitle.projects({ id }).retry.post(),
  )
}

export async function deleteSubtitleProject(id: string): Promise<SubtitleMutationOkResponse> {
  return unwrapEden<SubtitleMutationOkResponse>(
    await api.api.subtitle.projects({ id }).delete(),
  )
}

// ===== Gateway API =====

export async function fetchGatewayUsage(params?: { days?: number, limit?: number }): Promise<OpenAIGatewayUsageResponse> {
  return unwrapEden<OpenAIGatewayUsageResponse>(
    await api.v1.usage.get({ query: { days: params?.days, limit: params?.limit } }),
  )
}
