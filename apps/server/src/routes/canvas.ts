/**
 * Canvas 路由 — AI 视频制作流水线
 *
 * 这是系统中最大最复杂的路由文件，提供：
 *
 * 1. 项目 CRUD
 *    GET/POST/DELETE/PATCH /api/canvas/projects
 *
 * 2. Pipeline Run 查询
 *    GET /projects/:id/runs    — 列出某项目的所有运行记录
 *    GET /runs/:runId          — 查询单条运行记录
 *
 * 3. 流水线阶段执行（每个阶段走相同的并发守卫模式）：
 *    POST .../analyze          — LLM 分析故事文本
 *    POST .../characters       — 生成角色档案
 *    POST .../locations        — 生成场景档案
 *    POST .../character-refs   — AI 角色参考图
 *    POST .../location-refs    — AI 场景参考图
 *    POST .../storyboard       — LLM 分镜脚本
 *    POST .../continuity       — 规则校验连续性
 *    POST .../rebuild-prompts  — 重建视频提示词
 *    POST .../generate-videos  — 提交视频生成
 *
 * 4. 资源 PATCH/DELETE — 角色、场景、镜头的编辑和删除
 *
 * 5. 辅助操作
 *    POST .../layout           — 保存画布布局
 *    PATCH .../model-preferences — 更新模型偏好
 *    POST /shots/:id/retry     — 重试单个镜头
 *    POST .../retry-failed-shots — 批量重试失败镜头
 *
 * 关键模式：
 *   - 并发守卫：每个 phase 执行前通过 findActiveRunForPhase 检查是否有进行中的 run
 *   - fireAndForget：阶段执行立即返回 { accepted: true, runId }，结果通过 SSE 推送
 *   - 归属校验：所有操作先通过 getXxxForAccount 确认资源属于当前用户
 */
import type { CanvasPipelinePhase } from '@excuse/db'
import type { AcceptedResponse, CanvasAssetsPollResponse, CanvasCharacterResponse, CanvasLocationResponse, CanvasMutationOkResponse, CanvasPipelineRunListResponse, CanvasPipelineRunResponse, CanvasProjectListResponse, CanvasProjectResponse, CanvasShotReferenceAsset, CanvasShotResponse } from '@excuse/shared'
import type { ServerConfig } from '../config'
import {
  cancelActiveCanvasAssetsByProject,
  cancelTask,
  createPipelineRun,
  createTask,
  findActiveRunForPhase,
  getCanvasAssetById,
  getCanvasCharacterForAccount,
  getCanvasLocationForAccount,
  getCanvasProjectByIdForAccount,
  getCanvasShotForAccount,
  getPipelineRunById,
  linkPipelineRunToTask,
  listCanvasAssetsByTarget,
  listCanvasShotsByProject,
  listPipelineRunsByProject,
  markPipelineRunCancelled,
  serialize,
  setCanvasAssetActive,
  setCanvasAssetLocked,
  updateCanvasProject,
} from '@excuse/db'
import { createLogger } from '@excuse/shared'
import { cancelTaskWithAdapter, getTaskPriority } from '@excuse/task-engine'
import { canCancelPipelineRun } from '@excuse/workflow-engine'
import { Elysia, t } from 'elysia'
import { ReferenceAssetValidationError, validateShotReferenceAssetsForAccount } from '../modules/canvas/reference-assets'
import * as svc from '../modules/canvas/service'
import { createRequireAuthPlugin } from '../plugins/auth'
import { audit } from '../services/audit'
import { dispatchToUser } from '../services/sse-manager'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/app-errors'
import { notifyCanvasPhaseFailed } from './notifications'

const logger = createLogger('canvas-routes')

function acceptedResponse(runId?: string): AcceptedResponse {
  return runId ? { accepted: true, runId } : { accepted: true }
}

/**
 * fire-and-forget 包装器 — 管道阶段的后台执行与结果推送
 *
 * 流程：
 *   1. 等待 promise 完成 → SSE 推送 completed 事件
 *   2. promise 失败 → 更新项目状态为 failed + SSE 推送 failed 事件
 *
 * 不阻塞路由 handler 返回，实现"接受请求 → 后台执行 → SSE 通知"模式。
 */
function fireAndForgetWithRun(
  userId: string,
  projectId: string,
  phaseKey: string,
  runId: string,
  promise: Promise<unknown>,
) {
  promise
    .then(() => {
      dispatchToUser(userId, 'pipeline_node_update', {
        projectId,
        nodeType: 'phase',
        nodeId: phaseKey,
        status: 'completed',
        runId,
      })
    })
    .catch((err) => {
      logger.error({ err, projectId, phaseKey }, `${phaseKey} failed`)
      updateCanvasProject(projectId, { status: 'failed' }).catch(dbErr =>
        logger.error({ err: dbErr, projectId }, 'Failed to update project status to failed'),
      )
      dispatchToUser(userId, 'pipeline_node_update', {
        projectId,
        nodeType: 'phase',
        nodeId: phaseKey,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        runId,
      })
      // 推送通知：Canvas Pipeline 阶段失败（用户可能已离开页面）
      notifyCanvasPhaseFailed(userId, projectId, phaseKey, err instanceof Error ? err.message : String(err)).catch(() => {})
    })
}

/**
 * task-driven 模式 — 创建 pipeline_run + task，由 Worker 执行
 *
 * 当 autoProgress=true 时，前端只触发第一个阶段（analyze），
 * Worker 完成后通过 pipeline-stepper.ts 自动推进后续阶段。
 *
 * 此模式不再在 server 端调用 service 函数，而是创建 task 让 Worker claim。
 * Worker 的 canvas-handlers.ts 会通过动态 import 执行对应的 service 函数。
 */
async function createTaskDrivenPhase(
  userId: string,
  projectId: string,
  phase: CanvasPipelinePhase,
): Promise<AcceptedResponse> {
  const run = await createPipelineRun({ projectId, phase, createdBy: userId })
  const task = await createTask({
    accountId: userId,
    type: `canvas.${phase}`,
    domain: 'canvas',
    priority: getTaskPriority({ type: `canvas.${phase}`, domain: 'canvas' }),
    projectId,
    targetType: 'pipeline_run',
    targetId: run.id,
  })
  await linkPipelineRunToTask(run.id, task.id)

  audit('canvas_phase_run', { accountId: userId, targetId: projectId, detail: { phase, projectId, runId: run.id, autoProgress: true, taskId: task.id } })

  // SSE 通知：阶段已创建 task，等待 Worker claim
  dispatchToUser(userId, 'pipeline_node_update', {
    projectId,
    nodeType: 'phase',
    nodeId: phase,
    status: 'queued',
    runId: run.id,
  })

  return acceptedResponse(run.id)
}

/**
 * fire-and-forget 模式 — 创建 pipeline_run + audit + 后台执行
 *
 * autoProgress=false 时，前端逐步调用每个阶段。
 * 此 helper 封装 run 创建 + audit + fireAndForget，减少 9 个 phase handler 的重复代码。
 *
 * factory 接收 runId（run 创建后才可用），返回后台执行 promise ——
 * service 函数需要 runId 写入 pipeline_run 进度，故必须延迟到 run 创建后求值。
 */
async function createFireAndForgetPhase(
  userId: string,
  projectId: string,
  phase: CanvasPipelinePhase,
  factory: (runId: string) => Promise<unknown>,
): Promise<AcceptedResponse> {
  const run = await createPipelineRun({ projectId, phase, createdBy: userId })
  audit('canvas_phase_run', { accountId: userId, targetId: projectId, detail: { phase, projectId, runId: run.id, autoProgress: false } })
  fireAndForgetWithRun(userId, projectId, phase, run.id, factory(run.id))
  return acceptedResponse(run.id)
}

export function createCanvasRoutes(config: ServerConfig) {
  return new Elysia({ prefix: '/api/canvas' })
    .use(createRequireAuthPlugin(config))

    // ===== 项目 CRUD =====
    .get('/projects', async ({ userId }) => {
      const projects = await svc.listProjects(userId)
      return { success: true, items: projects, total: projects.length } satisfies CanvasProjectListResponse
    })

    .post('/projects', async ({ body, userId }) => {
      const { title, storyText } = body
      const project = await svc.createProject(userId, { title, storyText })
      audit('canvas_project_create', { accountId: userId, targetId: project.id, detail: { projectId: project.id, title } })
      return { success: true, data: project } satisfies CanvasProjectResponse
    }, {
      body: t.Object({
        title: t.Optional(t.String({ maxLength: 500 })),
        storyText: t.String({ minLength: 10 }),
      }),
    })

    .get('/projects/:projectId', async ({ params: { projectId }, userId }) => {
      const owned = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!owned)
        throw new NotFoundError('项目不存在或无权访问')
      const project = await svc.getProjectDetail(projectId)
      if (!project)
        throw new NotFoundError('项目不存在')
      return { success: true, data: project } satisfies CanvasProjectResponse
    })

    // 资产轮询 — SSE 断线或漏事件时的数据 fallback
    .get('/projects/:projectId/assets/poll', async ({ params: { projectId }, userId }) => {
      const owned = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!owned)
        throw new NotFoundError('项目不存在或无权访问')
      const poll = await svc.getCanvasAssetsPoll(projectId)
      if (!poll)
        throw new NotFoundError('项目不存在')
      return { success: true, data: poll } satisfies CanvasAssetsPollResponse
    })

    .delete('/projects/:projectId', async ({ params: { projectId }, userId }) => {
      const owned = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!owned)
        throw new NotFoundError('项目不存在或无权访问')
      await svc.softDeleteProject(projectId)
      audit('canvas_project_delete', { accountId: userId, targetId: projectId, detail: { projectId } })
      return { success: true } satisfies CanvasMutationOkResponse
    })

    // 更新项目标题/故事文本
    .patch('/projects/:projectId', async ({ params: { projectId }, body, userId }) => {
      const owned = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!owned)
        throw new NotFoundError('项目不存在或无权访问')
      const { title, storyText } = body
      if (title === undefined && storyText === undefined)
        throw new ValidationError('至少提供一个字段')
      const project = await svc.updateProjectProperties(projectId, { title, storyText })
      return { success: true, data: project } satisfies CanvasProjectResponse
    }, {
      body: t.Object({
        title: t.Optional(t.String({ maxLength: 500 })),
        storyText: t.Optional(t.String({ minLength: 10 })),
      }),
    })

    // ===== Pipeline Run 查询 =====
    .get('/projects/:projectId/runs', async ({ params: { projectId }, userId }) => {
      const owned = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!owned)
        throw new NotFoundError('项目不存在或无权访问')
      const runs = await listPipelineRunsByProject(projectId)
      const serialized = runs.map(serialize)
      return { success: true, items: serialized, total: serialized.length } satisfies CanvasPipelineRunListResponse
    })

    .get('/runs/:runId', async ({ params: { runId }, userId }) => {
      const run = await getPipelineRunById(runId)
      if (!run)
        throw new NotFoundError('运行记录不存在')
      const owned = await getCanvasProjectByIdForAccount(run.projectId, userId)
      if (!owned)
        throw new NotFoundError('项目不存在或无权访问')
      return { success: true, data: serialize(run) } satisfies CanvasPipelineRunResponse
    })

    // ===== 流水线步骤 =====
    // 每个 phase 先检查是否有 active run (并发守卫)，
    // 无则创建 run 记录 → 返回 { accepted: true, runId } → 后台执行
    // 有则返回 409 { accepted: false, error, existingRunId }
    .post('/projects/:projectId/analyze', async ({ params: { projectId }, userId }) => {
      const owned = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!owned)
        throw new NotFoundError('项目不存在或无权访问')
      const phase: CanvasPipelinePhase = 'analyze'
      const activeRun = await findActiveRunForPhase(projectId, phase)
      if (activeRun)
        throw new ConflictError(`该阶段已有进行中的任务`)

      // autoProgress=true → task-driven 模式（Worker 自动推进后续阶段）
      const autoProgress = owned.modelPreferencesJson?.autoProgress ?? false
      if (autoProgress) {
        return createTaskDrivenPhase(userId, projectId, phase)
      }

      return createFireAndForgetPhase(userId, projectId, phase, runId => svc.analyzeProject(projectId, config, runId))
    })

    .post('/projects/:projectId/characters', async ({ params: { projectId }, userId }) => {
      const owned = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!owned)
        throw new NotFoundError('项目不存在或无权访问')
      const phase: CanvasPipelinePhase = 'characters'
      const activeRun = await findActiveRunForPhase(projectId, phase)
      if (activeRun)
        throw new ConflictError(`该阶段已有进行中的任务`)

      const autoProgress = owned.modelPreferencesJson?.autoProgress ?? false
      if (autoProgress) {
        return createTaskDrivenPhase(userId, projectId, phase)
      }

      return createFireAndForgetPhase(userId, projectId, phase, runId => svc.generateCharacters(projectId, config, runId))
    })

    .post('/projects/:projectId/locations', async ({ params: { projectId }, userId }) => {
      const owned = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!owned)
        throw new NotFoundError('项目不存在或无权访问')
      const phase: CanvasPipelinePhase = 'locations'
      const activeRun = await findActiveRunForPhase(projectId, phase)
      if (activeRun)
        throw new ConflictError(`该阶段已有进行中的任务`)

      const autoProgress = owned.modelPreferencesJson?.autoProgress ?? false
      if (autoProgress) {
        return createTaskDrivenPhase(userId, projectId, phase)
      }

      return createFireAndForgetPhase(userId, projectId, phase, runId => svc.generateLocations(projectId, config, runId))
    })

    .post('/projects/:projectId/character-refs', async ({ params: { projectId }, userId }) => {
      const owned = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!owned)
        throw new NotFoundError('项目不存在或无权访问')
      const phase: CanvasPipelinePhase = 'characterRefs'
      const activeRun = await findActiveRunForPhase(projectId, phase)
      if (activeRun)
        throw new ConflictError(`该阶段已有进行中的任务`)

      const autoProgress = owned.modelPreferencesJson?.autoProgress ?? false
      if (autoProgress) {
        return createTaskDrivenPhase(userId, projectId, phase)
      }

      return createFireAndForgetPhase(userId, projectId, phase, runId => svc.generateCharacterRefs(projectId, config, runId))
    })

    .post('/projects/:projectId/location-refs', async ({ params: { projectId }, userId }) => {
      const owned = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!owned)
        throw new NotFoundError('项目不存在或无权访问')
      const phase: CanvasPipelinePhase = 'locationRefs'
      const activeRun = await findActiveRunForPhase(projectId, phase)
      if (activeRun)
        throw new ConflictError(`该阶段已有进行中的任务`)

      const autoProgress = owned.modelPreferencesJson?.autoProgress ?? false
      if (autoProgress) {
        return createTaskDrivenPhase(userId, projectId, phase)
      }

      return createFireAndForgetPhase(userId, projectId, phase, runId => svc.generateLocationRefs(projectId, config, runId))
    })

    .post('/projects/:projectId/storyboard', async ({ params: { projectId }, userId }) => {
      const owned = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!owned)
        throw new NotFoundError('项目不存在或无权访问')
      const phase: CanvasPipelinePhase = 'storyboard'
      const activeRun = await findActiveRunForPhase(projectId, phase)
      if (activeRun)
        throw new ConflictError(`该阶段已有进行中的任务`)

      // autoProgress=true -> task-driven mode (Worker stepper handles subsequent phases)
      const autoProgress = owned.modelPreferencesJson?.autoProgress ?? false
      if (autoProgress) {
        return createTaskDrivenPhase(userId, projectId, phase)
      }

      return createFireAndForgetPhase(userId, projectId, phase, runId => svc.generateStoryboard(projectId, config, runId))
    })

    .post('/projects/:projectId/continuity', async ({ params: { projectId }, userId }) => {
      const owned = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!owned)
        throw new NotFoundError('项目不存在或无权访问')
      const phase: CanvasPipelinePhase = 'continuity'
      const activeRun = await findActiveRunForPhase(projectId, phase)
      if (activeRun)
        throw new ConflictError(`该阶段已有进行中的任务`)

      const autoProgress = owned.modelPreferencesJson?.autoProgress ?? false
      if (autoProgress) {
        return createTaskDrivenPhase(userId, projectId, phase)
      }

      return createFireAndForgetPhase(userId, projectId, phase, runId => svc.checkContinuity(projectId, runId))
    })

    .post('/projects/:projectId/rebuild-prompts', async ({ params: { projectId }, userId }) => {
      const owned = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!owned)
        throw new NotFoundError('项目不存在或无权访问')
      const phase: CanvasPipelinePhase = 'rebuild'
      const activeRun = await findActiveRunForPhase(projectId, phase)
      if (activeRun)
        throw new ConflictError(`该阶段已有进行中的任务`)

      const autoProgress = owned.modelPreferencesJson?.autoProgress ?? false
      if (autoProgress) {
        return createTaskDrivenPhase(userId, projectId, phase)
      }

      return createFireAndForgetPhase(userId, projectId, phase, runId => svc.rebuildShotPrompts(projectId, runId))
    })

    .post('/projects/:projectId/generate-videos', async ({ params: { projectId }, userId }) => {
      const owned = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!owned)
        throw new NotFoundError('项目不存在或无权访问')
      const phase: CanvasPipelinePhase = 'videos'
      const activeRun = await findActiveRunForPhase(projectId, phase)
      if (activeRun)
        throw new ConflictError(`该阶段已有进行中的任务`)

      const autoProgress = owned.modelPreferencesJson?.autoProgress ?? false
      if (autoProgress) {
        return createTaskDrivenPhase(userId, projectId, phase)
      }

      return createFireAndForgetPhase(userId, projectId, phase, runId => svc.generateVideos(projectId, config, runId))
    })

    // ── 终止当前活跃阶段 ──────────────────────────────────
    // 取消 pipeline run + 关联 task + 项目所有活跃 canvas_asset
    .post('/projects/:projectId/cancel-active', async ({ params: { projectId }, userId }) => {
      const owned = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!owned)
        throw new NotFoundError('项目不存在或无权访问')

      // 查找项目所有可取消的 pipeline runs（pending 或 running 状态）
      const runs = await listPipelineRunsByProject(projectId)
      const activeRuns = runs.filter(canCancelPipelineRun)
      if (activeRuns.length === 0)
        return { cancelled: 0, message: '当前没有活跃的阶段任务' }

      // 取消所有活跃 pipeline runs + 关联 tasks
      let cancelledCount = 0
      const cancelledPhases: string[] = []
      for (const run of activeRuns) {
        const cancelled = await markPipelineRunCancelled(run.id)
        if (cancelled) {
          cancelledCount++
          cancelledPhases.push(cancelled.phase)
          // 取消关联的 task（如果有）
          if (cancelled.taskId) {
            await cancelTaskWithAdapter({ taskId: cancelled.taskId, adapter: { cancelTask } }).catch(() => { /* task 可能已终态 */ })
          }
          // SSE 通知：阶段已取消
          dispatchToUser(userId, 'pipeline_node_update', {
            projectId,
            nodeType: 'phase',
            nodeId: cancelled.phase,
            status: 'cancelled',
            runId: run.id,
          })
        }
      }

      // 批量取消项目所有活跃 canvas_assets（queued/running 的图片生成等）
      await cancelActiveCanvasAssetsByProject(projectId).catch(() => { /* 资产取消失败不阻塞 */ })

      audit('canvas_cancel', { accountId: userId, targetId: projectId, detail: { projectId, cancelledRuns: cancelledCount, phases: cancelledPhases } })

      return { cancelled: cancelledCount, message: `已取消 ${cancelledCount} 个活跃阶段` }
    })

    .post('/projects/:projectId/layout', async ({ params: { projectId }, body, userId }) => {
      const owned = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!owned)
        throw new NotFoundError('项目不存在或无权访问')
      await svc.saveCanvasLayout(projectId, body)
      return { success: true } satisfies CanvasMutationOkResponse
    }, {
      body: t.Object({
        nodes: t.Array(t.Object({
          id: t.String(),
          type: t.Optional(t.String()),
          position: t.Object({
            x: t.Number(),
            y: t.Number(),
          }),
          width: t.Optional(t.Number()),
          height: t.Optional(t.Number()),
          data: t.Optional(t.Record(t.String(), t.Unknown())),
        })),
        edges: t.Array(t.Object({
          id: t.String(),
          source: t.String(),
          target: t.String(),
          type: t.Optional(t.String()),
          data: t.Optional(t.Record(t.String(), t.Unknown())),
        })),
        viewport: t.Optional(t.Object({
          x: t.Number(),
          y: t.Number(),
          zoom: t.Number(),
        })),
      }),
    })

    .patch('/projects/:projectId/model-preferences', async ({ params: { projectId }, body, userId }) => {
      const owned = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!owned)
        throw new NotFoundError('项目不存在或无权访问')
      const project = await svc.updateModelPreferences(projectId, body)
      return { success: true, data: project } satisfies CanvasProjectResponse
    }, {
      body: t.Object({
        textModel: t.Optional(t.String()),
        imageModel: t.Optional(t.String()),
        videoModel: t.Optional(t.String()),
        autoProgress: t.Optional(t.Boolean()),
      }),
    })

    // ===== 资源 PATCH =====
    .patch('/characters/:characterId', async ({ params: { characterId }, body, userId }) => {
      const character = await getCanvasCharacterForAccount(characterId, userId)
      if (!character)
        throw new NotFoundError('角色不存在或无权访问')
      const updated = await svc.updateCharacterData(characterId, body)
      return { success: true, data: updated } satisfies CanvasCharacterResponse
    }, {
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

    .patch('/locations/:locationId', async ({ params: { locationId }, body, userId }) => {
      const location = await getCanvasLocationForAccount(locationId, userId)
      if (!location)
        throw new NotFoundError('场景不存在或无权访问')
      const updated = await svc.updateLocationData(locationId, body)
      return { success: true, data: updated } satisfies CanvasLocationResponse
    }, {
      body: t.Object({
        name: t.Optional(t.String({ maxLength: 200 })),
        type: t.Optional(t.String({ maxLength: 50 })),
        scenePrompt: t.Optional(t.String()),
        negativePrompt: t.Optional(t.String()),
        referenceImageUrl: t.Optional(t.String()),
        locked: t.Optional(t.Boolean()),
      }),
    })

    .patch('/shots/:shotId', async ({ params: { shotId }, body, userId }) => {
      const shot = await getCanvasShotForAccount(shotId, userId)
      if (!shot)
        throw new NotFoundError('镜头不存在或无权访问')

      // 参考资产归属与 URL 可信度校验（v0.3）— 不信任前端 source，按 assetId 回查
      // undefined → 不修改；[] → 清空；数组 → 归一化去重后保存
      let validatedAssets: CanvasShotReferenceAsset[] | undefined
      try {
        validatedAssets = await validateShotReferenceAssetsForAccount(userId, body.referenceAssetsJson)
      }
      catch (err) {
        if (err instanceof ReferenceAssetValidationError)
          throw err.status === 403 ? new ForbiddenError(err.message) : new ValidationError(err.message)
        throw err
      }

      const updated = await svc.updateShotData(shotId, { ...body, referenceAssetsJson: validatedAssets })
      return { success: true, data: updated } satisfies CanvasShotResponse
    }, {
      body: t.Object({
        duration: t.Optional(t.Number()),
        locationId: t.Optional(t.String()),
        characterIdsJson: t.Optional(t.Array(t.String())),
        narrative: t.Optional(t.String()),
        cameraJson: t.Optional(t.Object({
          shotSize: t.String(),
          angle: t.String(),
          movement: t.String(),
          lens: t.String(),
        })),
        environmentJson: t.Optional(t.Object({
          backgroundMotion: t.Optional(t.String()),
          lighting: t.Optional(t.String()),
          mood: t.Optional(t.String()),
          style: t.Optional(t.String()),
        })),
        videoPrompt: t.Optional(t.String()),
        referenceAssetsJson: t.Optional(t.Array(t.Object({
          assetId: t.String(),
          url: t.String(),
          role: t.Union([
            t.Literal('character'),
            t.Literal('location'),
            t.Literal('style'),
            t.Literal('firstFrame'),
            t.Literal('other'),
          ]),
          label: t.Optional(t.String({ maxLength: 100 })),
          source: t.Optional(t.Union([
            t.Literal('asset_library'),
            t.Literal('uploaded_file'),
            t.Literal('manual'),
          ]),
          ),
        }), { maxItems: 8 })),
      }),
    })

    // ===== 批量应用参考资产 =====
    .post('/projects/:projectId/shots/reference-assets/apply', async ({ params: { projectId }, body, userId }) => {
      const owned = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!owned)
        throw new NotFoundError('项目不存在或无权访问')

      // 校验所有 targetShotIds 属于该项目
      const projectShots = await listCanvasShotsByProject(projectId)
      const validShotIds = new Set(projectShots.map(s => s.id))
      const invalidIds = body.targetShotIds.filter(id => !validShotIds.has(id))
      if (invalidIds.length > 0)
        throw new ValidationError(`镜头 ${invalidIds.join(', ')} 不属于该项目`)

      // 校验 referenceAssetsJson 归属与 URL 可信度
      let validatedAssets: CanvasShotReferenceAsset[]
      try {
        validatedAssets = await validateShotReferenceAssetsForAccount(userId, body.referenceAssetsJson) ?? []
      }
      catch (err) {
        if (err instanceof ReferenceAssetValidationError)
          throw err.status === 403 ? new ForbiddenError(err.message) : new ValidationError(err.message)
        throw err
      }

      const applied = await svc.applyShotReferenceAssets(
        projectId,
        body.targetShotIds,
        validatedAssets,
        body.mode,
      )

      audit('canvas_apply_reference_assets', { accountId: userId, targetId: projectId, detail: { projectId, mode: body.mode, shotCount: body.targetShotIds.length, assetCount: validatedAssets.length } })

      return { success: true, applied }
    }, {
      body: t.Object({
        sourceShotId: t.Optional(t.String()),
        targetShotIds: t.Array(t.String(), { minItems: 1 }),
        referenceAssetsJson: t.Array(t.Object({
          assetId: t.String(),
          url: t.String(),
          role: t.Union([
            t.Literal('character'),
            t.Literal('location'),
            t.Literal('style'),
            t.Literal('firstFrame'),
            t.Literal('other'),
          ]),
          label: t.Optional(t.String({ maxLength: 100 })),
          source: t.Optional(t.Union([
            t.Literal('asset_library'),
            t.Literal('uploaded_file'),
            t.Literal('manual'),
          ]),
          ),
        }), { maxItems: 8 }),
        mode: t.Union([t.Literal('append'), t.Literal('replace')]),
      }),
    })

    // ===== 资源 DELETE =====
    .delete('/characters/:characterId', async ({ params: { characterId }, userId }) => {
      const character = await getCanvasCharacterForAccount(characterId, userId)
      if (!character)
        throw new NotFoundError('角色不存在或无权访问')
      await svc.deleteCharacter(characterId)
      return { success: true } satisfies CanvasMutationOkResponse
    })

    .delete('/locations/:locationId', async ({ params: { locationId }, userId }) => {
      const location = await getCanvasLocationForAccount(locationId, userId)
      if (!location)
        throw new NotFoundError('场景不存在或无权访问')
      await svc.deleteLocation(locationId)
      return { success: true } satisfies CanvasMutationOkResponse
    })

    .delete('/shots/:shotId', async ({ params: { shotId }, userId }) => {
      const shot = await getCanvasShotForAccount(shotId, userId)
      if (!shot)
        throw new NotFoundError('镜头不存在或无权访问')
      await svc.deleteShot(shotId)
      return { success: true } satisfies CanvasMutationOkResponse
    })

    // 重试单个失败的镜头视频 — retry 不创建 pipeline run 记录
    .post('/shots/:shotId/retry', async ({ params: { shotId }, userId }) => {
      const shot = await getCanvasShotForAccount(shotId, userId)
      if (!shot)
        throw new NotFoundError('镜头不存在或无权访问')
      svc.retryShotVideo(shotId, config).catch((err) => {
        logger.error({ err, shotId }, 'retry failed')
        updateCanvasProject(shot.projectId, { status: 'failed' }).catch(dbErr =>
          logger.error({ err: dbErr, projectId: shot.projectId }, 'Failed to update project status to failed'),
        )
        dispatchToUser(userId, 'pipeline_node_update', {
          projectId: shot.projectId,
          nodeType: 'shot',
          nodeId: shotId,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        })
      })
      return acceptedResponse()
    })

    // 批量重试项目中所有失败的镜头
    .post('/projects/:projectId/retry-failed-shots', async ({ params: { projectId }, userId }) => {
      const project = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!project)
        throw new NotFoundError('项目不存在或无权访问')
      svc.retryFailedShots(projectId, userId, config).catch((err) => {
        logger.error({ err, projectId }, 'batch retry failed shots error')
        dispatchToUser(userId, 'pipeline_node_update', {
          projectId,
          nodeType: 'phase',
          nodeId: 'retry-failed-shots',
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        })
      })
      return acceptedResponse()
    })

  // ── 单个实体重新生成（创建同级节点）──────────────────

    // 重新生成角色 profile — 创建新角色行（不删除旧角色）
    .post('/characters/:characterId/regenerate', async ({ params: { characterId }, userId }) => {
      const character = await getCanvasCharacterForAccount(characterId, userId)
      if (!character)
        throw new NotFoundError('角色不存在或无权访问')
      audit('canvas_asset_regenerate', { accountId: userId, targetId: characterId, detail: { entityType: 'character', entityId: characterId, projectId: character.projectId } })
      svc.regenerateCharacter(characterId, config).catch((err) => {
        logger.error({ err, characterId }, 'regenerate character failed')
      })
      return acceptedResponse()
    })

    // 重新生成场景 profile — 创建新场景行（不删除旧场景）
    .post('/locations/:locationId/regenerate', async ({ params: { locationId }, userId }) => {
      const location = await getCanvasLocationForAccount(locationId, userId)
      if (!location)
        throw new NotFoundError('场景不存在或无权访问')
      audit('canvas_asset_regenerate', { accountId: userId, targetId: locationId, detail: { entityType: 'location', entityId: locationId, projectId: location.projectId } })
      svc.regenerateLocation(locationId, config).catch((err) => {
        logger.error({ err, locationId }, 'regenerate location failed')
      })
      return acceptedResponse()
    })

    // 重新生成镜头视频 — 创建新镜头行（同级变体）并提交视频任务
    .post('/shots/:shotId/regenerate', async ({ params: { shotId }, userId }) => {
      const shot = await getCanvasShotForAccount(shotId, userId)
      if (!shot)
        throw new NotFoundError('镜头不存在或无权访问')
      audit('canvas_asset_regenerate', { accountId: userId, targetId: shotId, detail: { entityType: 'shot', entityId: shotId, projectId: shot.projectId } })
      svc.regenerateShotVideo(shotId, config).catch((err) => {
        logger.error({ err, shotId }, 'regenerate shot video failed')
      })
      return acceptedResponse()
    })

  // ===== 资产历史与选择 =====

    // 查询目标实体（角色/场景/镜头/项目）的历史资产
    .get('/assets/:targetEntityType/:targetEntityId', async ({ params: { targetEntityType, targetEntityId }, userId }) => {
      // 权限校验：通过实体归属检查
      if (targetEntityType === 'character') {
        const character = await getCanvasCharacterForAccount(targetEntityId, userId)
        if (!character)
          throw new NotFoundError('角色不存在或无权访问')
      }
      else if (targetEntityType === 'location') {
        const location = await getCanvasLocationForAccount(targetEntityId, userId)
        if (!location)
          throw new NotFoundError('场景不存在或无权访问')
      }
      else if (targetEntityType === 'shot') {
        const shot = await getCanvasShotForAccount(targetEntityId, userId)
        if (!shot)
          throw new NotFoundError('镜头不存在或无权访问')
      }
      else {
        throw new ValidationError('不支持的实体类型')
      }

      const assets = await listCanvasAssetsByTarget(targetEntityType, targetEntityId)
      return { success: true, data: assets }
    })

    // 切换资产为当前活跃版本（同时取消其他同类别资产的 isActive）
    .patch('/asset/:assetId/activate', async ({ params: { assetId }, userId }) => {
      const asset = await getCanvasAssetById(assetId)
      if (!asset)
        throw new NotFoundError('资产不存在')

      // 权限校验：通过实体归属间接验证
      if (asset.targetEntityType === 'character') {
        const character = await getCanvasCharacterForAccount(asset.targetEntityId, userId)
        if (!character)
          throw new NotFoundError('无权访问此资产')
      }
      else if (asset.targetEntityType === 'location') {
        const location = await getCanvasLocationForAccount(asset.targetEntityId, userId)
        if (!location)
          throw new NotFoundError('无权访问此资产')
      }
      else if (asset.targetEntityType === 'shot') {
        const shot = await getCanvasShotForAccount(asset.targetEntityId, userId)
        if (!shot)
          throw new NotFoundError('无权访问此资产')
      }

      if (asset.status !== 'succeeded')
        throw new ConflictError('只能将成功完成的资产设为活跃版本')

      const updated = await setCanvasAssetActive(assetId)
      if (!updated)
        throw new NotFoundError('资产激活失败')

      return { success: true, data: updated }
    })

    // 切换资产锁定状态（锁定后不会被后续生成自动覆盖）
    .patch('/asset/:assetId/lock', async ({ params: { assetId }, body, userId }) => {
      const asset = await getCanvasAssetById(assetId)
      if (!asset)
        throw new NotFoundError('资产不存在')

      // 权限校验
      if (asset.targetEntityType === 'character') {
        const character = await getCanvasCharacterForAccount(asset.targetEntityId, userId)
        if (!character)
          throw new NotFoundError('无权访问此资产')
      }
      else if (asset.targetEntityType === 'location') {
        const location = await getCanvasLocationForAccount(asset.targetEntityId, userId)
        if (!location)
          throw new NotFoundError('无权访问此资产')
      }
      else if (asset.targetEntityType === 'shot') {
        const shot = await getCanvasShotForAccount(asset.targetEntityId, userId)
        if (!shot)
          throw new NotFoundError('无权访问此资产')
      }

      const updated = await setCanvasAssetLocked(assetId, body.locked)
      if (!updated)
        throw new NotFoundError('资产更新失败')

      return { success: true, data: updated }
    }, {
      body: t.Object({
        locked: t.Boolean(),
      }),
    })
}
