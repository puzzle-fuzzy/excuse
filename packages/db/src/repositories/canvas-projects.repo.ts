import type { CanvasContinuityRow, CanvasProjectInsert, CanvasProjectRow } from '../types'
import { createLogger } from '@excuse/shared'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { getDb } from '../db'
import { canvasCharacters } from '../schema/canvas-characters'
import { canvasContinuityReports } from '../schema/canvas-continuity'
import { canvasLocations } from '../schema/canvas-locations'
import { canvasProjects } from '../schema/canvas-projects'
import { canvasShots } from '../schema/canvas-shots'

const logger = createLogger('canvas-projects.repo')

/** 创建 Canvas 项目 — 初始状态为 draft */
export async function createCanvasProject(values: CanvasProjectInsert) {
  const [project] = await getDb().insert(canvasProjects).values(values).returning()
  return project!
}

/** 按 ID 查询项目（自动排除已软删除的记录） */
export async function getCanvasProjectById(id: string) {
  if (!id) {
    logger.error({ id, type: typeof id }, 'getCanvasProjectById called with empty id')
    return null
  }
  const [project] = await getDb()
    .select()
    .from(canvasProjects)
    .where(and(eq(canvasProjects.id, id), eq(canvasProjects.isDeleted, false)))
    .limit(1)
  return project ?? null
}

/**
 * 按 ID + accountId 查询项目，用于 owner 校验
 */
export async function getCanvasProjectByIdForAccount(id: string, accountId: string) {
  const [project] = await getDb()
    .select()
    .from(canvasProjects)
    .where(and(eq(canvasProjects.id, id), eq(canvasProjects.accountId, accountId), eq(canvasProjects.isDeleted, false)))
    .limit(1)
  return project ?? null
}

/** 查询用户所有未删除的项目，按创建时间倒序排列 */
export async function listCanvasProjectsByAccount(accountId: string) {
  return getDb()
    .select()
    .from(canvasProjects)
    .where(and(eq(canvasProjects.accountId, accountId), eq(canvasProjects.isDeleted, false)))
    .orderBy(desc(canvasProjects.createdAt))
}

/** 更新项目字段（自动刷新 updatedAt，排除 id/accountId/时间戳等不可变字段） */
export async function updateCanvasProject(
  id: string,
  values: Partial<Omit<CanvasProjectInsert, 'id' | 'accountId' | 'createdAt' | 'updatedAt'>>,
) {
  const [updated] = await getDb()
    .update(canvasProjects)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(canvasProjects.id, id))
    .returning()
  return updated ?? null
}

/** 软删除项目 — 设置 isDeleted=true，记录不会出现在后续查询中 */
export async function softDeleteCanvasProject(id: string) {
  await getDb()
    .update(canvasProjects)
    .set({ isDeleted: true, updatedAt: new Date() })
    .where(eq(canvasProjects.id, id))
}

/** 获取项目完整详情（含关联的角色、场景、分镜、最新连续性报告） */
export async function getCanvasProjectDetail(id: string) {
  const project = await getCanvasProjectById(id)
  if (!project)
    return null

  const [characters, locations, shots, continuityReports] = await Promise.all([
    getDb().select().from(canvasCharacters).where(eq(canvasCharacters.projectId, id)),
    getDb().select().from(canvasLocations).where(eq(canvasLocations.projectId, id)),
    getDb().select().from(canvasShots).where(eq(canvasShots.projectId, id)).orderBy(canvasShots.shotIndex),
    getDb()
      .select()
      .from(canvasContinuityReports)
      .where(eq(canvasContinuityReports.projectId, id))
      .orderBy(desc(canvasContinuityReports.createdAt))
      .limit(1),
  ])

  return { project, characters, locations, shots, latestContinuity: continuityReports[0] ?? null }
}

/** 批量获取项目详情 — 5 条 SQL 替代 1+N*5 条 */
export async function batchGetProjectDetails(accountId: string) {
  const projects = await listCanvasProjectsByAccount(accountId)
  if (projects.length === 0)
    return []

  const projectIds = projects.map(p => p.id)

  const [characters, locations, shots, continuityReports] = await Promise.all([
    getDb().select().from(canvasCharacters).where(inArray(canvasCharacters.projectId, projectIds)),
    getDb().select().from(canvasLocations).where(inArray(canvasLocations.projectId, projectIds)),
    getDb().select().from(canvasShots).where(inArray(canvasShots.projectId, projectIds)).orderBy(canvasShots.shotIndex),
    getDb().select().from(canvasContinuityReports).where(inArray(canvasContinuityReports.projectId, projectIds)).orderBy(desc(canvasContinuityReports.createdAt)),
  ])

  const charMap = new Map<string, typeof characters>()
  for (const c of characters) {
    const arr = charMap.get(c.projectId) ?? []
    arr.push(c)
    charMap.set(c.projectId, arr)
  }

  const locMap = new Map<string, typeof locations>()
  for (const l of locations) {
    const arr = locMap.get(l.projectId) ?? []
    arr.push(l)
    locMap.set(l.projectId, arr)
  }

  const shotMap = new Map<string, typeof shots>()
  for (const s of shots) {
    const arr = shotMap.get(s.projectId) ?? []
    arr.push(s)
    shotMap.set(s.projectId, arr)
  }

  const contMap = new Map<string, CanvasContinuityRow>()
  for (const c of continuityReports) {
    if (!contMap.has(c.projectId))
      contMap.set(c.projectId, c)
  }

  return projects.map(p => ({
    project: p,
    characters: charMap.get(p.id) ?? [],
    locations: locMap.get(p.id) ?? [],
    shots: shotMap.get(p.id) ?? [],
    latestContinuity: contMap.get(p.id) ?? null,
  }))
}

// ===== 摘要/详情查询（大项目 Canvas 性能优化） =====

/** 摘要角色行 — 仅汇总画布节点渲染必需的字段 */
export interface CanvasCharacterSummaryRow {
  id: string
  projectId: string
  name: string
  role: string | null
  referenceImageUrl: string | null
  turnaroundSheetUrl: string | null
  locked: boolean
}

/** 摘要场景行 — 仅汇总画布节点渲染必需的字段 */
export interface CanvasLocationSummaryRow {
  id: string
  projectId: string
  name: string
  type: string
  referenceImageUrl: string | null
  locked: boolean
}

/** 摘要镜头行 — 仅汇总画布节点渲染必需的字段 */
export interface CanvasShotSummaryRow {
  id: string
  projectId: string
  shotIndex: number
  duration: number
  narrative: string
  videoUrl: string | null
  status: string
  errorMessage: string | null
  characterIdsJson: string[]
  locationId: string | null
}

/** 摘要查询返回值 — 与 getCanvasProjectDetail 结构对称但字段更少 */
export interface CanvasProjectSummaryResult {
  project: CanvasProjectRow
  characterSummaries: CanvasCharacterSummaryRow[]
  locationSummaries: CanvasLocationSummaryRow[]
  shotSummaries: CanvasShotSummaryRow[]
  latestContinuity: CanvasContinuityRow | null
}

/**
 * 获取项目摘要（轻量版）— 主画布渲染所需的最小数据集。
 *
 * 与 {@link getCanvasProjectDetail} 的区别：
 * - 角色只查 id/name/role/referenceImageUrl/turnaroundSheetUrl/locked，跳过 profileJson/identityPrompt 等大字段
 * - 场景只查 id/name/type/referenceImageUrl/locked，跳过 profileJson/scenePrompt 等
 * - 镜头只查 id/shotIndex/duration/narrative/videoUrl/status/errorMessage/characterIds/locationId，跳过 cameraJson 等
 */
export async function getCanvasProjectSummary(id: string): Promise<CanvasProjectSummaryResult | null> {
  const project = await getCanvasProjectById(id)
  if (!project)
    return null

  const [characters, locations, shots, continuityReports] = await Promise.all([
    getDb()
      .select({
        id: canvasCharacters.id,
        projectId: canvasCharacters.projectId,
        name: canvasCharacters.name,
        role: canvasCharacters.role,
        referenceImageUrl: canvasCharacters.referenceImageUrl,
        turnaroundSheetUrl: canvasCharacters.turnaroundSheetUrl,
        locked: canvasCharacters.locked,
      })
      .from(canvasCharacters)
      .where(eq(canvasCharacters.projectId, id)),
    getDb()
      .select({
        id: canvasLocations.id,
        projectId: canvasLocations.projectId,
        name: canvasLocations.name,
        type: canvasLocations.type,
        referenceImageUrl: canvasLocations.referenceImageUrl,
        locked: canvasLocations.locked,
      })
      .from(canvasLocations)
      .where(eq(canvasLocations.projectId, id)),
    getDb()
      .select({
        id: canvasShots.id,
        projectId: canvasShots.projectId,
        shotIndex: canvasShots.shotIndex,
        duration: canvasShots.duration,
        narrative: canvasShots.narrative,
        videoUrl: canvasShots.videoUrl,
        status: canvasShots.status,
        errorMessage: canvasShots.errorMessage,
        characterIdsJson: canvasShots.characterIdsJson,
        locationId: canvasShots.locationId,
      })
      .from(canvasShots)
      .where(eq(canvasShots.projectId, id))
      .orderBy(canvasShots.shotIndex),
    getDb()
      .select()
      .from(canvasContinuityReports)
      .where(eq(canvasContinuityReports.projectId, id))
      .orderBy(desc(canvasContinuityReports.createdAt))
      .limit(1),
  ])

  return { project, characterSummaries: characters, locationSummaries: locations, shotSummaries: shots, latestContinuity: continuityReports[0] ?? null }
}

/** 查询单个角色完整数据（供详情面板按需加载） */
export async function getCanvasCharacterDetail(id: string) {
  const [character] = await getDb()
    .select()
    .from(canvasCharacters)
    .where(eq(canvasCharacters.id, id))
    .limit(1)
  return character ?? null
}

/** 查询单个场景完整数据（供详情面板按需加载） */
export async function getCanvasLocationDetail(id: string) {
  const [location] = await getDb()
    .select()
    .from(canvasLocations)
    .where(eq(canvasLocations.id, id))
    .limit(1)
  return location ?? null
}

/** 查询单个镜头完整数据（供详情面板按需加载） */
export async function getCanvasShotDetail(id: string) {
  const [shot] = await getDb()
    .select()
    .from(canvasShots)
    .where(eq(canvasShots.id, id))
    .limit(1)
  return shot ?? null
}
