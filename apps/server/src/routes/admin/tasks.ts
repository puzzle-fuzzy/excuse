import type { AdminTaskDetailResponse, AdminTaskListResponse, AdminTaskMutationResponse } from '@excuse/shared'
import { cancelAdminTask, getAdminTaskDetail, listAdminTasks, requeueAdminTask } from '@excuse/db'
import { ConflictError, NotFoundError } from '../../utils/app-errors'

export async function handleListTasks(query: {
  status?: string
  domain?: string
  search?: string
  limit?: number
  offset?: number
}): Promise<AdminTaskListResponse> {
  const result = await listAdminTasks({
    status: query.status,
    domain: query.domain,
    search: query.search,
    limit: query.limit,
    offset: query.offset,
  })
  return { success: true, items: result.items, total: result.total }
}

export async function handleGetTaskDetail(id: string): Promise<AdminTaskDetailResponse> {
  const detail = await getAdminTaskDetail(id)
  if (!detail)
    throw new NotFoundError('任务不存在')
  return { success: true, data: detail }
}

export async function handleRequeueTask(id: string): Promise<AdminTaskMutationResponse> {
  const task = await requeueAdminTask(id)
  if (!task)
    throw new ConflictError('任务不存在或当前状态不允许重排')
  return { success: true, data: task }
}

export async function handleCancelTask(id: string): Promise<AdminTaskMutationResponse> {
  const task = await cancelAdminTask(id)
  if (!task)
    throw new ConflictError('任务不存在或当前状态不允许取消')
  return { success: true, data: task }
}
