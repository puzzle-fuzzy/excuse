import type { CanvasShotInsert } from '../types'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { getDb } from '../db'
import { canvasProjects } from '../schema/canvas-projects'
import { canvasShots } from '../schema/canvas-shots'

/** 创建单个镜头 */
export async function createCanvasShot(values: CanvasShotInsert) {
  const [shot] = await getDb().insert(canvasShots).values(values).returning()
  return shot!
}

/** 批量创建镜头（阶段 6 storyboard 生成后一次性插入所有分镜） */
export async function batchCreateCanvasShots(valuesList: CanvasShotInsert[]) {
  return getDb().insert(canvasShots).values(valuesList).returning()
}

/** 按 ID 查询镜头 */
export async function getCanvasShotById(id: string) {
  const [shot] = await getDb()
    .select()
    .from(canvasShots)
    .where(eq(canvasShots.id, id))
    .limit(1)
  return shot ?? null
}

/**
 * 校验 shot 属于指定用户的项目。返回 shot 或 null。
 */
export async function getCanvasShotForAccount(shotId: string, accountId: string) {
  const [row] = await getDb()
    .select({ shot: canvasShots, projectAccountId: canvasProjects.accountId })
    .from(canvasShots)
    .innerJoin(canvasProjects, eq(canvasShots.projectId, canvasProjects.id))
    .where(and(eq(canvasShots.id, shotId), eq(canvasProjects.accountId, accountId), eq(canvasProjects.isDeleted, false)))
    .limit(1)
  return row?.shot ?? null
}

/** 列出项目所有镜头（按 shotIndex 升序） */
export async function listCanvasShotsByProject(projectId: string) {
  return getDb()
    .select()
    .from(canvasShots)
    .where(eq(canvasShots.projectId, projectId))
    .orderBy(asc(canvasShots.shotIndex))
}

/** 删除项目所有镜头（重新生成分镜前清除旧数据） */
export async function deleteCanvasShotsByProject(projectId: string) {
  await getDb().delete(canvasShots).where(eq(canvasShots.projectId, projectId))
}

/** 更新镜头属性（部分更新，自动刷新 updatedAt） */
export async function updateCanvasShot(
  id: string,
  values: Partial<Pick<CanvasShotInsert, 'shotIndex' | 'duration' | 'locationId' | 'characterIdsJson' | 'narrative' | 'cameraJson' | 'continuityJson' | 'timelineJson' | 'environmentJson' | 'videoPrompt' | 'negativePrompt' | 'videoTaskId' | 'videoUrl' | 'status' | 'errorMessage' | 'referenceAssetsJson' | 'dialoguePrompt' | 'dialogueJson' | 'referenceMedia'>>,
) {
  const [updated] = await getDb()
    .update(canvasShots)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(canvasShots.id, id))
    .returning()
  return updated ?? null
}

/** 查询项目中正在生成视频的镜头（Worker 轮询用） */
export async function listPendingVideoShots(projectId: string) {
  return getDb()
    .select()
    .from(canvasShots)
    .where(
      and(
        eq(canvasShots.projectId, projectId),
        inArray(canvasShots.status, ['generating']),
      ),
    )
}

/** 按 ID 删除单个镜头 */
export async function deleteCanvasShotById(id: string) {
  await getDb().delete(canvasShots).where(eq(canvasShots.id, id))
}

/** 重置镜头为 draft 状态（重试时清除 videoTaskId/videoUrl/errorMessage） */
export async function resetCanvasShotToDraft(id: string) {
  await getDb()
    .update(canvasShots)
    .set({ status: 'draft', videoTaskId: null, videoUrl: null, errorMessage: null, updatedAt: new Date() })
    .where(eq(canvasShots.id, id))
}
