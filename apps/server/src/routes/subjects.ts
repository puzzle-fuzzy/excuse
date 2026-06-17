/**
 * 主体资产库路由 — 跨项目复用角色/场景
 *
 * POST   /api/subjects               — 创建主体资产
 * GET    /api/subjects               — 列表（支持搜索/标签/类型筛选）
 * GET    /api/subjects/:id           — 详情
 * PATCH  /api/subjects/:id           — 更新
 * DELETE /api/subjects/:id           — 删除
 * POST   /api/subjects/:id/favorite  — 切换收藏
 */
import type { ServerConfig } from '../config'
import type { ServerContext } from '../context'
import { createSubject, deleteSubject, getSubjectById, listSubjects, serialize, toggleSubjectFavorite, updateSubject } from '@excuse/db'
import { Elysia, t } from 'elysia'
import { createRequireAuthPlugin } from '../plugins/auth'
import { NotFoundError, ValidationError } from '../utils/app-errors'

export function createSubjectRoutes(config: ServerConfig, _ctx: ServerContext) {
  return new Elysia({ prefix: '/api/subjects' })
    .use(createRequireAuthPlugin(config))

    // ── 创建主体资产 ──────────────────────────────────
    .post('/', async ({ userId, body }) => {
      if (!['character', 'location'].includes(body.subjectType)) {
        throw new ValidationError('主体类型必须是 character 或 location')
      }
      const subject = await createSubject({
        accountId: userId,
        subjectType: body.subjectType as 'character' | 'location',
        name: body.name,
        identityPrompt: body.identityPrompt,
        negativePrompt: body.negativePrompt,
        scenePrompt: body.scenePrompt,
        referenceImageUrl: body.referenceImageUrl,
        turnaroundSheetUrl: body.turnaroundSheetUrl,
        tags: body.tags,
        sourceProjectId: body.sourceProjectId,
        sourceEntityId: body.sourceEntityId,
      })
      return { success: true, data: serialize(subject) }
    }, {
      body: t.Object({
        subjectType: t.String({ maxLength: 20 }),
        name: t.String({ maxLength: 200 }),
        identityPrompt: t.Optional(t.String()),
        negativePrompt: t.Optional(t.String()),
        scenePrompt: t.Optional(t.String()),
        referenceImageUrl: t.Optional(t.String()),
        turnaroundSheetUrl: t.Optional(t.String()),
        tags: t.Optional(t.Array(t.String())),
        sourceProjectId: t.Optional(t.String()),
        sourceEntityId: t.Optional(t.String()),
      }),
      detail: { summary: '创建主体资产', description: '将角色/场景保存到用户级资产库', tags: ['主体资产库'] },
    })

    // ── 列表 ──────────────────────────────────────────
    .get('/', async ({ userId, query }) => {
      const result = await listSubjects({
        accountId: userId,
        subjectType: query.subjectType as 'character' | 'location' | undefined,
        search: query.search,
        isFavorite: query.favorite === 'true' ? true : query.favorite === 'false' ? false : undefined,
        limit: query.limit ?? 20,
        offset: query.offset ?? 0,
      })
      return { success: true, items: result.items.map(serialize), total: result.total }
    }, {
      query: t.Object({
        subjectType: t.Optional(t.String({ maxLength: 20 })),
        search: t.Optional(t.String({ maxLength: 200 })),
        favorite: t.Optional(t.String()),
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
      }),
      detail: { summary: '列出主体资产', description: '支持按类型/搜索/收藏筛选', tags: ['主体资产库'] },
    })

    // ── 详情 ──────────────────────────────────────────
    .get('/:id', async ({ params: { id }, userId }) => {
      const subject = await getSubjectById(id)
      if (!subject || subject.accountId !== userId)
        throw new NotFoundError('资产不存在或无权访问')
      return { success: true, data: serialize(subject) }
    }, {
      params: t.Object({ id: t.String() }),
      detail: { summary: '主体资产详情', tags: ['主体资产库'] },
    })

    // ── 更新 ──────────────────────────────────────────
    .patch('/:id', async ({ params: { id }, body, userId }) => {
      const subject = await getSubjectById(id)
      if (!subject || subject.accountId !== userId)
        throw new NotFoundError('资产不存在或无权访问')
      const updated = await updateSubject(id, body)
      return { success: true, data: serialize(updated) }
    }, {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        name: t.Optional(t.String({ maxLength: 200 })),
        identityPrompt: t.Optional(t.String()),
        negativePrompt: t.Optional(t.String()),
        scenePrompt: t.Optional(t.String()),
        referenceImageUrl: t.Optional(t.String()),
        turnaroundSheetUrl: t.Optional(t.String()),
        tags: t.Optional(t.Array(t.String())),
        isFavorite: t.Optional(t.Boolean()),
      }),
      detail: { summary: '更新主体资产', tags: ['主体资产库'] },
    })

    // ── 删除 ──────────────────────────────────────────
    .delete('/:id', async ({ params: { id }, userId }) => {
      const subject = await getSubjectById(id)
      if (!subject || subject.accountId !== userId)
        throw new NotFoundError('资产不存在或无权访问')
      await deleteSubject(id)
      return { success: true }
    }, {
      params: t.Object({ id: t.String() }),
      detail: { summary: '删除主体资产', tags: ['主体资产库'] },
    })

    // ── 切换收藏 ──────────────────────────────────────
    .post('/:id/favorite', async ({ params: { id }, userId }) => {
      const subject = await getSubjectById(id)
      if (!subject || subject.accountId !== userId)
        throw new NotFoundError('资产不存在或无权访问')
      const newValue = await toggleSubjectFavorite(id)
      return { success: true, isFavorite: newValue }
    }, {
      params: t.Object({ id: t.String() }),
      detail: { summary: '切换收藏状态', tags: ['主体资产库'] },
    })
}
