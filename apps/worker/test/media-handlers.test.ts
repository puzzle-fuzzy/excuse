/**
 * 媒体任务处理器单元测试 — handleMediaBurnSubtitle
 */
import type { GenerationRecordRow, SubtitleProjectRow, TaskRow, UploadedFileRow } from '@excuse/db'
import { describe, expect, it, mock } from 'bun:test'

// ── Shared test state ────────────────────────────────

const dbState: {
  records: GenerationRecordRow[]
  files: UploadedFileRow[]
  projects: SubtitleProjectRow[]
  updatedProjects: Array<{ id: string, status: string, extra?: Record<string, unknown> }>
  succeededRecords: Array<{ id: string, output: Record<string, unknown> }>
  failedRecords: Array<{ id: string, msg: string }>
  updatedExports: Array<{ id: string, recordId: string, videoUrl: string }>
  uploadedKeys: string[]
  notifications: Array<Record<string, unknown>>
} = {
  records: [],
  files: [],
  projects: [],
  updatedProjects: [],
  succeededRecords: [],
  failedRecords: [],
  updatedExports: [],
  uploadedKeys: [],
  notifications: [],
}

// Mock ALL exports that media-handlers.ts statically imports from @excuse/db
mock.module('@excuse/db', () => ({
  getGenerationRecordById: async (id: string) => dbState.records.find(r => r.id === id),
  getUploadedFileById: async (id: string) => dbState.files.find(f => f.id === id),
  getSubtitleProjectById: async (id: string) => dbState.projects.find(p => p.id === id),
  updateSubtitleProjectStatus: async (id: string, status: string, extra?: Record<string, unknown>) => {
    dbState.updatedProjects.push({ id, status, extra })
    const project = dbState.projects.find(p => p.id === id)
    if (project) {
      (project as Record<string, unknown>).status = status
      if (extra?.errorMessage !== undefined) {
        (project as Record<string, unknown>).errorMessage = extra.errorMessage
      }
    }
  },
  updateSubtitleExport: async (id: string, recordId: string, videoUrl: string) => {
    dbState.updatedExports.push({ id, recordId, videoUrl })
  },
  markGenerationSucceeded: async (id: string, output: Record<string, unknown>) => {
    dbState.succeededRecords.push({ id, output })
  },
  markGenerationFailed: async (id: string, msg: string) => {
    dbState.failedRecords.push({ id, msg })
  },
  notifyGenerationStatus: async (payload: Record<string, unknown>) => {
    dbState.notifications.push(payload)
  },
  notifyNotification: async (payload: Record<string, unknown>) => {
    dbState.notifications.push(payload)
  },
  createGenerationRecord: async (values: Record<string, unknown>) => {
    const record = {
      id: `rec-${crypto.randomUUID().slice(0, 8)}`,
      ...values,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    dbState.records.push(record as GenerationRecordRow)
    return record
  },
}))

// Mock ALL exports that media-handlers.ts statically imports from @excuse/provider
const MockAssetStorage = class {
  constructor(_config: unknown) {}
  async uploadGenerated(_buffer: Buffer, key: string) {
    dbState.uploadedKeys.push(key)
    return `https://cdn/${key}`
  }
}
mock.module('@excuse/provider', () => ({
  burnSubtitlesToVideo: async () => ({ outputPath: '/tmp/test-export.mp4', fileSize: 1024 }),
  AssetStorage: MockAssetStorage,
  ASRClient: class {},
  DashScopeClient: class {},
  extractAudioFromVideo: async () => ({ audioPath: '/tmp/test.wav', durationMs: 30000 }),
  getMediaDurationMs: async () => 30000,
  getModelById: () => undefined,
}))

// Import handler under test
const { handleMediaBurnSubtitle } = await import('../src/media-handlers')

// ── Test helpers ─────────────────────────────────────

function resetState() {
  dbState.records = []
  dbState.files = []
  dbState.projects = []
  dbState.updatedProjects = []
  dbState.succeededRecords = []
  dbState.failedRecords = []
  dbState.updatedExports = []
  dbState.uploadedKeys = []
  dbState.notifications = []
}

function makeProject(overrides: Partial<SubtitleProjectRow> = {}): SubtitleProjectRow {
  return {
    id: 'proj-test',
    accountId: 'acc-test',
    videoFileId: 'file-001',
    videoUrl: '/uploads/test.mp4',
    status: 'exporting',
    audioFileUrl: null,
    videoDurationMs: null,
    asrRecordId: null,
    sentences: null,
    styleConfig: {
      templateId: 'cinema',
      fontSize: 24,
      fontColor: '#FFFFFF',
      outlineColor: '#000000',
      outlineWidth: 2,
      position: 'bottom',
      marginV: 30,
      bold: false,
    },
    rawTranscription: null,
    exportRecordId: null,
    exportedVideoUrl: null,
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as SubtitleProjectRow
}

function makeRecord(overrides: Partial<GenerationRecordRow> = {}): GenerationRecordRow {
  return {
    id: 'rec-export-001',
    accountId: 'acc-test',
    taskId: 'task-export-001',
    model: 'ffmpeg-burn',
    category: 'subtitle',
    status: 'processing',
    inputParams: {},
    outputResult: null,
    cost: null,
    errorMessage: null,
    dedupeKey: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as GenerationRecordRow
}

function makeUploadedFile(overrides: Partial<UploadedFileRow> = {}): UploadedFileRow {
  return {
    id: 'file-001',
    accountId: 'acc-test',
    fileName: 'input.mp4',
    fileSize: 1024,
    mimeType: 'video/mp4',
    storagePath: 'uploads/input.mp4',
    publicUrl: './input.mp4',
    purpose: 'reference',
    metadata: null,
    createdAt: new Date(),
    ...overrides,
  } as UploadedFileRow
}

function makeWorkerContext() {
  return {
    config: {
      dashscopeApiKey: 'test-key',
      dashscopeBaseUrl: 'https://dashscope.aliyuncs.com/api/v1',
      storageRoot: '/tmp/test-storage',
      pollIntervalMs: 5000,
      staleTimeoutMs: 1800000,
      claimTtlMs: 30000,
      sweepIntervalMs: 60000,
      oss: undefined,
    },
    client: {},
    storage: new MockAssetStorage({}),
    asrClient: {},
  }
}

function makeBurnTask(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 'task-burn-001',
    accountId: 'acc-test',
    projectId: 'proj-test',
    type: 'media.burn-subtitle',
    domain: 'subtitle',
    priority: 5,
    input: { exportRecordId: 'rec-export-001' },
    output: null,
    status: 'running',
    attempts: 0,
    maxAttempts: 3,
    lockedBy: '',
    lockedUntil: null,
    startedAt: null,
    finishedAt: null,
    errorJson: null,
    errorMessage: null,
    targetType: null,
    targetId: null,
    generationRecordId: null,
    nextRunAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as TaskRow
}

// ── Tests ────────────────────────────────────────────

describe('handleMediaBurnSubtitle', () => {
  it('没有 exportRecordId 时抛出 TaskInputError（分类 validation 不重试）', async () => {
    resetState()
    const task = makeBurnTask({ input: {} })

    await expect(
      handleMediaBurnSubtitle(task, makeWorkerContext()),
    ).rejects.toThrow('media.burn-subtitle input missing exportRecordId')
  })

  it('项目不存在时抛出错误', async () => {
    resetState()
    const task = makeBurnTask()

    await expect(
      handleMediaBurnSubtitle(task, makeWorkerContext()),
    ).rejects.toThrow('字幕项目不存在')
  })

  it('没有 sentences 时标记失败并抛出错误', async () => {
    resetState()
    const task = makeBurnTask()
    dbState.projects.push(makeProject({ sentences: null }))

    await expect(
      handleMediaBurnSubtitle(task, makeWorkerContext()),
    ).rejects.toThrow('没有字幕内容')

    const failedUpdate = dbState.updatedProjects.find(u => u.status === 'failed')
    expect(failedUpdate).toBeDefined()
    expect(dbState.failedRecords).toHaveLength(1)
    expect(dbState.failedRecords[0]!.msg).toContain('没有字幕内容')
  })

  it('空 sentences 数组时标记失败', async () => {
    resetState()
    const task = makeBurnTask()
    dbState.projects.push(makeProject({ sentences: [] as never[] }))

    await expect(
      handleMediaBurnSubtitle(task, makeWorkerContext()),
    ).rejects.toThrow('没有字幕内容')

    const failedUpdate = dbState.updatedProjects.find(u => u.status === 'failed')
    expect(failedUpdate).toBeDefined()
  })

  it('原始视频文件不存在时标记失败', async () => {
    resetState()
    const task = makeBurnTask()
    dbState.projects.push(makeProject({
      sentences: [{ id: 's1', text: '你好', beginTime: 0, endTime: 2000 }],
    }))
    dbState.files = []

    await expect(
      handleMediaBurnSubtitle(task, makeWorkerContext()),
    ).rejects.toThrow()

    const failedUpdate = dbState.updatedProjects.find(u => u.status === 'failed')
    expect(failedUpdate).toBeDefined()
    expect(dbState.failedRecords.length).toBeGreaterThanOrEqual(1)
    expect(dbState.failedRecords.some(r => r.msg.includes('原始视频文件不存在'))).toBe(true)
  })

  it('导出成功时使用 exportRecordId 生成唯一文件路径', async () => {
    resetState()
    const task = makeBurnTask()
    dbState.projects.push(makeProject({
      exportRecordId: 'rec-export-001',
      sentences: [{ id: 's1', text: '你好', beginTime: 0, endTime: 2000 }],
    }))
    dbState.files.push(makeUploadedFile())
    dbState.records.push(makeRecord({ id: 'rec-export-001' }))

    const originalBunFile = Bun.file
    Bun.file = (() => ({
      arrayBuffer: async () => new ArrayBuffer(4),
      delete: async () => {},
    })) as typeof Bun.file

    try {
      await handleMediaBurnSubtitle(task, makeWorkerContext())
    }
    finally {
      Bun.file = originalBunFile
    }

    expect(dbState.uploadedKeys).toEqual(['subtitle/proj-test/export_rec-export-001.mp4'])
    expect(dbState.succeededRecords[0]).toEqual({
      id: 'rec-export-001',
      output: {
        type: 'video',
        savedUrls: ['https://cdn/subtitle/proj-test/export_rec-export-001.mp4'],
      },
    })
    expect(dbState.updatedExports[0]).toEqual({
      id: 'proj-test',
      recordId: 'rec-export-001',
      videoUrl: 'https://cdn/subtitle/proj-test/export_rec-export-001.mp4',
    })
  })
})
