import type { SubtitleMutationOkResponse, SubtitleProjectDTO, SubtitleProjectListResponse, SubtitleProjectResponse, SubtitleSentence, SubtitleStyleConfig } from '@excuse/shared'
import { api, unwrapEden } from './client'

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
