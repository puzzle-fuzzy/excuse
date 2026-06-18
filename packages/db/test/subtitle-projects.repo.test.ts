import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { createSubtitleProject, pollPendingASRProjects, releaseASRProjectClaims } from '../src/repositories/subtitle-projects.repo'
import { createUploadedFile } from '../src/repositories/uploaded-files.repo'
import {
  beginTestTransaction,
  initTestDb,
  rollbackTestTransaction,
  teardownTestDb,
} from './helpers/test-db'

describe('subtitle-projects repository', () => {
  let accountId: string
  let videoFileId: string

  beforeAll(async () => {
    await initTestDb()
  })

  afterAll(async () => {
    await teardownTestDb()
  })

  beforeEach(async () => {
    const ctx = await beginTestTransaction()
    accountId = ctx.accountId
    const file = await createUploadedFile({
      accountId,
      fileName: 'source.mp4',
      fileSize: 1024,
      mimeType: 'video/mp4',
      storagePath: 'uploads/source.mp4',
      publicUrl: '/api/uploads/source.mp4',
      purpose: 'subtitle',
    })
    videoFileId = file.id
  })

  afterEach(async () => {
    await rollbackTestTransaction()
  })

  function validInsert(overrides: Record<string, unknown> = {}) {
    return {
      accountId,
      videoFileId,
      videoUrl: '/api/uploads/source.mp4',
      status: 'asr_processing' as const,
      ...overrides,
    }
  }

  describe('pollPendingASRProjects', () => {
    it('claim ASR 项目并跳过已锁行，释放后可再次 claim', async () => {
      await createSubtitleProject(validInsert())
      await createSubtitleProject(validInsert())
      await createSubtitleProject(validInsert({ status: 'draft' }))

      const projects = await pollPendingASRProjects('worker-a', 30_000)
      expect(projects).toHaveLength(2)
      expect(projects.every(project => project.status === 'asr_processing')).toBe(true)

      const secondClaim = await pollPendingASRProjects('worker-b', 30_000)
      expect(secondClaim).toHaveLength(0)

      await releaseASRProjectClaims(projects.map(project => project.id), 'worker-a')
      const afterRelease = await pollPendingASRProjects('worker-b', 30_000)
      expect(afterRelease).toHaveLength(2)
    })
  })
})
