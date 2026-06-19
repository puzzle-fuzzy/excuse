import type { EntityResponse, ListResponse } from './api-response'

export type UserTaskDomain = 'generate' | 'canvas' | 'subtitle' | 'gateway'
export type UserTaskStatus = 'queued' | 'running' | 'retrying' | 'succeeded' | 'failed' | 'cancelled'
export type UserTaskNextAction = 'retry' | 'edit_input' | 'recharge' | 'contact_support' | 'none'
export type UserTaskBillingStatus = 'none' | 'estimated' | 'reserved' | 'debited' | 'refunded' | 'partially_refunded'
export type UserTaskTargetType = 'asset' | 'project' | 'subtitle_project' | 'generation_record' | 'external'

export interface UserTaskBillingDTO {
  estimatedCents: number | null
  reservedCents: number | null
  actualCents: number | null
  status: UserTaskBillingStatus
}

export interface UserTaskTargetDTO {
  type: UserTaskTargetType
  id: string
  href: string
}

export interface UserTaskErrorDTO {
  code: string
  message: string
  retryable: boolean
  nextAction: UserTaskNextAction
}

export interface UserTaskDTO {
  id: string
  source: 'task' | 'generation_record'
  domain: UserTaskDomain
  type: string
  status: UserTaskStatus
  title: string
  description: string
  progress: number | null
  currentStep: string | null
  createdAt: string
  updatedAt: string
  finishedAt: string | null
  canRetry: boolean
  canCancel: boolean
  billing: UserTaskBillingDTO
  target: UserTaskTargetDTO | null
  error: UserTaskErrorDTO | null
}

export interface UserTaskListQuery {
  status?: UserTaskStatus
  domain?: UserTaskDomain
  limit?: number
  offset?: number
}

export type UserTaskListResponse = ListResponse<UserTaskDTO>
export type UserTaskResponse = EntityResponse<UserTaskDTO>
