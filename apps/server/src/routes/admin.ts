import type { ProviderCallStats } from '@excuse/metrics'
import type { AdminApiKeyListResponse, AdminAuditLogItem, AdminAuditLogListResponse, AdminGatewayClientDetailResponse, AdminGatewayClientListResponse, AdminOverviewResponse, AdminProjectItem, AdminProjectListResponse, AdminProviderStatsItem, AdminProviderStatsResponse, AdminTaskDetailResponse, AdminTaskListResponse, AdminTaskMutationResponse, AdminUserDetailResponse, AdminUserListResponse } from '@excuse/shared'
import type { ServerConfig } from '../config'
import { cancelAdminTask, countAuditLogs, getAdminGatewayClientDetail, getAdminOverview, getAdminProviderStats, getAdminTaskDetail, getAdminUserDetail, listAdminApiKeysByAccount, listAdminGatewayClients, listAdminProjects, listAdminTasks, listAdminUsers, queryAuditLogs, requeueAdminTask, resetApiKeySpend, revokeApiKeyAdmin, updateApiKeyConfig } from '@excuse/db'
import { Elysia, t } from 'elysia'
import { createRequireAuthPlugin } from '../plugins/auth'
import { audit } from '../services/audit'
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
    .get('/tasks/:id', async ({ adminAllowed, adminDenied, params, set }) => {
      if (!adminAllowed)
        return adminDenied()

      const detail = await getAdminTaskDetail(params.id)
      if (!detail)
        return notFound(set, '任务不存在')

      return {
        success: true,
        data: detail,
      } satisfies AdminTaskDetailResponse
    }, {
      params: t.Object({ id: t.String() }),
      detail: {
        summary: '查询任务详情（含 Canvas pipeline run 级联）',
        description: '单任务下钻：task 基本信息 + 关联的 canvas_pipeline_runs 时间线（phase/status/durationMs/errorMessage），用于定位失败任务卡在哪个阶段。',
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
    .get('/projects', async ({ adminAllowed, adminDenied, query }) => {
      if (!adminAllowed)
        return adminDenied()

      const result = await listAdminProjects({
        search: query.search,
        status: query.status,
        isDeleted: query.isDeleted,
        limit: query.limit,
        offset: query.offset,
      })

      const items: AdminProjectItem[] = result.items.map((row) => {
        const prefs = row.modelPreferencesJson as Record<string, string> | null
        const parts: string[] = []
        if (prefs?.textModel) {
          parts.push(`文本:${prefs.textModel}`)
        }
        if (prefs?.imageModel) {
          parts.push(`图片:${prefs.imageModel}`)
        }
        if (prefs?.videoModel) {
          parts.push(`视频:${prefs.videoModel}`)
        }
        return {
          id: row.id,
          accountId: row.accountId,
          username: row.username,
          title: row.title ?? '',
          status: row.status,
          shotCount: row.shotCount,
          completedShotCount: row.completedShotCount,
          modelSummary: parts.join(' ') || '默认',
          isDeleted: row.isDeleted,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt?.toISOString() ?? null,
        }
      })

      return {
        success: true,
        items,
        total: result.total,
      } satisfies AdminProjectListResponse
    }, {
      query: t.Object({
        search: t.Optional(t.String()),
        status: t.Optional(t.String()),
        isDeleted: t.Optional(t.Boolean()),
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
      }),
      detail: {
        summary: '查询 Canvas 项目列表',
        description: '管理后台项目细粒度检索：按标题搜索、按状态过滤、分页，返回镜头数/完成数/模型偏好摘要。',
        tags: ['管理后台'],
        security: [{ bearerAuth: [] }],
      },
    })
    .get('/audit-logs', async ({ adminAllowed, adminDenied, query }) => {
      if (!adminAllowed)
        return adminDenied()

      const from = query.from ? new Date(query.from) : undefined
      const to = query.to ? new Date(query.to) : undefined

      const [rows, total] = await Promise.all([
        queryAuditLogs({
          accountId: query.accountId,
          action: query.action,
          from,
          to,
          limit: query.limit,
          offset: query.offset,
        }),
        countAuditLogs({
          accountId: query.accountId,
          action: query.action,
          from,
          to,
        }),
      ])

      const items: AdminAuditLogItem[] = rows.map(row => ({
        id: row.id,
        accountId: row.accountId,
        action: row.action,
        targetId: row.targetId,
        detail: row.detail as Record<string, unknown> | null,
        ip: row.ip,
        createdAt: row.createdAt.toISOString(),
      }))

      return {
        success: true,
        items,
        total,
      } satisfies AdminAuditLogListResponse
    }, {
      query: t.Object({
        accountId: t.Optional(t.String()),
        action: t.Optional(t.String()),
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
      }),
      detail: {
        summary: '查询审计日志',
        description: '管理后台审计日志检索：按用户/操作类型/时间范围过滤分页，仅展示，不做删除/修改。',
        tags: ['管理后台'],
        security: [{ bearerAuth: [] }],
      },
    })
    .get('/users/:id/api-keys', async ({ adminAllowed, adminDenied, params }) => {
      if (!adminAllowed)
        return adminDenied()

      const keys = await listAdminApiKeysByAccount(params.id)

      const items = keys.map(key => ({
        id: key.id,
        prefix: key.prefix,
        name: key.name,
        scope: key.scope,
        rateLimitPerMinute: key.rateLimitPerMinute,
        quotaMaxCents: key.quotaMaxCents,
        totalSpendCents: key.totalSpendCents,
        quotaResetAt: key.quotaResetAt?.toISOString() ?? null,
        lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
        createdAt: key.createdAt.toISOString(),
        revokedAt: key.revokedAt?.toISOString() ?? null,
      }))

      return {
        success: true,
        items,
      } satisfies AdminApiKeyListResponse
    }, {
      params: t.Object({ id: t.String() }),
      detail: {
        summary: '查询用户 API Key 列表',
        description: '管理后台查询指定用户的所有 API Key（含已撤销的）。包含 scope/quota/rate-limit 信息。',
        tags: ['管理后台'],
        security: [{ bearerAuth: [] }],
      },
    })
    .patch('/api-keys/:id/config', async ({ adminAllowed, adminDenied, params, body, set, userId }) => {
      if (!adminAllowed)
        return adminDenied()

      const updated = await updateApiKeyConfig(params.id, body.userId, {
        scope: body.scope as 'all' | 'gateway' | undefined,
        rateLimitPerMinute: body.rateLimitPerMinute,
        quotaMaxCents: body.quotaMaxCents,
      })
      if (!updated)
        return notFound(set, 'API Key 不存在')

      audit('admin_action', {
        accountId: userId,
        targetId: params.id,
        detail: { type: 'api_key_config', scope: body.scope, rateLimitPerMinute: body.rateLimitPerMinute, quotaMaxCents: body.quotaMaxCents },
      })

      return { success: true }
    }, {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        userId: t.String(),
        scope: t.Optional(t.String({ maxLength: 20 })),
        rateLimitPerMinute: t.Optional(t.Nullable(t.Number({ minimum: 1, maximum: 10000 }))),
        quotaMaxCents: t.Optional(t.Nullable(t.Number({ minimum: 1 }))),
      }),
      detail: {
        summary: '更新 API Key 配置',
        description: '管理后台更新指定 API Key 的 scope/rate-limit/quota 配置',
        tags: ['管理后台'],
        security: [{ bearerAuth: [] }],
      },
    })
    .get('/gateway-clients', async ({ adminAllowed, adminDenied, query }) => {
      if (!adminAllowed)
        return adminDenied()

      const result = await listAdminGatewayClients({
        search: query.search,
        limit: query.limit,
        offset: query.offset,
      })
      return {
        success: true,
        items: result.items,
        total: result.total,
      } satisfies AdminGatewayClientListResponse
    }, {
      query: t.Object({
        search: t.Optional(t.String()),
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
      }),
      detail: {
        summary: '查询 Gateway 客户列表',
        description: '持有 ≥1 个 API Key 的账户聚合视图：活跃/总 key 数、Key 消耗、额度上限、最近活动。支持搜索与分页。',
        tags: ['管理后台'],
        security: [{ bearerAuth: [] }],
      },
    })
    .get('/gateway-clients/:accountId', async ({ adminAllowed, adminDenied, params, set }) => {
      if (!adminAllowed)
        return adminDenied()

      const detail = await getAdminGatewayClientDetail(params.accountId)
      if (!detail)
        return notFound(set, 'Gateway 客户不存在')

      const items = detail.keys.map(key => ({
        id: key.id,
        prefix: key.prefix,
        name: key.name,
        scope: key.scope,
        rateLimitPerMinute: key.rateLimitPerMinute,
        quotaMaxCents: key.quotaMaxCents,
        totalSpendCents: key.totalSpendCents,
        quotaResetAt: key.quotaResetAt?.toISOString() ?? null,
        lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
        createdAt: key.createdAt.toISOString(),
        revokedAt: key.revokedAt?.toISOString() ?? null,
      }))

      return {
        success: true,
        data: {
          summary: detail.summary,
          keys: items,
          recentGatewayRecords: detail.recentGatewayRecords,
        },
      } satisfies AdminGatewayClientDetailResponse
    }, {
      params: t.Object({ accountId: t.String() }),
      detail: {
        summary: '查询 Gateway 客户详情',
        description: '单客户下钻：账户摘要（余额/key 聚合/gateway 调用）+ 全部 key（含已撤销）+ 最近 50 条 Gateway 调用记录。',
        tags: ['管理后台'],
        security: [{ bearerAuth: [] }],
      },
    })
    .post('/api-keys/:id/reset-quota', async ({ adminAllowed, adminDenied, params, userId }) => {
      if (!adminAllowed)
        return adminDenied()

      await resetApiKeySpend(params.id)
      audit('admin_action', {
        accountId: userId,
        targetId: params.id,
        detail: { type: 'api_key_quota_reset' },
      })

      return { success: true }
    }, {
      params: t.Object({ id: t.String() }),
      detail: {
        summary: '重置 API Key 额度',
        description: '将指定 API Key 的 totalSpendCents 归零并清除 quotaResetAt（手动重置配额周期）。',
        tags: ['管理后台'],
        security: [{ bearerAuth: [] }],
      },
    })
    .post('/api-keys/:id/revoke', async ({ adminAllowed, adminDenied, params, set, userId }) => {
      if (!adminAllowed)
        return adminDenied()

      const revoked = await revokeApiKeyAdmin(params.id)
      if (!revoked)
        return conflict(set, 'API Key 不存在或已撤销')

      audit('api_key_revoke', {
        accountId: userId,
        targetId: params.id,
      })

      return { success: true }
    }, {
      params: t.Object({ id: t.String() }),
      detail: {
        summary: '管理员撤销 API Key',
        description: '管理员撤销任意 API Key（无需 owner 校验）。已撤销或不存在返回 409。',
        tags: ['管理后台'],
        security: [{ bearerAuth: [] }],
      },
    })
}
