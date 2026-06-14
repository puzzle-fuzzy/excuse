import type { ProviderCallStats } from '@excuse/metrics'
import type { AdminOverviewResponse, AdminProviderStatsItem, AdminProviderStatsResponse, AdminTaskListResponse, AdminTaskMutationResponse, AdminUserDetailResponse, AdminUserListResponse } from '@excuse/shared'
import type { ServerConfig } from '../config'
import { cancelAdminTask, getAdminOverview, getAdminProviderStats, getAdminUserDetail, listAdminTasks, listAdminUsers, requeueAdminTask } from '@excuse/db'
import { Elysia, t } from 'elysia'
import { createRequireAuthPlugin } from '../plugins/auth'
import { getProviderCallsSnapshot } from '../services/metrics'
import { conflict, forbidden, notFound } from '../utils/errors'

function canAccessAdmin(config: ServerConfig, userId: string): boolean {
  return (config.adminUserIds ?? []).includes(userId)
}

function nearestRankPercentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0)
    return 0
  const idx = Math.max(0, Math.ceil(p * sortedAsc.length) - 1)
  return sortedAsc[idx] ?? 0
}

function computeLatency(stats: ProviderCallStats | undefined): { avg: number | null, p50: number | null, p95: number | null } {
  if (!stats || stats.durations.length === 0)
    return { avg: null, p50: null, p95: null }
  const sorted = [...stats.durations].sort((a, b) => a - b)
  const sum = sorted.reduce((acc, value) => acc + value, 0)
  return {
    avg: sum / sorted.length,
    p50: nearestRankPercentile(sorted, 0.5),
    p95: nearestRankPercentile(sorted, 0.95),
  }
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
    .get('/users', async ({ adminAllowed, adminDenied, query }) => {
      if (!adminAllowed)
        return adminDenied()

      const isActive = query.isActive === undefined ? undefined : query.isActive
      const result = await listAdminUsers({
        search: query.search,
        isActive,
        limit: query.limit,
        offset: query.offset,
      })
      return {
        success: true,
        items: result.items,
        total: result.total,
      } satisfies AdminUserListResponse
    }, {
      query: t.Object({
        search: t.Optional(t.String()),
        isActive: t.Optional(t.Boolean()),
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
      }),
      detail: {
        summary: '查询用户列表',
        description: '运营侧用户清单：余额 / 历史成本 / 历史调用次数 + 搜索 + 状态过滤 + 分页。',
        tags: ['管理后台'],
        security: [{ bearerAuth: [] }],
      },
    })
    .get('/users/:id', async ({ adminAllowed, adminDenied, params, set }) => {
      if (!adminAllowed)
        return adminDenied()

      const detail = await getAdminUserDetail(params.id)
      if (!detail)
        return notFound(set, '用户不存在')

      return {
        success: true,
        data: detail,
      } satisfies AdminUserDetailResponse
    }, {
      params: t.Object({ id: t.String() }),
      detail: {
        summary: '查询用户详情',
        description: '单用户下钻：summary + 最近 30 天每日成本 + 模型成本分解（前 10）+ 最近 10 条生成记录。',
        tags: ['管理后台'],
        security: [{ bearerAuth: [] }],
      },
    })
    .get('/providers', async ({ adminAllowed, adminDenied, query }) => {
      if (!adminAllowed)
        return adminDenied()

      const requested = Number(query.windowHours ?? 24)
      const windowHours = Math.min(Math.max(Number.isFinite(requested) ? Math.trunc(requested) : 24, 1), 24 * 30)
      const [dbRows, providerCalls] = await Promise.all([
        getAdminProviderStats(windowHours),
        Promise.resolve(getProviderCallsSnapshot()),
      ])

      const items: AdminProviderStatsItem[] = dbRows.map((row) => {
        const stats: ProviderCallStats | undefined = providerCalls[row.model]
        const latency = computeLatency(stats)
        const failureRate = row.totalCalls > 0 ? row.failedCalls / row.totalCalls : 0
        return {
          model: row.model,
          category: row.category,
          totalCalls: row.totalCalls,
          succeededCalls: row.succeededCalls,
          failedCalls: row.failedCalls,
          failureRate,
          avgLatencyMs: latency.avg,
          p50LatencyMs: latency.p50,
          p95LatencyMs: latency.p95,
          totalCostCents: row.totalCostCents,
          totalInputTokens: row.totalInputTokens,
          totalOutputTokens: row.totalOutputTokens,
        }
      })

      return {
        success: true,
        windowHours,
        items,
      } satisfies AdminProviderStatsResponse
    }, {
      query: t.Object({
        windowHours: t.Optional(t.Numeric()),
      }),
      detail: {
        summary: '查询 provider 错误率与模型成本统计',
        description: '合并 generation_records 聚合（count/cost/tokens）与 server 进程内 metricsCollector（延迟 p50/p95/avg），帮助定位高失败率或高成本模型。',
        tags: ['管理后台'],
        security: [{ bearerAuth: [] }],
      },
    })
}
