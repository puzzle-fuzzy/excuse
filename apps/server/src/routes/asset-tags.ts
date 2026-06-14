import type { AssetTagCreateResponse, AssetTagDTO, AssetTagListResponse, AssetTagMutationResponse } from '@excuse/shared'
import type { ServerConfig } from '../config'
import { createAssetTag, deleteAssetTag, listAssetTags } from '@excuse/db'
import { Elysia, t } from 'elysia'
import { createRequireAuthPlugin } from '../plugins/auth'
import { conflict, validationError } from '../utils/errors'

const MAX_NAME_LENGTH = 32

/** AssetTagRow → AssetTagDTO：Date → ISO 字符串 */
function serializeTag(row: { id: string, name: string, createdAt: Date }): AssetTagDTO {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * 资产标签 CRUD 路由
 *
 * 路径前缀 /api/asset-tags，与 /api/assets/... 区分。
 * 标签是用户私有的，所有操作按 accountId 隔离。
 *
 * 不走 audit：与 favorite toggle 一致，避免扩 audit 枚举触碰既有 schema。
 */
export function createAssetTagRoutes(config: ServerConfig) {
  return new Elysia({ prefix: '/api/asset-tags' })
    .use(createRequireAuthPlugin(config))
    .get('/', async ({ userId }) => {
      const rows = await listAssetTags(userId)
      return { success: true, items: rows.map(serializeTag) } satisfies AssetTagListResponse
    }, {
      detail: {
        summary: '列出当前用户全部标签',
        description: '按 createdAt desc 返回当前用户私有的全部资产标签。跨账号隔离。',
        tags: ['资产'],
        security: [{ bearerAuth: [] }],
      },
    })

    .post('/', async ({ userId, body, set }) => {
      const name = body.name.trim()
      if (!name)
        return validationError(set, '标签名不能为空')
      if (name.length > MAX_NAME_LENGTH)
        return validationError(set, `标签名最长 ${MAX_NAME_LENGTH} 字符`)

      try {
        const row = await createAssetTag({ accountId: userId, name })
        return { success: true, data: serializeTag(row) } satisfies AssetTagCreateResponse
      }
      catch (err) {
        // 23505 = unique_violation：同账号重名
        const cause = (err as { cause?: { code?: string } }).cause
        if (cause?.code === '23505')
          return conflict(set, '同名标签已存在')
        throw err
      }
    }, {
      body: t.Object({
        name: t.String({ description: '标签名，trim 后 1-32 字符，同账号下唯一' }),
      }),
      detail: {
        summary: '创建标签',
        description: '创建用户私有标签。trim 后 1-32 字符；同账号重名返回 409。',
        tags: ['资产'],
        security: [{ bearerAuth: [] }],
      },
    })

    .delete('/:id', async ({ userId, params }) => {
      // 双重过滤（accountId + id）防止跨账号删除；不存在的 id 静默忽略。
      // 标签下的 assignment 通过 ON DELETE CASCADE 自动级联删除。
      await deleteAssetTag({ accountId: userId, tagId: params.id })
      return { success: true } satisfies AssetTagMutationResponse
    }, {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        summary: '删除标签',
        description: '删除用户私有标签（幂等，不存在返回 200）。该标签下的所有分配通过 ON DELETE CASCADE 自动级联删除。',
        tags: ['资产'],
        security: [{ bearerAuth: [] }],
      },
    })
}
