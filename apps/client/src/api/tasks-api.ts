import type { UserTaskDTO, UserTaskListQuery, UserTaskListResponse, UserTaskResponse } from '@excuse/shared'
import { api, unwrapEden } from './client'

export async function fetchUserTasks(params?: UserTaskListQuery): Promise<UserTaskListResponse> {
  return unwrapEden<UserTaskListResponse>(
    await api.api.tasks.get({
      query: {
        status: params?.status,
        domain: params?.domain,
        limit: params?.limit ?? 40,
        offset: params?.offset ?? 0,
      },
    }),
  )
}

export async function fetchUserTask(id: string): Promise<UserTaskDTO> {
  return unwrapEden<UserTaskResponse>(await api.api.tasks({ id }).get()).data
}
