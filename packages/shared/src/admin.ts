export interface AdminSummary {
  totalUsers: number
  activeUsers: number
  totalGenerationRecords: number
  failedGenerationRecords: number
  totalCostCents: number
  activeTasks: number
  activeCanvasProjects: number
}

export interface AdminStatusCount {
  status: string
  count: number
}

export interface AdminTaskQueueCount {
  domain: string
  status: string
  count: number
}

export type AdminTaskAction = 'requeue' | 'cancel'

export interface AdminTaskListQuery {
  status?: string
  domain?: string
  search?: string
  limit?: number
  offset?: number
}

export interface AdminTaskItem {
  id: string
  accountId: string
  type: string
  domain: string
  status: string
  priority: number
  attempts: number
  maxAttempts: number
  projectId: string | null
  targetType: string | null
  targetId: string | null
  generationRecordId: string | null
  lockedBy: string
  lockedUntil: string | null
  nextRunAt: string
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
  errorMessage: string | null
  canRequeue: boolean
  canCancel: boolean
}

export interface AdminRecentFailure {
  id: string
  kind: 'generation' | 'task' | 'canvas_pipeline'
  accountId: string | null
  title: string
  status: string
  errorMessage: string | null
  createdAt: string
  updatedAt: string | null
}

export interface AdminOverview {
  summary: AdminSummary
  generationStatus: AdminStatusCount[]
  canvasProjectStatus: AdminStatusCount[]
  taskQueue: AdminTaskQueueCount[]
  recentFailures: AdminRecentFailure[]
}

export interface AdminOverviewResponse {
  success: true
  data: AdminOverview
}

export interface AdminTaskListResponse {
  success: true
  items: AdminTaskItem[]
  total: number
}

export interface AdminTaskMutationResponse {
  success: true
  data: AdminTaskItem
}
