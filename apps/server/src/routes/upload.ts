import type { UploadedFilePatch } from '@excuse/db'
import type { MutationOkResponse, UploadedFileDTO, UploadResponse } from '@excuse/shared'
import type { ServerConfig } from '../config'
import { createUploadedFile, deleteUploadedFileById, getUploadedFileById, getUploadedFileUsage, updateUploadedFile } from '@excuse/db'
import { AssetStorage } from '@excuse/provider'
import { createLogger } from '@excuse/shared'
import { Elysia, t } from 'elysia'
import { createRequireAuthPlugin } from '../plugins/auth'
import { audit } from '../services/audit'
import { conflict, forbidden, notFound, validationError } from '../utils/errors'

const logger = createLogger('upload')

const ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  // 字幕功能支持的视频格式
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
]
const MAX_FILE_SIZE = 200 * 1024 * 1024 // 200MB（视频文件更大）

/**
 * DB row → DTO 序列化（Date → string）
 *
 * 上传文件 DTO 必须包含 createdAt 等 Date 字段的字符串序列化，
 * 与 GenerationRecord / AuthUser 保持一致的模式。
 */
function serializeUploadedFile(record: {
  id: string
  accountId: string
  fileName: string
  fileSize: number
  mimeType: string
  storagePath: string
  publicUrl: string
  purpose: string
  metadata: Record<string, unknown> | null
  createdAt: Date
}): UploadedFileDTO {
  return {
    ...record,
    createdAt: record.createdAt.toISOString(),
  }
}

export function createUploadRoutes(config: ServerConfig) {
  const storage = new AssetStorage({
    storageRoot: config.storageRoot,
    oss: config.oss,
  })

  return new Elysia({ prefix: '/api' })
    .use(createRequireAuthPlugin(config))
    // 文件上传
    .post('/upload', async ({ body, userId, set }) => {
      const file = body.file
      if (!file) {
        return validationError(set, 'No file provided')
      }

      if (!ALLOWED_MIME_TYPES.includes(file.type)) {
        return validationError(set, `不支持的文件类型: ${file.type}，仅允许 PNG/JPEG/WebP/GIF/MP4/WebM/MOV/AVI`)
      }

      if (file.size > MAX_FILE_SIZE) {
        return validationError(set, `文件大小超过限制（最大 ${MAX_FILE_SIZE / 1024 / 1024}MB）`)
      }

      const subDir = `ref_${Date.now()}`
      const { storagePath, publicUrl } = await storage.saveUploadedFile(file, subDir)

      const record = await createUploadedFile({
        accountId: userId,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        storagePath,
        publicUrl,
        purpose: 'reference',
      })

      return {
        success: true,
        data: serializeUploadedFile(record),
      } satisfies UploadResponse
    }, {
      body: t.Object({
        file: t.File({ description: '上传的文件' }),
      }),
      detail: {
        summary: '上传文件',
        description: '上传图片或视频文件（PNG/JPEG/WebP/GIF/MP4/WebM/MOV/AVI，最大 200MB），保存到存储并创建 DB 记录',
        tags: ['上传'],
        security: [{ bearerAuth: [] }],
      },
    })

    // 删除上传文件（安全语义：先检查使用 → 先删 DB → 后删存储）
    .delete('/upload/:id', async ({ params: { id }, userId, set }) => {
      const record = await getUploadedFileById(id)
      if (!record) {
        return notFound(set, '文件不存在')
      }
      if (record.accountId !== userId) {
        return forbidden(set, '无权删除该文件')
      }

      // 使用中保护：被字幕项目或生成记录引用时不允许删除
      const usage = await getUploadedFileUsage(userId, id)
      if (usage.subtitleProjectCount > 0 || usage.generationRecordCount > 0) {
        return conflict(set, '该文件正在被字幕项目或生成记录使用，暂不能删除')
      }

      // 安全删除顺序：先删 DB 记录，再删存储文件
      // DB 删除成功后存储删除失败时只记录日志，不回滚 DB
      await deleteUploadedFileById(id)
      try {
        await storage.deleteFile(record.storagePath)
      }
      catch (err) {
        // 存储删除失败只记录日志，不回滚 DB 记录（DB 已删除）
        logger.error({ accountId: userId, targetId: id, storagePath: record.storagePath, err }, 'file delete: storage deletion failed after DB record removed')
      }

      audit('file_delete', { accountId: userId, targetId: id })

      return { success: true } satisfies MutationOkResponse
    }, {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        summary: '删除上传文件',
        description: '删除指定文件（需为文件所有者）。被字幕项目或生成记录使用的文件不能删除。先删除 DB 记录再删除存储文件。',
        tags: ['上传'],
        security: [{ bearerAuth: [] }],
      },
    })

    // 编辑上传文件（重命名/用途）
    .patch('/upload/:id', async ({ params: { id }, body, userId, set }) => {
      const record = await getUploadedFileById(id)
      if (!record) {
        return notFound(set, '文件不存在')
      }
      if (record.accountId !== userId) {
        return forbidden(set, '无权编辑该文件')
      }

      const patch: UploadedFilePatch = {}
      if (body.fileName !== undefined) {
        const trimmed = body.fileName.trim()
        if (!trimmed) {
          return validationError(set, '文件名不能为空')
        }
        patch.fileName = trimmed
      }
      if (body.purpose !== undefined) {
        const trimmed = body.purpose.trim()
        if (!trimmed) {
          return validationError(set, '用途不能为空')
        }
        patch.purpose = trimmed
      }

      const updated = await updateUploadedFile(id, userId, patch)
      if (!updated) {
        return notFound(set, '文件不存在')
      }

      audit('file_update', { accountId: userId, targetId: id })

      return {
        success: true,
        data: serializeUploadedFile(updated),
      } satisfies UploadResponse
    }, {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        fileName: t.Optional(t.String({ maxLength: 500 })),
        purpose: t.Optional(t.String({ maxLength: 50 })),
      }),
      detail: {
        summary: '编辑上传文件（重命名/用途）',
        description: '编辑指定上传文件的文件名或用途（需为文件所有者）。返回更新后的文件 DTO；空 patch 直接返回当前记录。',
        tags: ['上传'],
        security: [{ bearerAuth: [] }],
      },
    })
}
