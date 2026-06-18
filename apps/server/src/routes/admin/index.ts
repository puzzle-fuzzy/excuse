/**
 * 管理后台路由 barrel — 按子域拆分为 handler 文件
 *
 * 路由列表（按子域）：
 *   overview          — GET  /overview
 *   tasks             — GET  /tasks · GET  /tasks/:id · POST /tasks/:id/requeue · POST /tasks/:id/cancel
 *   users             — GET  /users · GET  /users/:id · GET  /users/:id/api-keys
 *   providers         — GET  /providers · GET  /provider-health · POST /provider-health/:model/restore
 *   asset-retention   — POST /asset-retention/run
 *   projects          — GET  /projects
 *   audit-logs        — GET  /audit-logs
 *   api-keys          — PATCH /api-keys/:id/config · POST /api-keys/:id/reset-quota · POST /api-keys/:id/revoke
 *   gateway-clients   — GET  /gateway-clients · GET  /gateway-clients/:accountId
 *   credit            — POST /credit/add
 *
 * Admin 鉴权：createRequireAuthPlugin → resolve 检查 adminUserIds，
 * 非管理员直接 throw ForbiddenError，handler 不再手写守卫。
 */
import type { ServerConfig } from '../../config'
import { Elysia, t } from 'elysia'
import { createRequireAuthPlugin } from '../../plugins/auth'
import { ForbiddenError } from '../../utils/app-errors'
import { handleResetApiKeyQuota, handleRevokeApiKey, handleUpdateApiKeyConfig } from './api-keys'
import { handleRunAssetRetention } from './asset-retention'
import { handleListAuditLogs } from './audit-logs'
import { handleCreditAdd } from './credit'
import { handleGetGatewayClientDetail, handleListGatewayClients } from './gateway-clients'
import { handleGetOverview } from './overview'
import { handleListProjects } from './projects'
import { handleGetProviderStats, handleListProviderHealth, handleRestoreProviderHealth } from './providers'
import { handleCancelTask, handleGetTaskDetail, handleListTasks, handleRequeueTask } from './tasks'
import { handleGetUserDetail, handleListUserApiKeys, handleListUsers } from './users'

export function createAdminRoutes(config: ServerConfig) {
  return new Elysia({ prefix: '/api/admin' })
    .use(createRequireAuthPlugin(config))
    // Admin 鉴权守卫：非 JWT 或不在管理员名单 → 直接 403
    .resolve(({ userId, authMethod }) => {
      if (authMethod !== 'jwt' || !(config.adminUserIds ?? []).includes(userId)) {
        throw new ForbiddenError('无权访问管理后台')
      }
    })

    // ── 概览 ──────────────────────────────────────────────────
    .get('/overview', async () => handleGetOverview(), {
      detail: {
        summary: '获取管理后台概览',
        description: '返回用户、生成、任务队列、Canvas 状态和最近失败摘要。',
        tags: ['管理后台'],
        security: [{ bearerAuth: [] }],
      },
    })

    // ── 任务队列 ──────────────────────────────────────────────
    .get('/tasks', async ({ query }) => handleListTasks(query), {
      query: t.Object({
        status: t.Optional(t.String()),
        domain: t.Optional(t.String()),
        search: t.Optional(t.String()),
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
      }),
      detail: { summary: '查询统一任务队列', tags: ['管理后台'], security: [{ bearerAuth: [] }] },
    })
    .get('/tasks/:id', async ({ params }) => handleGetTaskDetail(params.id), {
      params: t.Object({ id: t.String() }),
      detail: { summary: '查询任务详情（含 Canvas pipeline run 级联）', tags: ['管理后台'], security: [{ bearerAuth: [] }] },
    })
    .post('/tasks/:id/requeue', async ({ params }) => handleRequeueTask(params.id), {
      params: t.Object({ id: t.String() }),
      detail: { summary: '重新排队任务', tags: ['管理后台'], security: [{ bearerAuth: [] }] },
    })
    .post('/tasks/:id/cancel', async ({ params }) => handleCancelTask(params.id), {
      params: t.Object({ id: t.String() }),
      detail: { summary: '取消任务', tags: ['管理后台'], security: [{ bearerAuth: [] }] },
    })

    // ── 用户管理 ──────────────────────────────────────────────
    .get('/users', async ({ query }) => handleListUsers(query), {
      query: t.Object({
        search: t.Optional(t.String()),
        isActive: t.Optional(t.Boolean()),
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
      }),
      detail: { summary: '查询用户列表', tags: ['管理后台'], security: [{ bearerAuth: [] }] },
    })
    .get('/users/:id', async ({ params }) => handleGetUserDetail(params.id), {
      params: t.Object({ id: t.String() }),
      detail: { summary: '查询用户详情', tags: ['管理后台'], security: [{ bearerAuth: [] }] },
    })
    .get('/users/:id/api-keys', async ({ params }) => handleListUserApiKeys(params.id), {
      params: t.Object({ id: t.String() }),
      detail: { summary: '查询用户 API Key 列表', tags: ['管理后台'], security: [{ bearerAuth: [] }] },
    })

    // ── Provider 统计 + 降级状态 ───────────────────────────────
    .get('/providers', async ({ query }) => handleGetProviderStats(config, query), {
      query: t.Object({ windowHours: t.Optional(t.Numeric()) }),
      detail: { summary: '查询 provider 错误率与模型成本统计', tags: ['管理后台'], security: [{ bearerAuth: [] }] },
    })
    .get('/provider-health', async () => handleListProviderHealth(), {
      detail: { summary: '查询 provider 模型降级状态', tags: ['管理后台'], security: [{ bearerAuth: [] }] },
    })
    .post('/provider-health/:model/restore', async ({ params, userId }) => handleRestoreProviderHealth(params.model, userId), {
      params: t.Object({ model: t.String() }),
      detail: { summary: '手动恢复模型降级状态', tags: ['管理后台'], security: [{ bearerAuth: [] }] },
    })

    // ── 资产 GC ────────────────────────────────────────────────
    .post('/asset-retention/run', async ({ query }) => handleRunAssetRetention(config, query), {
      query: t.Object({ dryRun: t.Optional(t.Boolean()), graceDays: t.Optional(t.Numeric()) }),
      detail: { summary: '执行资产 retention GC', tags: ['管理后台'], security: [{ bearerAuth: [] }] },
    })

    // ── Canvas 项目 ───────────────────────────────────────────
    .get('/projects', async ({ query }) => handleListProjects(query), {
      query: t.Object({
        search: t.Optional(t.String()),
        status: t.Optional(t.String()),
        isDeleted: t.Optional(t.Boolean()),
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
      }),
      detail: { summary: '查询 Canvas 项目列表', tags: ['管理后台'], security: [{ bearerAuth: [] }] },
    })

    // ── 审计日志 ──────────────────────────────────────────────
    .get('/audit-logs', async ({ query }) => handleListAuditLogs(query), {
      query: t.Object({
        accountId: t.Optional(t.String()),
        action: t.Optional(t.String()),
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
      }),
      detail: { summary: '查询审计日志', tags: ['管理后台'], security: [{ bearerAuth: [] }] },
    })

    // ── API Key 管理 ──────────────────────────────────────────
    .patch('/api-keys/:id/config', async ({ params, body, userId }) => handleUpdateApiKeyConfig(params.id, body, userId), {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        userId: t.String(),
        scope: t.Optional(t.String({ maxLength: 20 })),
        rateLimitPerMinute: t.Optional(t.Nullable(t.Number({ minimum: 1, maximum: 10000 }))),
        quotaMaxCents: t.Optional(t.Nullable(t.Number({ minimum: 1 }))),
      }),
      detail: { summary: '更新 API Key 配置', tags: ['管理后台'], security: [{ bearerAuth: [] }] },
    })
    .post('/api-keys/:id/reset-quota', async ({ params, userId }) => handleResetApiKeyQuota(params.id, userId), {
      params: t.Object({ id: t.String() }),
      detail: { summary: '重置 API Key 额度', tags: ['管理后台'], security: [{ bearerAuth: [] }] },
    })
    .post('/api-keys/:id/revoke', async ({ params, userId }) => handleRevokeApiKey(params.id, userId), {
      params: t.Object({ id: t.String() }),
      detail: { summary: '管理员撤销 API Key', tags: ['管理后台'], security: [{ bearerAuth: [] }] },
    })

    // ── Gateway 客户 ──────────────────────────────────────────
    .get('/gateway-clients', async ({ query }) => handleListGatewayClients(query), {
      query: t.Object({ search: t.Optional(t.String()), limit: t.Optional(t.Numeric()), offset: t.Optional(t.Numeric()) }),
      detail: { summary: '查询 Gateway 客户列表', tags: ['管理后台'], security: [{ bearerAuth: [] }] },
    })
    .get('/gateway-clients/:accountId', async ({ params }) => handleGetGatewayClientDetail(params.accountId), {
      params: t.Object({ accountId: t.String() }),
      detail: { summary: '查询 Gateway 客户详情', tags: ['管理后台'], security: [{ bearerAuth: [] }] },
    })

    // ── 充值 ──────────────────────────────────────────────────
    .post('/credit/add', async ({ body, userId }) => handleCreditAdd(body, userId), {
      body: t.Object({
        accountId: t.String(),
        amountCents: t.Number({ minimum: 1 }),
        description: t.Optional(t.String({ maxLength: 500 })),
      }),
      detail: { summary: '用户充值', tags: ['管理后台'], security: [{ bearerAuth: [] }] },
    })
}
