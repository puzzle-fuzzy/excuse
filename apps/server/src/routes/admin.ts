import type { AdminOverviewResponse, AdminTaskListResponse, AdminTaskMutationResponse } from '@excuse/shared'
import type { ServerConfig } from '../config'
import { cancelAdminTask, getAdminOverview, listAdminTasks, requeueAdminTask } from '@excuse/db'
import { Elysia, t } from 'elysia'
import { createRequireAuthPlugin } from '../plugins/auth'
import { conflict, forbidden } from '../utils/errors'

function canAccessAdmin(config: ServerConfig, userId: string): boolean {
  return (config.adminUserIds ?? []).includes(userId)
}

export function createAdminRoutes(config: ServerConfig) {
  return new Elysia({ prefix: '/api/admin' })
    .use(createRequireAuthPlugin(config))
    .derive(({ userId, set }) => {
      if (!canAccessAdmin(config, userId)) {
        return {
          adminAllowed: false as const,
          adminDenied: () => forbidden(set, '无权访问管理后台'),
        }
      }
      return {
        adminAllowed: true as const,
        adminDenied: () => forbidden(set, '无权访问管理后台'),
      }
    })
    .get('/overview', async ({ userId, set }) => {
      if (!canAccessAdmin(config, userId))
        return forbidden(set, '无权访问管理后台')

      const overview = await getAdminOverview()
      return {
        success: true,
        data: overview,
      } satisfies AdminOverviewResponse
    }, {
      detail: {
        summary: '获取管理后台概览',
        description: '返回用户、生成、任务队列、Canvas 状态和最近失败摘要，仅 ADMIN_USER_IDS 配置中的用户可访问。',
        tags: ['管理后台'],
        security: [{ bearerAuth: [] }],
      },
    })
    .get('/tasks', async ({ adminAllowed, adminDenied, query }) => {
      if (!adminAllowed)
        return adminDenied()

      const result = await listAdminTasks({
        status: query.status,
        domain: query.domain,
        search: query.search,
        limit: query.limit,
        offset: query.offset,
      })
      return {
        success: true,
        items: result.items,
        total: result.total,
      } satisfies AdminTaskListResponse
    }, {
      query: t.Object({
        status: t.Optional(t.String()),
        domain: t.Optional(t.String()),
        search: t.Optional(t.String()),
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
      }),
      detail: {
        summary: '查询统一任务队列',
        description: '按状态、领域或关键字查询 tasks 表，返回管理员可见的任务诊断字段。',
        tags: ['管理后台'],
        security: [{ bearerAuth: [] }],
      },
    })
    .post('/tasks/:id/requeue', async ({ adminAllowed, adminDenied, params, set }) => {
      if (!adminAllowed)
        return adminDenied()

      const task = await requeueAdminTask(params.id)
      if (!task)
        return conflict(set, '任务不存在或当前状态不允许重排')

      return {
        success: true,
        data: task,
      } satisfies AdminTaskMutationResponse
    }, {
      params: t.Object({ id: t.String() }),
      detail: {
        summary: '重新排队任务',
        description: '将 failed/retrying/queued 的统一任务清锁、清错误并重新放回 queued。不会级联修复 generation 或 Canvas pipeline 状态。',
        tags: ['管理后台'],
        security: [{ bearerAuth: [] }],
      },
    })
    .post('/tasks/:id/cancel', async ({ adminAllowed, adminDenied, params, set }) => {
      if (!adminAllowed)
        return adminDenied()

      const task = await cancelAdminTask(params.id)
      if (!task)
        return conflict(set, '任务不存在或当前状态不允许取消')

      return {
        success: true,
        data: task,
      } satisfies AdminTaskMutationResponse
    }, {
      params: t.Object({ id: t.String() }),
      detail: {
        summary: '取消任务',
        description: '将 queued/running/retrying 的统一任务取消并释放锁。正在执行的 worker heartbeat 会在下次续锁时停止。',
        tags: ['管理后台'],
        security: [{ bearerAuth: [] }],
      },
    })
}
