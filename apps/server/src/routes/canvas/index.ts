/**
 * Canvas 路由 barrel — AI 视频制作流水线
 *
 * 拆分为子模块（见 docs/TODO.md §一、2）：
 *   - helpers.ts            共享辅助函数
 *   - handlers-project.ts   项目 CRUD + Pipeline 查询 + Layout + ModelPreferences
 *   - handlers-phases.ts    9 个流水线阶段 + cancel-active
 *   - handlers-resources.ts 角色/场景/镜头 PATCH/DELETE + retry + regenerate + 资产
 *
 * 本文件只做 Elysia 链式注册，handler 逻辑在子文件中。
 */
import type { ServerConfig } from '../../config'
import type { ServerContext } from '../../context'
import {
  createCanvasCharacter,
  createCanvasLocation,
  getCanvasProjectByIdForAccount,
  getSubjectById,
  incrementSubjectUsage,
  linkProjectSubject,
} from '@excuse/db'
import { Elysia, t } from 'elysia'
import { createRequireAuthPlugin } from '../../plugins/auth'
import { NotFoundError } from '../../utils/app-errors'
import {
  handleAnalyzePhase,
  handleCancelActive,
  handleCharacterRefsPhase,
  handleCharactersPhase,
  handleContinuityPhase,
  handleLocationRefsPhase,
  handleLocationsPhase,
  handleRebuildPhase,
  handleStoryboardPhase,
  handleVideosPhase,
} from './handlers-phases'
import {
  handleCreateProject,
  handleDeleteProject,
  handleGetAssetsPoll,
  handleGetProject,
  handleGetProjectSummary,
  handleGetRun,
  handleListProjects,
  handleListRuns,
  handlePatchProject,
  handleSaveLayout,
  handleUpdateModelPreferences,
} from './handlers-project'
import {
  handleActivateAsset,
  handleApplyReferenceAssets,
  handleDeleteCharacter,
  handleDeleteLocation,
  handleDeleteShot,
  handleGetCharacterDetail,
  handleGetLocationDetail,
  handleGetShotDetail,
  handleListAssets,
  handleLockAsset,
  handlePatchCharacter,
  handlePatchLocation,
  handlePatchShot,
  handleRegenerateCharacter,
  handleRegenerateLocation,
  handleRegenerateShotVideo,
  handleRetryFailedShots,
  handleRetryShot,
} from './handlers-resources'

export function createCanvasRoutes(config: ServerConfig, ctx: ServerContext) {
  return new Elysia({ prefix: '/api/canvas' })
    .use(createRequireAuthPlugin(config))

    // ── 项目 CRUD ──────────────────────────────────────
    .get('/projects', ({ userId }) => handleListProjects(userId))
    .post('/projects', ({ body, userId }) => handleCreateProject(userId, body), {
      body: t.Object({ title: t.Optional(t.String({ maxLength: 500 })), storyText: t.String({ minLength: 10 }) }),
    })
    .get('/projects/:projectId', ({ params: { projectId }, userId }) => handleGetProject(projectId, userId))
    .get('/projects/:projectId/summary', ({ params: { projectId }, userId }) => handleGetProjectSummary(projectId, userId))
    .get('/projects/:projectId/assets/poll', ({ params: { projectId }, userId }) => handleGetAssetsPoll(projectId, userId))
    .delete('/projects/:projectId', ({ params: { projectId }, userId }) => handleDeleteProject(projectId, userId))
    .patch('/projects/:projectId', ({ params: { projectId }, body, userId }) => handlePatchProject(projectId, userId, body), {
      body: t.Object({ title: t.Optional(t.String({ maxLength: 500 })), storyText: t.Optional(t.String({ minLength: 10 })) }),
    })

    // ── Pipeline Run 查询 ─────────────────────────────
    .get('/projects/:projectId/runs', ({ params: { projectId }, userId }) => handleListRuns(projectId, userId))
    .get('/runs/:runId', ({ params: { runId }, userId }) => handleGetRun(runId, userId))

    // ── Layout + ModelPreferences ──────────────────────
    .post('/projects/:projectId/layout', ({ params: { projectId }, body, userId }) => handleSaveLayout(projectId, userId, body), {
      body: t.Object({
        nodes: t.Array(t.Object({ id: t.String(), type: t.Optional(t.String()), position: t.Object({ x: t.Number(), y: t.Number() }), width: t.Optional(t.Number()), height: t.Optional(t.Number()), data: t.Optional(t.Record(t.String(), t.Unknown())) })),
        edges: t.Array(t.Object({ id: t.String(), source: t.String(), target: t.String(), type: t.Optional(t.String()), data: t.Optional(t.Record(t.String(), t.Unknown())) })),
        viewport: t.Optional(t.Object({ x: t.Number(), y: t.Number(), zoom: t.Number() })),
      }),
    })
    .patch('/projects/:projectId/model-preferences', ({ params: { projectId }, body, userId }) => handleUpdateModelPreferences(projectId, userId, body), {
      body: t.Object({ textModel: t.Optional(t.String()), imageModel: t.Optional(t.String()), videoModel: t.Optional(t.String()), autoProgress: t.Optional(t.Boolean()) }),
    })

    // ── 流水线阶段 ────────────────────────────────────
    .post('/projects/:projectId/analyze', ({ params: { projectId }, userId }) => handleAnalyzePhase(projectId, userId, ctx))
    .post('/projects/:projectId/characters', ({ params: { projectId }, userId }) => handleCharactersPhase(projectId, userId, ctx))
    .post('/projects/:projectId/locations', ({ params: { projectId }, userId }) => handleLocationsPhase(projectId, userId, ctx))
    .post('/projects/:projectId/character-refs', ({ params: { projectId }, userId }) => handleCharacterRefsPhase(projectId, userId, ctx))
    .post('/projects/:projectId/location-refs', ({ params: { projectId }, userId }) => handleLocationRefsPhase(projectId, userId, ctx))
    .post('/projects/:projectId/storyboard', ({ params: { projectId }, userId }) => handleStoryboardPhase(projectId, userId, ctx))
    .post('/projects/:projectId/continuity', ({ params: { projectId }, userId }) => handleContinuityPhase(projectId, userId, ctx))
    .post('/projects/:projectId/rebuild-prompts', ({ params: { projectId }, userId }) => handleRebuildPhase(projectId, userId, ctx))
    .post('/projects/:projectId/generate-videos', ({ params: { projectId }, userId }) => handleVideosPhase(projectId, userId, ctx))
    .post('/projects/:projectId/cancel-active', ({ params: { projectId }, userId }) => handleCancelActive(projectId, userId))

    // ── 资源 PATCH/DELETE ──────────────────────────────
    .patch('/characters/:characterId', ({ params: { characterId }, body, userId }) => handlePatchCharacter(characterId, userId, body), {
      body: t.Object({
        name: t.Optional(t.String({ maxLength: 200 })),
        role: t.Optional(t.String({ maxLength: 50 })),
        description: t.Optional(t.String()),
        identityPrompt: t.Optional(t.String()),
        negativePrompt: t.Optional(t.String()),
        referenceImageUrl: t.Optional(t.String()),
        locked: t.Optional(t.Boolean()),
      }),
    })
    .get('/characters/:characterId/detail', ({ params: { characterId }, userId }) => handleGetCharacterDetail(characterId, userId))
    .patch('/locations/:locationId', ({ params: { locationId }, body, userId }) => handlePatchLocation(locationId, userId, body), {
      body: t.Object({
        name: t.Optional(t.String({ maxLength: 200 })),
        type: t.Optional(t.String({ maxLength: 50 })),
        scenePrompt: t.Optional(t.String()),
        negativePrompt: t.Optional(t.String()),
        referenceImageUrl: t.Optional(t.String()),
        locked: t.Optional(t.Boolean()),
      }),
    })
    .get('/locations/:locationId/detail', ({ params: { locationId }, userId }) => handleGetLocationDetail(locationId, userId))
    .patch('/shots/:shotId', ({ params: { shotId }, body, userId }) => handlePatchShot(shotId, userId, body), {
      body: t.Object({
        duration: t.Optional(t.Number()),
        locationId: t.Optional(t.String()),
        characterIdsJson: t.Optional(t.Array(t.String())),
        narrative: t.Optional(t.String()),
        cameraJson: t.Optional(t.Object({ shotSize: t.String(), angle: t.String(), movement: t.String(), lens: t.String() })),
        environmentJson: t.Optional(t.Object({ backgroundMotion: t.Optional(t.String()), lighting: t.Optional(t.String()), mood: t.Optional(t.String()), style: t.Optional(t.String()) })),
        videoPrompt: t.Optional(t.String()),
        referenceAssetsJson: t.Optional(t.Array(t.Object({
          assetId: t.String(),
          url: t.String(),
          role: t.Union([t.Literal('character'), t.Literal('location'), t.Literal('style'), t.Literal('firstFrame'), t.Literal('other')]),
          label: t.Optional(t.String({ maxLength: 100 })),
          source: t.Optional(t.Union([t.Literal('asset_library'), t.Literal('uploaded_file'), t.Literal('manual')])),
        }), { maxItems: 8 })),
      }),
    })
    .get('/shots/:shotId/detail', ({ params: { shotId }, userId }) => handleGetShotDetail(shotId, userId))
    .post('/projects/:projectId/shots/reference-assets/apply', ({ params: { projectId }, body, userId }) => handleApplyReferenceAssets(projectId, userId, body), {
      body: t.Object({
        sourceShotId: t.Optional(t.String()),
        targetShotIds: t.Array(t.String(), { minItems: 1 }),
        referenceAssetsJson: t.Array(t.Object({
          assetId: t.String(),
          url: t.String(),
          role: t.Union([t.Literal('character'), t.Literal('location'), t.Literal('style'), t.Literal('firstFrame'), t.Literal('other')]),
          label: t.Optional(t.String({ maxLength: 100 })),
          source: t.Optional(t.Union([t.Literal('asset_library'), t.Literal('uploaded_file'), t.Literal('manual')])),
        }), { maxItems: 8 }),
        mode: t.Union([t.Literal('append'), t.Literal('replace')]),
      }),
    })
    .delete('/characters/:characterId', ({ params: { characterId }, userId }) => handleDeleteCharacter(characterId, userId))
    .delete('/locations/:locationId', ({ params: { locationId }, userId }) => handleDeleteLocation(locationId, userId))
    .delete('/shots/:shotId', ({ params: { shotId }, userId }) => handleDeleteShot(shotId, userId))

    // ── Retry + Regenerate ────────────────────────────
    .post('/shots/:shotId/retry', ({ params: { shotId }, userId }) => handleRetryShot(shotId, userId, ctx))
    .post('/projects/:projectId/retry-failed-shots', ({ params: { projectId }, userId }) => handleRetryFailedShots(projectId, userId, ctx))
    .post('/characters/:characterId/regenerate', ({ params: { characterId }, userId }) => handleRegenerateCharacter(characterId, userId, ctx))
    .post('/locations/:locationId/regenerate', ({ params: { locationId }, userId }) => handleRegenerateLocation(locationId, userId, ctx))
    .post('/shots/:shotId/regenerate', ({ params: { shotId }, userId }) => handleRegenerateShotVideo(shotId, userId, ctx))

    // ── 资产 ───────────────────────────────────────────
    .get('/assets/:targetEntityType/:targetEntityId', ({ params: { targetEntityType, targetEntityId }, userId }) => handleListAssets(targetEntityType, targetEntityId, userId))
    .patch('/asset/:assetId/activate', ({ params: { assetId }, userId }) => handleActivateAsset(assetId, userId))
    .patch('/asset/:assetId/lock', ({ params: { assetId }, body, userId }) => handleLockAsset(assetId, userId, body.locked), {
      body: t.Object({ locked: t.Boolean() }),
    })

    // ── 从资产库导入到项目 ────────────────────────────
    .post('/projects/:projectId/subjects/import', async ({ params: { projectId }, body, userId }) => {
      const owned = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!owned)
        throw new NotFoundError('项目不存在或无权访问')
      const subject = await getSubjectById(body.subjectId)
      if (!subject || subject.accountId !== userId)
        throw new NotFoundError('资产不存在或无权访问')

      if (subject.subjectType === 'character') {
        await createCanvasCharacter({
          projectId,
          name: subject.name,
          identityPrompt: subject.identityPrompt ?? undefined,
          negativePrompt: subject.negativePrompt ?? undefined,
          profileJson: subject.profileJson as any ?? undefined,
          referenceImageUrl: subject.referenceImageUrl ?? undefined,
          turnaroundSheetUrl: subject.turnaroundSheetUrl ?? undefined,
        })
      }
      else {
        await createCanvasLocation({
          projectId,
          name: subject.name,
          scenePrompt: subject.scenePrompt ?? undefined,
          negativePrompt: subject.negativePrompt ?? undefined,
          profileJson: subject.profileJson as any ?? undefined,
          referenceImageUrl: subject.referenceImageUrl ?? undefined,
        })
      }

      await linkProjectSubject(projectId, body.subjectId)
      await incrementSubjectUsage(body.subjectId)
      return { success: true }
    }, {
      body: t.Object({ subjectId: t.String() }),
    })
}
