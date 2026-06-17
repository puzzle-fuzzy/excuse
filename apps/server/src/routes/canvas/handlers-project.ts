/**
 * Canvas 项目 CRUD handler 逻辑 — 从 canvas.ts 抽离
 */
import type { CanvasAssetsPollResponse, CanvasMutationOkResponse, CanvasPipelineRunListResponse, CanvasPipelineRunResponse, CanvasProjectListResponse, CanvasProjectResponse, CanvasProjectSummaryResponse } from '@excuse/shared'
import { getCanvasProjectByIdForAccount, getPipelineRunById, listPipelineRunsByProject, serialize } from '@excuse/db'
import * as svc from '../../modules/canvas/service'
import { audit } from '../../services/audit'
import { NotFoundError, ValidationError } from '../../utils/app-errors'

export async function handleListProjects(userId: string) {
  const projects = await svc.listProjects(userId)
  return { success: true, items: projects, total: projects.length } satisfies CanvasProjectListResponse
}

export async function handleCreateProject(userId: string, body: { title?: string, storyText: string }) {
  const { title, storyText } = body
  const project = await svc.createProject(userId, { title, storyText })
  audit('canvas_project_create', { accountId: userId, targetId: project.id, detail: { projectId: project.id, title } })
  return { success: true, data: project } satisfies CanvasProjectResponse
}

export async function handleGetProject(projectId: string, userId: string) {
  const owned = await getCanvasProjectByIdForAccount(projectId, userId)
  if (!owned)
    throw new NotFoundError('项目不存在或无权访问')
  const project = await svc.getProjectDetail(projectId)
  if (!project)
    throw new NotFoundError('项目不存在')
  return { success: true, data: project } satisfies CanvasProjectResponse
}

export async function handleGetProjectSummary(projectId: string, userId: string) {
  const owned = await getCanvasProjectByIdForAccount(projectId, userId)
  if (!owned)
    throw new NotFoundError('项目不存在或无权访问')
  const summary = await svc.getProjectSummary(projectId)
  if (!summary)
    throw new NotFoundError('项目不存在')
  return { success: true, data: summary } satisfies CanvasProjectSummaryResponse
}

export async function handleGetAssetsPoll(projectId: string, userId: string) {
  const owned = await getCanvasProjectByIdForAccount(projectId, userId)
  if (!owned)
    throw new NotFoundError('项目不存在或无权访问')
  const poll = await svc.getCanvasAssetsPoll(projectId)
  if (!poll)
    throw new NotFoundError('项目不存在')
  return { success: true, data: poll } satisfies CanvasAssetsPollResponse
}

export async function handleDeleteProject(projectId: string, userId: string) {
  const owned = await getCanvasProjectByIdForAccount(projectId, userId)
  if (!owned)
    throw new NotFoundError('项目不存在或无权访问')
  await svc.softDeleteProject(projectId)
  audit('canvas_project_delete', { accountId: userId, targetId: projectId, detail: { projectId } })
  return { success: true } satisfies CanvasMutationOkResponse
}

export async function handlePatchProject(projectId: string, userId: string, body: { title?: string, storyText?: string }) {
  const owned = await getCanvasProjectByIdForAccount(projectId, userId)
  if (!owned)
    throw new NotFoundError('项目不存在或无权访问')
  const { title, storyText } = body
  if (title === undefined && storyText === undefined)
    throw new ValidationError('至少提供一个字段')
  const project = await svc.updateProjectProperties(projectId, { title, storyText })
  return { success: true, data: project } satisfies CanvasProjectResponse
}

export async function handleListRuns(projectId: string, userId: string) {
  const owned = await getCanvasProjectByIdForAccount(projectId, userId)
  if (!owned)
    throw new NotFoundError('项目不存在或无权访问')
  const runs = await listPipelineRunsByProject(projectId)
  const serialized = runs.map(serialize)
  return { success: true, items: serialized, total: serialized.length } satisfies CanvasPipelineRunListResponse
}

export async function handleGetRun(runId: string, userId: string) {
  const run = await getPipelineRunById(runId)
  if (!run)
    throw new NotFoundError('运行记录不存在')
  const owned = await getCanvasProjectByIdForAccount(run.projectId, userId)
  if (!owned)
    throw new NotFoundError('项目不存在或无权访问')
  return { success: true, data: serialize(run) } satisfies CanvasPipelineRunResponse
}

export async function handleSaveLayout(projectId: string, userId: string, body: unknown) {
  const owned = await getCanvasProjectByIdForAccount(projectId, userId)
  if (!owned)
    throw new NotFoundError('项目不存在或无权访问')
  await svc.saveCanvasLayout(projectId, body)
  return { success: true } satisfies CanvasMutationOkResponse
}

export async function handleUpdateModelPreferences(projectId: string, userId: string, body: { textModel?: string, imageModel?: string, videoModel?: string, autoProgress?: boolean }) {
  const owned = await getCanvasProjectByIdForAccount(projectId, userId)
  if (!owned)
    throw new NotFoundError('项目不存在或无权访问')
  const project = await svc.updateModelPreferences(projectId, body)
  return { success: true, data: project } satisfies CanvasProjectResponse
}
