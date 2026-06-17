import type {
  AssetDeleteResponse,
  AssetLibraryKind,
  AssetLibraryListResponse,
  AssetLibrarySource,
  AssetLibraryStatusFilter,
  AssetRestoreResponse,
} from '@excuse/shared'
import type { ServerConfig } from '../config'
import {
  addAssetFavorite,
  assignAssetTag,
  findAssetTagById,
  getAssetReferences,
  getCanvasAssetByIdForAccount,
  getGenerationRecordByIdForAccount,
  getUploadedFileByIdForAccount,
  hideCanvasAsset,
  hideGenerationRecord,
  removeAssetFavorite,
  restoreCanvasAsset,
  restoreGenerationRecord,
  restoreUploadedFile,
  softDeleteCanvasAsset,
  softDeleteGenerationRecord,
  softDeleteUploadedFile,
  unassignAssetTag,
  unhideCanvasAsset,
  unhideGenerationRecord,
} from '@excuse/db'
import { Elysia, t } from 'elysia'
import * as svc from '../modules/assets/service'
import { createRequireAuthPlugin } from '../plugins/auth'
import { audit } from '../services/audit'
import { ConflictError, NotFoundError, ValidationError } from '../utils/app-errors'

/**
 * 统一资产中心路由 — GET /api/assets（+ 隐藏/恢复/软删/收藏/标签 mutation）
 *
 * GET 列表把三种来源（generation_records / canvas_assets / uploaded_files）合并成同一份
 * AssetLibraryItem 列表，**三来源合并查询与序列化的业务逻辑已抽到 `modules/assets/service.ts`**
 * （`listAssetLibrary` + 来源规划/映射/排序/分页），本文件只做 HTTP query 解析 + 响应塑形 +
 * audit + 轻量 mutation（隐藏/删除/收藏/打标，归属校验 + 审计）。
 *
 * 关键约束：
 *   - 所有查询按 accountId 隔离（createRequireAuthPlugin 保证 userId 存在）。
 *   - previewUrl / downloadUrl 优先稳定 publicUrl，不暴露 provider 临时 URL（在 service 内）。
 *   - 不把 inputJson / outputJson 原样返回给前端，只提取标量字段（在 service 内）。
 */

export function createAssetsRoutes(config: ServerConfig) {
  return new Elysia({ prefix: '/api' })
    .use(createRequireAuthPlugin(config))
    .get('/assets', async ({ query, userId }) => {
      // query 规整（解析 + clamp）后委托 service 做三来源合并查询与序列化
      const search = (() => {
        const raw = typeof query.search === 'string' ? query.search.trim() : ''
        return raw.length > 0 ? raw.slice(0, 120) : undefined
      })()
      const page = await svc.listAssetLibrary(userId, {
        source: (query.source ?? 'all') as 'all' | AssetLibrarySource,
        kind: (query.kind ?? 'all') as 'all' | AssetLibraryKind,
        status: (query.status ?? 'all') as AssetLibraryStatusFilter | 'all',
        projectId: typeof query.projectId === 'string' && query.projectId.length > 0 ? query.projectId : undefined,
        model: typeof query.model === 'string' && query.model.length > 0 ? query.model : undefined,
        search,
        createdFrom: svc.parseDateParam(query.createdFrom),
        createdTo: svc.parseDateParam(query.createdTo),
        sort: svc.resolveSort(typeof query.sort === 'string' ? query.sort : undefined),
        favorite: query.favorite === true,
        tagIdFilter: svc.parseTagIdFilter(typeof query.tagIds === 'string' ? query.tagIds : undefined),
        limit: svc.clampInt(query.limit, 1, svc.MAX_LIMIT, 100),
        offset: svc.clampInt(query.offset, 0, Number.MAX_SAFE_INTEGER, 0),
      })

      return { success: true, items: page.items, total: page.total, hasMore: page.hasMore } satisfies AssetLibraryListResponse
    }, {
      query: t.Object({
        source: t.Optional(t.String()),
        kind: t.Optional(t.String()),
        status: t.Optional(t.String()),
        projectId: t.Optional(t.String()),
        model: t.Optional(t.String()),
        search: t.Optional(t.String({ description: '关键词搜索' })),
        createdFrom: t.Optional(t.String()),
        createdTo: t.Optional(t.String()),
        sort: t.Optional(t.String({ description: '排序：created_desc（默认） / created_asc / title_asc / title_desc' })),
        favorite: t.Optional(t.Boolean({ description: '仅返回当前用户已收藏的资产（默认 false）' })),
        tagIds: t.Optional(t.String({ description: '标签 ID 列表（逗号分隔），OR 关系：返回打了任一标签的资产' })),
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
      }),
      detail: {
        summary: '获取统一资产列表',
        description: '合并 generation_records / canvas_assets / uploaded_files 三种来源，支持按 source（来源表）、kind（资产类别）、status（状态）、projectId、model、search（关键词搜索）、createdFrom/createdTo 过滤，sort 排序（created_desc / created_asc / title_asc / title_desc，默认 created_desc，非法值静默回落），favorite=true 时仅返回当前用户已收藏的资产并在每条 item 上注入 isFavorite 字段，tagIds（逗号分隔）按 OR 关系过滤并注入 tagNames 字段（用户私有标签），limit/offset 分页（limit 上限 200）。所有查询按当前用户隔离。previewUrl 优先稳定 publicUrl。hasMore 为轻量分页标记（返回条数 >= limit 时为 true；favorite/tagIds 过滤后可能少于 limit，但 hasMore 仍按原 limit 触发，v1 已知限制）。search 与其他过滤条件为 AND 关系，服务端 trim 后生效，限长 120 字符。',
        tags: ['资产'],
        security: [{ bearerAuth: [] }],
      },
    })

    // ── 隐藏资产（从资产中心移除，不删除 DB 记录） ──────────────────────────
    .post('/assets/:source/:id/hide', async ({ params: { source, id }, userId }) => {
      if (source === 'generation_record') {
        const record = await getGenerationRecordByIdForAccount(id, userId)
        if (!record)
          throw new NotFoundError('生成记录不存在或无权限访问')
        await hideGenerationRecord(id)
        audit('asset_hide', { accountId: userId, targetId: id, detail: { source, id } })
        return { success: true }
      }

      if (source === 'canvas_asset') {
        const asset = await getCanvasAssetByIdForAccount(id, userId)
        if (!asset)
          throw new NotFoundError('Canvas 资产不存在或无权限访问')
        // 拒绝隐藏正在生成中的资产
        if (asset.status === 'queued' || asset.status === 'running')
          throw new ConflictError('正在生成中的资产不能隐藏')
        await hideCanvasAsset(id)
        audit('asset_hide', { accountId: userId, targetId: id, detail: { source, id } })
        return { success: true }
      }

      throw new ValidationError('只支持隐藏 generation_record 或 canvas_asset')
    }, {
      params: t.Object({
        source: t.Union([t.Literal('generation_record'), t.Literal('canvas_asset')]),
        id: t.String(),
      }),
      detail: {
        summary: '隐藏资产',
        description: '将 generation_record 或 canvas_asset 从资产中心隐藏（设置 hiddenAt），不删除 DB 记录或存储文件。canvas_asset 状态为 queued/running 时拒绝隐藏（返回 409）。uploaded_file 请使用独立的删除接口。',
        tags: ['资产'],
        security: [{ bearerAuth: [] }],
      },
    })

    // ── 取消隐藏（恢复误隐藏资产） ──────────────────────────────────────────
    .post('/assets/:source/:id/unhide', async ({ params: { source, id }, userId }) => {
      if (source === 'generation_record') {
        const record = await getGenerationRecordByIdForAccount(id, userId)
        if (!record)
          throw new NotFoundError('生成记录不存在或无权限访问')
        await unhideGenerationRecord(id)
      }
      else if (source === 'canvas_asset') {
        const asset = await getCanvasAssetByIdForAccount(id, userId)
        if (!asset)
          throw new NotFoundError('Canvas 资产不存在或无权限访问')
        await unhideCanvasAsset(id)
      }
      else {
        throw new ValidationError('只支持取消隐藏 generation_record 或 canvas_asset')
      }
      audit('asset_hide', { accountId: userId, targetId: id, detail: { source, id, action: 'unhide' } })
      return { success: true, source, id } satisfies AssetRestoreResponse
    }, {
      params: t.Object({
        source: t.Union([t.Literal('generation_record'), t.Literal('canvas_asset')]),
        id: t.String(),
      }),
      detail: {
        summary: '取消隐藏资产',
        description: '清除 hiddenAt，把误隐藏的 generation_record / canvas_asset 恢复到资产中心。',
        tags: ['资产'],
        security: [{ bearerAuth: [] }],
      },
    })

    // ── 软删除（引用守卫：仍被引用则 retained，不物理清除） ────────────────────
    .delete('/assets/:source/:id', async ({ params: { source, id }, userId }) => {
      // 归属校验 + 正在生成的 canvas_asset 拒绝删除
      if (source === 'canvas_asset') {
        const asset = await getCanvasAssetByIdForAccount(id, userId)
        if (!asset)
          throw new NotFoundError('Canvas 资产不存在或无权限访问')
        if (asset.status === 'queued' || asset.status === 'running')
          throw new ConflictError('正在生成中的资产不能删除')
      }
      else if (source === 'generation_record') {
        const record = await getGenerationRecordByIdForAccount(id, userId)
        if (!record)
          throw new NotFoundError('生成记录不存在或无权限访问')
      }
      else if (source === 'uploaded_file') {
        const file = await getUploadedFileByIdForAccount(id, userId)
        if (!file)
          throw new NotFoundError('上传文件不存在或无权限访问')
      }

      // 引用守卫：决定 retained 标记（仍被引用 → GC 不物理清除）
      const references = await getAssetReferences(source, userId, id)

      // 软删除（置 deletedAt）
      if (source === 'canvas_asset')
        await softDeleteCanvasAsset(id, userId)
      else if (source === 'generation_record')
        await softDeleteGenerationRecord(id, userId)
      else
        await softDeleteUploadedFile(id, userId)

      audit('admin_action', { accountId: userId, targetId: id, detail: { source, id, action: 'soft_delete', retained: references.retained } })
      return { success: true, source, id, retained: references.retained, references } satisfies AssetDeleteResponse
    }, {
      params: t.Object({
        source: t.Union([t.Literal('generation_record'), t.Literal('canvas_asset'), t.Literal('uploaded_file')]),
        id: t.String(),
      }),
      detail: {
        summary: '软删除资产',
        description: '置 deletedAt 软删除，从资产中心移除。删除前做引用守卫：若仍被项目 / 镜头 / 生成记录引用（referenceAssetsJson / isActive 版本 / videoFileId / referenceFileIds），标记 retained=true，retention GC 不会物理清除其存储文件，保证 Canvas 预览与后续生成不破裂；未引用则过宽限期后由 GC 物理清除。canvas_asset 状态为 queued/running 时拒绝删除（409）。',
        tags: ['资产'],
        security: [{ bearerAuth: [] }],
      },
    })

    // ── 恢复（un-delete）软删除的资产 ────────────────────────────────────────
    .post('/assets/:source/:id/restore', async ({ params: { source, id }, userId }) => {
      let restored = false
      if (source === 'canvas_asset')
        restored = await restoreCanvasAsset(id, userId)
      else if (source === 'generation_record')
        restored = await restoreGenerationRecord(id, userId)
      else
        restored = await restoreUploadedFile(id, userId)

      if (!restored)
        throw new NotFoundError('资产不存在或无权限访问')

      audit('admin_action', { accountId: userId, targetId: id, detail: { source, id, action: 'restore' } })
      return { success: true, source, id } satisfies AssetRestoreResponse
    }, {
      params: t.Object({
        source: t.Union([t.Literal('generation_record'), t.Literal('canvas_asset'), t.Literal('uploaded_file')]),
        id: t.String(),
      }),
      detail: {
        summary: '恢复软删除的资产',
        description: '清除 deletedAt，把误删除的资产恢复到资产中心（GC 物理清除前均可恢复）。',
        tags: ['资产'],
        security: [{ bearerAuth: [] }],
      },
    })

    // ── 收藏 toggle（用户级收藏标记，幂等） ─────────────────────────────────
    //
    // 不走 audit：audit_action 枚举当前不含 asset_favorite_add/remove，
    // 扩枚举会触碰既有 schema 文件，与本轮边界冲突；favorite toggle 是用户对
    // 个人资产的轻量标记，参照 notify/SSE 等高频内部操作也不进 audit 的做法。
    // 如产品后续要求审计，下一轮单独扩 audit 枚举。
    .post('/assets/:source/:id/favorite', async ({ params: { source, id }, userId }) => {
      // source 校验已由 params schema 完成（t.Union Literal）。
      await addAssetFavorite({ accountId: userId, source, assetId: id })
      return { success: true as const, data: { isFavorite: true as const } }
    }, {
      params: t.Object({
        source: t.Union([
          t.Literal('generation_record'),
          t.Literal('canvas_asset'),
          t.Literal('uploaded_file'),
        ]),
        id: t.String(),
      }),
      detail: {
        summary: '收藏资产',
        description: '将 generation_record / canvas_asset / uploaded_file 三种来源的资产加入当前用户收藏（幂等，已收藏则保持）。返回 { success: true, data: { isFavorite: true } } 作为权威状态。',
        tags: ['资产'],
        security: [{ bearerAuth: [] }],
      },
    })

    .delete('/assets/:source/:id/favorite', async ({ params: { source, id }, userId }) => {
      await removeAssetFavorite({ accountId: userId, source, assetId: id })
      return { success: true as const, data: { isFavorite: false as const } }
    }, {
      params: t.Object({
        source: t.Union([
          t.Literal('generation_record'),
          t.Literal('canvas_asset'),
          t.Literal('uploaded_file'),
        ]),
        id: t.String(),
      }),
      detail: {
        summary: '取消收藏资产',
        description: '将资产从当前用户收藏中移除（幂等，未收藏则保持）。返回 { success: true, data: { isFavorite: false } } 作为权威状态。',
        tags: ['资产'],
        security: [{ bearerAuth: [] }],
      },
    })

    // ── 标签 assign/unassign（用户私有标签，幂等） ───────────────────────────
    //
    // 不走 audit：与 favorite toggle 一致，避免扩 audit 枚举触碰既有 schema。
    // assign 时校验 tag 属于当前用户（避免给不存在 / 他人的标签打标）。
    // 资产本身的归属校验（assetId 是否属于当前用户）v1 暂不做（与 favorite endpoint 一致）。
    .post('/assets/:source/:id/tags/:tagId', async ({ params: { source, id, tagId }, userId }) => {
      const tag = await findAssetTagById({ accountId: userId, tagId })
      if (!tag)
        throw new NotFoundError('标签不存在')
      await assignAssetTag({ accountId: userId, tagId, source, assetId: id })
      return { success: true as const }
    }, {
      params: t.Object({
        source: t.Union([
          t.Literal('generation_record'),
          t.Literal('canvas_asset'),
          t.Literal('uploaded_file'),
        ]),
        id: t.String(),
        tagId: t.String(),
      }),
      detail: {
        summary: '给资产打标签',
        description: '将指定标签打在资产上（幂等，已打标则保持）。tagId 不存在或不属于当前用户时返回 404。source 必须是 generation_record / canvas_asset / uploaded_file 之一。',
        tags: ['资产'],
        security: [{ bearerAuth: [] }],
      },
    })

    .delete('/assets/:source/:id/tags/:tagId', async ({ params: { source, id, tagId }, userId }) => {
      await unassignAssetTag({ accountId: userId, tagId, source, assetId: id })
      return { success: true as const }
    }, {
      params: t.Object({
        source: t.Union([
          t.Literal('generation_record'),
          t.Literal('canvas_asset'),
          t.Literal('uploaded_file'),
        ]),
        id: t.String(),
        tagId: t.String(),
      }),
      detail: {
        summary: '取消资产的标签',
        description: '将指定标签从资产上移除（幂等，未打标则保持）。不校验 tagId 归属（unassign 不存在的标签同样幂等成功）。',
        tags: ['资产'],
        security: [{ bearerAuth: [] }],
      },
    })
}
