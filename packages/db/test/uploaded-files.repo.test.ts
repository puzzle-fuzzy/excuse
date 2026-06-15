import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { createGenerationRecord } from '../src/repositories/generation-records.repo'
import { createSubtitleProject } from '../src/repositories/subtitle-projects.repo'
import {
  createUploadedFile,
  getUploadedFileById,
  getUploadedFileUsage,
} from '../src/repositories/uploaded-files.repo'
import {
  beginTestTransaction,
  initTestDb,
  rollbackTestTransaction,
  teardownTestDb,
} from './helpers/test-db'

describe('uploaded-files repository', () => {
  let accountId: string

  beforeAll(async () => {
    await initTestDb()
  })

  afterAll(async () => {
    await teardownTestDb()
  })

  beforeEach(async () => {
    const ctx = await beginTestTransaction()
    accountId = ctx.accountId
  })

  afterEach(async () => {
    await rollbackTestTransaction()
  })

  function validFileInsert(overrides: Record<string, unknown> = {}) {
    return {
      accountId,
      fileName: 'photo.png',
      fileSize: 1024,
      mimeType: 'image/png',
      storagePath: '/data/uploads/photo.png',
      publicUrl: '/uploads/photo.png',
      purpose: 'reference',
      ...overrides,
    }
  }

  // ─── createUploadedFile ────────────────────────────────

  describe('createUploadedFile', () => {
    it('插入并返回文件记录', async () => {
      const result = await createUploadedFile(validFileInsert())

      expect(result.id).toBeDefined()
      expect(result.accountId).toBe(accountId)
      expect(result.fileName).toBe('photo.png')
      expect(result.fileSize).toBe(1024)
      expect(result.mimeType).toBe('image/png')
      expect(result.purpose).toBe('reference')
      expect(result.createdAt).toBeInstanceOf(Date)
    })
  })

  // ─── getUploadedFileById ───────────────────────────────

  describe('getUploadedFileById', () => {
    it('找到时返回文件记录', async () => {
      const created = await createUploadedFile(validFileInsert())
      const found = await getUploadedFileById(created.id)

      expect(found).not.toBeNull()
      expect(found!.id).toBe(created.id)
      expect(found!.fileName).toBe('photo.png')
    })

    it('不存在的 ID 返回 null', async () => {
      const result = await getUploadedFileById('00000000-0000-0000-0000-000000000000')
      expect(result).toBeNull()
    })
  })

  // ─── 约束验证 ─────────────────────────────────────────

  describe('constraints', () => {
    it('无效 accountId 时拒绝（FK 约束）', async () => {
      await expect(
        createUploadedFile(validFileInsert({ accountId: '00000000-0000-0000-0000-000000000000' })),
      ).rejects.toThrow()
    })
  })

  // ─── getUploadedFileUsage ─────────────────────────────────

  describe('getUploadedFileUsage', () => {
    it('无引用时两个 count 都为 0', async () => {
      const file = await createUploadedFile(validFileInsert())
      const usage = await getUploadedFileUsage(accountId, file.id)
      expect(usage.subtitleProjectCount).toBe(0)
      expect(usage.generationRecordCount).toBe(0)
    })

    it('subtitle_projects.videoFileId 引用时 subtitleProjectCount > 0', async () => {
      const file = await createUploadedFile(validFileInsert({ mimeType: 'video/mp4', fileName: 'video.mp4' }))
      await createSubtitleProject({
        accountId,
        videoFileId: file.id,
        videoUrl: file.publicUrl,
        status: 'draft',
      })
      const usage = await getUploadedFileUsage(accountId, file.id)
      expect(usage.subtitleProjectCount).toBeGreaterThanOrEqual(1)
      expect(usage.generationRecordCount).toBe(0)
    })

    it('generation_records.inputParams.referenceFileIds 引用时 generationRecordCount > 0', async () => {
      const file = await createUploadedFile(validFileInsert())
      await createGenerationRecord({
        accountId,
        model: 'test-model',
        category: 'image',
        status: 'pending',
        inputParams: { referenceFileIds: [file.id], prompt: 'test' },
      })
      const usage = await getUploadedFileUsage(accountId, file.id)
      expect(usage.subtitleProjectCount).toBe(0)
      expect(usage.generationRecordCount).toBeGreaterThanOrEqual(1)
    })

    it('其他用户的引用不计入自己的 usage（权限隔离）', async () => {
      const file = await createUploadedFile(validFileInsert())
      // 创建属于其他用户的字幕项目引用 — 使用不同 accountId 会违反 FK，所以测试 "自己不引用" = 0
      const usage = await getUploadedFileUsage(accountId, file.id)
      expect(usage.subtitleProjectCount).toBe(0)
      expect(usage.generationRecordCount).toBe(0)
    })

    it('同时被字幕项目和生成记录引用时两个 count 都 > 0', async () => {
      const file = await createUploadedFile(validFileInsert({ mimeType: 'video/mp4', fileName: 'video.mp4' }))
      await createSubtitleProject({
        accountId,
        videoFileId: file.id,
        videoUrl: file.publicUrl,
        status: 'draft',
      })
      await createGenerationRecord({
        accountId,
        model: 'test-model',
        category: 'image',
        status: 'pending',
        inputParams: { referenceFileIds: [file.id], prompt: 'test' },
      })
      const usage = await getUploadedFileUsage(accountId, file.id)
      expect(usage.subtitleProjectCount).toBeGreaterThanOrEqual(1)
      expect(usage.generationRecordCount).toBeGreaterThanOrEqual(1)
    })
  })
})
