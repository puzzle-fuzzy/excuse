import type { ApiKeyCreateResponse, ApiKeyListResponse, ApiKeyScope, MutationOkResponse } from '@excuse/shared'
import type { ServerConfig } from '../config'
import { createApiKeySecret, hashApiKey } from '@excuse/auth'
import { createApiKey, listApiKeysByAccount, revokeApiKey, serialize } from '@excuse/db'
import { Elysia, t } from 'elysia'
import { createRequireAuthPlugin } from '../plugins/auth'
import { audit } from '../services/audit'
import { NotFoundError } from '../utils/app-errors'

const VALID_SCOPES = ['all', 'gateway'] as const

/**
 * API 密钥管理路由
 *
 * POST   /api/keys      — 创建新密钥（返回完整 key，仅此一次）
 * GET    /api/keys      — 列出当前用户所有有效密钥
 * DELETE /api/keys/:id  — 撤销密钥
 */
export function createApiKeyRoutes(config: ServerConfig) {
  return new Elysia({ prefix: '/api/keys' })
    .use(createRequireAuthPlugin(config))
    .post('/', async ({ userId, body }) => {
      const { key: rawKey, prefix } = createApiKeySecret()
      const keyHash = await hashApiKey(rawKey)

      const key = await createApiKey({
        accountId: userId,
        prefix,
        keyHash,
        name: body.name,
        scope: VALID_SCOPES.includes(body.scope as typeof VALID_SCOPES[number])
          ? (body.scope as ApiKeyScope)
          : 'all',
        rateLimitPerMinute: body.rateLimitPerMinute ?? undefined,
        quotaMaxCents: body.quotaMaxCents ?? undefined,
      })

      audit('api_key_create', { accountId: userId, targetId: key.id, detail: { scope: key.scope } })

      return {
        success: true,
        data: { key: rawKey, prefix },
      } satisfies ApiKeyCreateResponse
    }, {
      body: t.Object({
        name: t.Optional(t.String({ maxLength: 100 })),
        scope: t.Optional(t.String({ maxLength: 20 })),
        rateLimitPerMinute: t.Optional(t.Nullable(t.Number({ minimum: 1, maximum: 10000 }))),
        quotaMaxCents: t.Optional(t.Nullable(t.Number({ minimum: 1 }))),
      }),
      detail: {
        summary: '创建 API 密钥',
        description: '生成新密钥，完整 key 仅此一次返回，后续只展示前缀',
        tags: ['API 密钥'],
        security: [{ bearerAuth: [] }],
      },
    })
    .get('/', async ({ userId }) => {
      const keys = await listApiKeysByAccount(userId)
      const serialized = keys.map(serialize)
      return {
        success: true,
        items: serialized,
        total: serialized.length,
      } satisfies ApiKeyListResponse
    }, {
      detail: {
        summary: '列出 API 密钥',
        description: '返回当前用户所有有效（未撤销）的 API 密钥',
        tags: ['API 密钥'],
        security: [{ bearerAuth: [] }],
      },
    })
    .delete('/:id', async ({ userId, params }) => {
      const revoked = await revokeApiKey(params.id, userId)
      if (!revoked)
        throw new NotFoundError('密钥不存在或已撤销')

      audit('api_key_revoke', { accountId: userId, targetId: params.id })

      return { success: true } satisfies MutationOkResponse
    }, {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        summary: '撤销 API 密钥',
        description: '撤销指定密钥，撤销后立即失效',
        tags: ['API 密钥'],
        security: [{ bearerAuth: [] }],
      },
    })
}
