import type { UserTaskListResponse, UserTaskResponse, UserTaskStatus } from '@excuse/shared'
import type { ServerConfig } from '../config'
import { getUserTaskById, listUserTasks } from '@excuse/db'
import { Elysia, t } from 'elysia'
import { createRequireAuthPlugin } from '../plugins/auth'
import { NotFoundError } from '../utils/app-errors'

const USER_TASK_STATUSES = ['queued', 'running', 'retrying', 'succeeded', 'failed', 'cancelled'] as const
const USER_TASK_DOMAINS = ['generate', 'canvas', 'subtitle', 'gateway'] as const

function normalizeStatus(status: string | undefined): UserTaskStatus | undefined {
  return USER_TASK_STATUSES.includes(status as UserTaskStatus) ? status as UserTaskStatus : undefined
}

function normalizeDomain(domain: string | undefined) {
  return USER_TASK_DOMAINS.includes(domain as typeof USER_TASK_DOMAINS[number])
    ? domain as typeof USER_TASK_DOMAINS[number]
    : undefined
}

export function createTaskRoutes(config: ServerConfig) {
  return new Elysia({ prefix: '/api/tasks' })
    .use(createRequireAuthPlugin(config))
    .get('/', async ({ userId, query }) => {
      const result = await listUserTasks(userId, {
        status: normalizeStatus(query.status),
        domain: normalizeDomain(query.domain),
        limit: query.limit,
        offset: query.offset,
      })
      return { success: true, items: result.items, total: result.total } satisfies UserTaskListResponse
    }, {
      query: t.Object({
        status: t.Optional(t.String()),
        domain: t.Optional(t.String()),
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
      }),
      detail: {
        summary: '获取当前用户任务列表',
        description: '聚合统一任务表与生成记录，返回用户可理解的任务中心 DTO。',
        tags: ['任务'],
        security: [{ bearerAuth: [] }],
      },
    })
    .get('/:id', async ({ userId, params }) => {
      const task = await getUserTaskById(userId, params.id)
      if (!task)
        throw new NotFoundError('任务不存在')
      return { success: true, data: task } satisfies UserTaskResponse
    }, {
      params: t.Object({ id: t.String() }),
      detail: {
        summary: '获取当前用户任务详情',
        description: '按任务 ID 或生成记录 ID 查询当前用户可见的任务详情。',
        tags: ['任务'],
        security: [{ bearerAuth: [] }],
      },
    })
}
