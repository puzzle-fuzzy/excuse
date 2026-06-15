import type { EntityResponse, ListResponse, MutationOkResponse } from './api-response'
import type { SubtitleSentence, SubtitleStyleConfig } from './domain-types'

export type { SubtitleSentence, SubtitleStyleConfig } from './domain-types'

export type SubtitleProjectStatus
  = | 'draft'
    | 'extracting_audio'
    | 'asr_processing'
    | 'subtitle_editing'
    | 'exporting'
    | 'completed'
    | 'failed'

export interface SubtitleProjectDTO {
  id: string
  accountId: string
  videoFileId: string
  videoUrl: string
  audioFileUrl: string | null
  videoDurationMs: number | null
  asrRecordId: string | null
  status: SubtitleProjectStatus
  rawTranscription: unknown
  sentences: SubtitleSentence[] | null
  styleConfig: SubtitleStyleConfig | null
  exportRecordId: string | null
  exportedVideoUrl: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

export type SubtitleProjectResponse = EntityResponse<SubtitleProjectDTO>

export type SubtitleProjectListResponse = ListResponse<SubtitleProjectDTO>

export type SubtitleMutationOkResponse = MutationOkResponse
