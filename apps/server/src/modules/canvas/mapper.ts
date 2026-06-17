/**
 * DB Row → DTO 序列化映射
 *
 * 将 Drizzle 查询返回的 DB row（Date 对象、JSONB 对象等）
 * 转换为前端兼容的 DTO（ISO 字符串、可序列化对象）。
 *
 * 关键职责：
 *   - Date → string (.toISOString())
 *   - 可选字段 null 归一化
 *   - profileJson 从 JSONB 直接透传（由 schema $type 绑定类型）
 */
import type { CanvasCharacterRow, CanvasCharacterSummaryRow, CanvasContinuityRow, CanvasLocationRow, CanvasLocationSummaryRow, CanvasProjectRow, CanvasShotRow, CanvasShotSummaryRow, CharacterProfile, ContinuityIssue, LocationProfile } from '@excuse/db'
import type {
  CanvasEntitySummary,
  CanvasProjectSummaryDTO,
  CanvasShotStatus,
  CharacterDTO,
  LocationDTO,
  ProjectDTO,
  ShotDTO,
} from '@excuse/shared'

/** CanvasCharacterRow → CharacterDTO */
export function mapCharacter(row: CanvasCharacterRow): CharacterDTO {
  let profile: CharacterProfile | null = null
  if (row.profileJson) {
    // 类型已从 DB schema $type<CharacterProfile>() 推断；如需 runtime 校验可改用 Zod
    profile = row.profileJson
  }

  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    role: row.role ?? null,
    description: row.description ?? null,
    profile,
    identityPrompt: row.identityPrompt ?? null,
    negativePrompt: row.negativePrompt ?? null,
    referenceImageUrl: row.referenceImageUrl ?? null,
    turnaroundSheetUrl: row.turnaroundSheetUrl ?? null,
    locked: row.locked,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** CanvasLocationRow → LocationDTO */
export function mapLocation(row: CanvasLocationRow): LocationDTO {
  let profile: LocationProfile | null = null
  if (row.profileJson) {
    profile = row.profileJson
  }

  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    type: row.type as 'interior' | 'exterior' | 'mixed',
    profile,
    scenePrompt: row.scenePrompt ?? null,
    negativePrompt: row.negativePrompt ?? null,
    referenceImageUrl: row.referenceImageUrl ?? null,
    locked: row.locked,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** CanvasShotRow → ShotDTO */
export function mapShot(row: CanvasShotRow): ShotDTO {
  return {
    id: row.id,
    projectId: row.projectId,
    shotIndex: row.shotIndex,
    duration: row.duration,
    locationId: row.locationId ?? null,
    characterIds: row.characterIdsJson ?? [],
    narrative: row.narrative,
    camera: row.cameraJson ?? {},
    continuity: row.continuityJson ?? {},
    timeline: row.timelineJson ?? null,
    environment: row.environmentJson ?? null,
    videoPrompt: row.videoPrompt ?? null,
    negativePrompt: row.negativePrompt ?? null,
    videoTaskId: row.videoTaskId ?? null,
    videoUrl: row.videoUrl ?? null,
    status: row.status,
    errorMessage: row.errorMessage ?? null,
    referenceAssets: row.referenceAssetsJson ?? [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * 组装完整的项目详情 DTO
 *
 * 合并项目 + 角色 + 场景 + 镜头 + 连续性报告为单一响应对象。
 * 前端 canvas 编辑器一次性获取所有数据。
 */
export function mapProjectDetail(
  project: CanvasProjectRow,
  characters: CanvasCharacterRow[],
  locations: CanvasLocationRow[],
  shots: CanvasShotRow[],
  continuityReport: CanvasContinuityRow | null,
): ProjectDTO {
  let continuityIssues: ContinuityIssue[] = []
  if (continuityReport?.issuesJson) {
    continuityIssues = continuityReport.issuesJson
  }

  return {
    id: project.id,
    accountId: project.accountId,
    title: project.title ?? null,
    storyText: project.storyText,
    status: project.status,
    analysis: project.analysisJson ?? null,
    modelPreferences: project.modelPreferencesJson ?? null,
    characters: characters.map(mapCharacter),
    locations: locations.map(mapLocation),
    shots: shots.map(mapShot),
    continuityIssues,
    canvasLayout: project.canvasLayout ?? null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  }
}

// ===== 摘要映射（大项目 Canvas 性能优化） =====

/** CanvasCharacterSummaryRow → CanvasEntitySummary */
function mapCharacterSummary(row: CanvasCharacterSummaryRow): CanvasEntitySummary {
  return {
    id: row.id,
    name: row.name,
    role: row.role ?? null,
    referenceImageUrl: row.referenceImageUrl ?? null,
    turnaroundSheetUrl: row.turnaroundSheetUrl ?? null,
    locked: row.locked,
  }
}

/** CanvasLocationSummaryRow → CanvasEntitySummary */
function mapLocationSummary(row: CanvasLocationSummaryRow): CanvasEntitySummary {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    referenceImageUrl: row.referenceImageUrl ?? null,
    locked: row.locked,
  }
}

/** CanvasShotSummaryRow → CanvasEntitySummary */
function mapShotSummary(row: CanvasShotSummaryRow): CanvasEntitySummary {
  return {
    id: row.id,
    shotIndex: row.shotIndex,
    duration: row.duration,
    narrative: row.narrative,
    videoUrl: row.videoUrl ?? null,
    status: row.status as CanvasShotStatus,
    errorMessage: row.errorMessage ?? null,
    characterIds: row.characterIdsJson ?? [],
    locationId: row.locationId ?? null,
  }
}

/** 组装项目摘要 DTO — 主画布渲染所需的最小数据集 */
export function mapProjectSummary(
  project: CanvasProjectRow,
  characterSummaries: CanvasCharacterSummaryRow[],
  locationSummaries: CanvasLocationSummaryRow[],
  shotSummaries: CanvasShotSummaryRow[],
  continuityReport: CanvasContinuityRow | null,
): CanvasProjectSummaryDTO {
  let continuityIssues: ContinuityIssue[] = []
  if (continuityReport?.issuesJson) {
    continuityIssues = continuityReport.issuesJson
  }

  return {
    id: project.id,
    accountId: project.accountId,
    title: project.title ?? null,
    storyText: project.storyText,
    status: project.status,
    analysis: project.analysisJson ?? null,
    modelPreferences: project.modelPreferencesJson ?? null,
    characters: characterSummaries.map(mapCharacterSummary),
    locations: locationSummaries.map(mapLocationSummary),
    shots: shotSummaries.map(mapShotSummary),
    continuityIssues,
    canvasLayout: project.canvasLayout ?? null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  }
}
