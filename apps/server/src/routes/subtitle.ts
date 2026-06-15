/**
 * 字幕生成路由 — 独立页面，独立 API 分组
 *
 * 端点：
 *   POST /api/subtitle/projects          — 创建字幕项目（上传视频 → 提取音频 → ASR）
 *   GET  /api/subtitle/projects          — 列表
 *   GET  /api/subtitle/projects/:id      — 详情
 *   DELETE /api/subtitle/projects/:id    — 删除
 *   PATCH /api/subtitle/projects/:id/sentences — 更新字幕句子
 *   PATCH /api/subtitle/projects/:id/style     — 更新样式配置
 *   POST /api/subtitle/projects/:id/export     — 提交导出任务
 *   POST /api/subtitle/projects/:id/retry      — 重试失败项目
 */

import type { SubtitleProjectRow, SubtitleStyleConfig } from '@excuse/db'
import type { SubtitleMutationOkResponse, SubtitleProjectDTO, SubtitleProjectListResponse, SubtitleProjectResponse } from '@excuse/shared'
import type { ServerConfig } from '../config'
import {
  createGenerationRecord,
  createTask,
  deleteSubtitleProject,
  getSubtitleProjectForAccount,
  listSubtitleProjectsByAccount,
  updateSubtitleExport,
  updateSubtitleProjectStatus,
  updateSubtitleSentences,
  updateSubtitleStyle,
} from '@excuse/db'
import { ASRClient } from '@excuse/provider'
import { Elysia, t } from 'elysia'
import * as svc from '../modules/subtitle/service'
import { createRequireAuthPlugin } from '../plugins/auth'
import { notFound } from '../utils/errors'

export function createSubtitleRoutes(config: ServerConfig) {
  const asrClient = new ASRClient({
    apiKey: config.dashscopeApiKey,
    baseUrl: config.dashscopeBaseUrl,
  })
  const deps: svc.SubtitleDependencies = { asrClient }

  /** 从 DB 行序列化为前端兼容格式（Date→string） */
  function serializeProject(project: SubtitleProjectRow): SubtitleProjectDTO {
    return {
      ...project,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    }
  }

  return new Elysia({ prefix: '/api/subtitle' })
    .use(createRequireAuthPlugin(config))

    // 创建字幕项目 — 上传视频 → 创建项目记录 → 调度 media.extract-audio 任务
    .post('/projects', async ({ body, userId }) => {
      const project = await svc.createAndStartProject(
        userId,
        body.videoFileId,
      )
      return { success: true, data: serializeProject(project) } satisfies SubtitleProjectResponse
    }, {
      body: t.Object({
        videoFileId: t.String(),
      }),
      detail: {
        summary: '创建字幕项目',
        description: '上传视频文件，创建项目记录并调度 Worker 异步提取音频和处理 ASR',
        tags: ['字幕'],
        security: [{ bearerAuth: [] }],
      },
    })

    // 列出用户的字幕项目
    .get('/projects', async ({ userId }) => {
      const projects = await listSubtitleProjectsByAccount(userId)
      const serialized = projects.map(serializeProject)
      return { success: true, items: serialized, total: serialized.length } satisfies SubtitleProjectListResponse
    }, {
      detail: {
        summary: '列出字幕项目',
        tags: ['字幕'],
        security: [{ bearerAuth: [] }],
      },
    })

    // 获取字幕项目详情
    .get('/projects/:id', async ({ params: { id }, userId, set }) => {
      const project = await getSubtitleProjectForAccount(id, userId)
      if (!project)
        return notFound(set, '字幕项目不存在或无权访问')
      return { success: true, data: serializeProject(project) } satisfies SubtitleProjectResponse
    }, {
      params: t.Object({ id: t.String() }),
      detail: {
        summary: '获取字幕项目详情',
        tags: ['字幕'],
        security: [{ bearerAuth: [] }],
      },
    })

    // 更新字幕句子（用户编辑后保存）
    .patch('/projects/:id/sentences', async ({ params: { id }, body, userId, set }) => {
      const project = await getSubtitleProjectForAccount(id, userId)
      if (!project)
        return notFound(set, '字幕项目不存在或无权访问')

      await updateSubtitleSentences(id, body.sentences)
      const updated = await getSubtitleProjectForAccount(id, userId)
      if (!updated)
        return notFound(set, '字幕项目不存在或无权访问')
      return { success: true, data: serializeProject(updated) } satisfies SubtitleProjectResponse
    }, {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        sentences: t.Array(t.Object({
          id: t.String(),
          text: t.String(),
          beginTime: t.Number(),
          endTime: t.Number(),
          speakerId: t.Optional(t.Number()),
        })),
      }),
      detail: {
        summary: '更新字幕句子',
        description: '用户编辑字幕后保存（合并、拆分、修改文字、调整时间戳）',
        tags: ['字幕'],
        security: [{ bearerAuth: [] }],
      },
    })

    // 更新字幕样式配置
    .patch('/projects/:id/style', async ({ params: { id }, body, userId, set }) => {
      const project = await getSubtitleProjectForAccount(id, userId)
      if (!project)
        return notFound(set, '字幕项目不存在或无权访问')

      await updateSubtitleStyle(id, body.styleConfig as SubtitleStyleConfig)
      const updated = await getSubtitleProjectForAccount(id, userId)
      if (!updated)
        return notFound(set, '字幕项目不存在或无权访问')
      return { success: true, data: serializeProject(updated) } satisfies SubtitleProjectResponse
    }, {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        styleConfig: t.Object({
          templateId: t.String(),
          fontSize: t.Number(),
          fontColor: t.String(),
          outlineColor: t.String(),
          outlineWidth: t.Number(),
          position: t.Union([t.Literal('top'), t.Literal('center'), t.Literal('bottom')]),
          marginV: t.Number(),
          bold: t.Boolean(),
        }),
      }),
      detail: {
        summary: '更新字幕样式',
        description: '选择预设模板或微调字号/颜色/位置等样式参数',
        tags: ['字幕'],
        security: [{ bearerAuth: [] }],
      },
    })

    // 提交导出任务 — 创建 generation_record + media.burn-subtitle 任务
    .post('/projects/:id/export', async ({ params: { id }, userId, set }) => {
      const project = await getSubtitleProjectForAccount(id, userId)
      if (!project)
        return notFound(set, '字幕项目不存在或无权访问')

      if (!project.sentences || project.sentences.length === 0)
        return notFound(set, '没有字幕内容，无法导出')

      if (['draft', 'extracting_audio', 'asr_processing', 'exporting'].includes(project.status))
        return notFound(set, '项目正在处理或尚未完成字幕识别，无法导出')

      // 创建导出 generation_record
      const exportRecord = await createGenerationRecord({
        accountId: userId,
        taskId: `export_${crypto.randomUUID()}_${project.id}`,
        traceId: crypto.randomUUID(),
        model: 'ffmpeg-burn',
        category: 'subtitle',
        status: 'processing',
        inputParams: {
          projectId: project.id,
          styleConfig: project.styleConfig,
        } as Record<string, unknown>,
      })

      // 设置 exportRecordId + 状态为 exporting
      await updateSubtitleExport(project.id, exportRecord.id)
      await updateSubtitleProjectStatus(project.id, 'exporting')

      // 创建 media.burn-subtitle 任务（Worker 异步执行）
      await createTask({
        accountId: userId,
        type: 'media.burn-subtitle',
        domain: 'subtitle',
        priority: 5,
        projectId: project.id,
        targetType: 'subtitle_project',
        targetId: project.id,
        input: {
          exportRecordId: exportRecord.id,
        },
      })

      return { success: true } satisfies SubtitleMutationOkResponse
    }, {
      params: t.Object({ id: t.String() }),
      detail: {
        summary: '提交导出任务',
        description: '将字幕烧录到视频中，fire-and-forget 模式',
        tags: ['字幕'],
        security: [{ bearerAuth: [] }],
      },
    })

    // 重试失败项目 — 智能跳过已完成的步骤
    .post('/projects/:id/retry', async ({ params: { id }, userId, set }) => {
      const project = await getSubtitleProjectForAccount(id, userId)
      if (!project)
        return notFound(set, '字幕项目不存在或无权访问')

      if (project.status !== 'failed')
        return notFound(set, '只有失败状态的项目才能重试')

      const retried = await svc.retryProject(project, userId, deps)

      return { success: true, data: serializeProject(retried) } satisfies SubtitleProjectResponse
    }, {
      params: t.Object({ id: t.String() }),
      detail: {
        summary: '重试失败项目',
        description: '对失败状态的项目重试，复用已上传的视频重新执行提取音频和 ASR 管道',
        tags: ['字幕'],
        security: [{ bearerAuth: [] }],
      },
    })

    // 删除字幕项目
    .delete('/projects/:id', async ({ params: { id }, userId, set }) => {
      const project = await getSubtitleProjectForAccount(id, userId)
      if (!project)
        return notFound(set, '字幕项目不存在或无权访问')

      await deleteSubtitleProject(id)
      return { success: true } satisfies SubtitleMutationOkResponse
    }, {
      params: t.Object({ id: t.String() }),
      detail: {
        summary: '删除字幕项目',
        tags: ['字幕'],
        security: [{ bearerAuth: [] }],
      },
    })
}
