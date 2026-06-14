/**
 * 字幕任务处理器单元测试 — processASRTask + processExportTask
 *
 * 策略：mock.module 替换 @excuse/db 和 @excuse/provider，
 * 依赖注入 ASRClient，验证 ASR 任务轮询和导出流程。
 *
 * 注意：processExportTask 内部使用 new AssetStorage() 和 Bun.file()，
 * 这两个无法通过 deps 注入，需要通过 mock.module 替换整个包。
 * Bun.file() 的 arrayBuffer/delete 也需要模拟，否则会尝试读取真实文件。
 */
import type { GenerationRecordRow, SubtitleProjectRow, UploadedFileRow } from '@excuse/db'
import type { ASRClient, ASRTaskStatus } from '@excuse/provider'
import type { WorkerConfig } from '../src/config'
import { describe, expect, it, mock } from 'bun:test'

// ── Mock 依赖 ──────────────────────────────────────────

const dbState = {
  records: [] as GenerationRecordRow[],
  files: [] as UploadedFileRow[],
  updatedProjects: [] as Array<{ id: string, status: string, extra?: Record<string, unknown> }>,
  updatedSentences: [] as Array<{ id: string, sentences: Array<Record<string, unknown>>, rawJson: unknown }>,
  succeededRecords: [] as Array<{ id: string, output: Record<string, unknown> }>,
  failedRecords: [] as Array<{ id: string, msg: string }>,
  updatedExports: [] as Array<{ id: string, recordId: string, videoUrl: string }>,
  uploadedKeys: [] as string[],
  notifications: [] as Array<Record<string, unknown>>,
}

mock.module('@excuse/db', () => ({
  getGenerationRecordById: async (id: string) => dbState.records.find(r => r.id === id),
  getUploadedFileById: async (id: string) => dbState.files.find(f => f.id === id),
  updateSubtitleProjectStatus: async (id: string, status: string, extra?: Record<string, unknown>) => {
    dbState.updatedProjects.push({ id, status, extra })
  },
  updateSubtitleSentences: async (id: string, sentences: Array<Record<string, unknown>>, rawJson?: unknown) => {
    dbState.updatedSentences.push({ id, sentences, rawJson })
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
}))

mock.module('@excuse/provider', () => ({
  burnSubtitlesToVideo: async () => ({ outputPath: '/tmp/test-export.mp4', fileSize: 1024 }),
  AssetStorage: class MockAssetStorage {
    constructor(_config: any) {}
    async uploadGenerated(_buffer: Buffer, key: string) {
      dbState.uploadedKeys.push(key)
      return `https://cdn/${key}`
    }
  },
}))

// 在 mock 之后导入 processor
const { processASRTask, processExportTask } = await import('../src/subtitle-processor')

// ── 测试工具 ──────────────────────────────────────────

function resetState() {
  dbState.records = []
  dbState.files = []
  dbState.updatedProjects = []
  dbState.updatedSentences = []
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
    status: 'asr_processing',
    audioFileUrl: 'https://cdn/audio.wav',
    videoDurationMs: 30000,
    asrRecordId: 'rec-asr-001',
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
    id: 'rec-asr-001',
    accountId: 'acc-test',
    taskId: 'task-asr-001',
    model: 'paraformer-v2',
    category: 'subtitle',
    status: 'processing',
    inputParams: {},
    outputResult: null,
    cost: { unit: 'audio', totalPriceCents: 0.24, totalPrice: 0.0024, duration: 30, unitPriceCents: 0.008, unitPrice: 0.00008 },
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

function makeMockASRClient(queryResult: ASRTaskStatus, parseResult?: Array<Record<string, unknown>>): ASRClient {
  return {
    queryTask: async () => queryResult,
    parseTranscription: () => parseResult ?? [
      { id: 's1', text: '你好世界', beginTime: 0, endTime: 2000 },
      { id: 's2', text: '再见', beginTime: 2000, endTime: 5000 },
    ],
  } as unknown as ASRClient
}

function makeWorkerConfig(): WorkerConfig {
  return {
    dashscopeApiKey: 'test-key',
    dashscopeBaseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    storageRoot: '/tmp/test-storage',
    pollIntervalMs: 5000,
    staleTimeoutMs: 1800000,
    oss: undefined,
  }
}

// ── processASRTask ──────────────────────────────────

describe('processASRTask', () => {
  it('没有 asrRecordId 时跳过处理', async () => {
    resetState()
    const project = makeProject({ asrRecordId: null })
    const asrClient = makeMockASRClient({ taskId: 't1', status: 'UNKNOWN' })

    await processASRTask(project, asrClient)

    expect(dbState.updatedProjects).toHaveLength(0)
    expect(dbState.succeededRecords).toHaveLength(0)
    expect(dbState.failedRecords).toHaveLength(0)
  })

  it('generation_record 不存在时跳过处理', async () => {
    resetState()
    const project = makeProject()
    dbState.records = []
    const asrClient = makeMockASRClient({ taskId: 't1', status: 'SUCCEEDED' })

    await processASRTask(project, asrClient)

    expect(dbState.updatedProjects).toHaveLength(0)
  })

  it('record 没有 taskId 时跳过处理', async () => {
    resetState()
    const project = makeProject()
    dbState.records.push(makeRecord({ taskId: null }))
    const asrClient = makeMockASRClient({ taskId: 't1', status: 'SUCCEEDED' })

    await processASRTask(project, asrClient)

    expect(dbState.updatedProjects).toHaveLength(0)
  })

  it('ASR SUCCEEDED → 更新句子、项目状态、record 成功、SSE 通知', async () => {
    resetState()
    const project = makeProject()
    dbState.records.push(makeRecord())

    const sentences = [
      { id: 's1', text: '你好', beginTime: 0, endTime: 2000 },
      { id: 's2', text: '再见', beginTime: 2000, endTime: 5000 },
    ]

    const asrClient = makeMockASRClient(
      { taskId: 'task-asr-001', status: 'SUCCEEDED', transcriptionUrl: 'https://cdn/transcript.json' },
      sentences,
    )

    // Mock fetch — processASRTask 内部调用 fetch(transcriptionUrl) 下载转录 JSON
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ transcripts: [] }), { status: 200 })
    }

    try {
      await processASRTask(project, asrClient)
    }
    finally {
      globalThis.fetch = originalFetch
    }

    // 项目状态更新 — 只有 subtitle_editing
    const statusUpdate = dbState.updatedProjects.find(u => u.status === 'subtitle_editing')
    expect(statusUpdate).toBeDefined()

    // 句子更新
    expect(dbState.updatedSentences).toHaveLength(1)
    expect(dbState.updatedSentences[0]!.sentences).toEqual(sentences)

    // record 标记成功
    expect(dbState.succeededRecords).toHaveLength(1)
    expect(dbState.succeededRecords[0]!.output.type).toBe('subtitle')

    // SSE 通知
    expect(dbState.notifications).toHaveLength(1)
    expect(dbState.notifications[0]!.status).toBe('succeeded')
    expect(dbState.notifications[0]!.category).toBe('subtitle')
  })

  it('ASR SUCCEEDED 但没有 transcriptionUrl → 项目标记失败', async () => {
    resetState()
    const project = makeProject()
    dbState.records.push(makeRecord())

    const asrClient = makeMockASRClient(
      { taskId: 'task-asr-001', status: 'SUCCEEDED' },
      [],
    )

    await processASRTask(project, asrClient)

    const failedUpdate = dbState.updatedProjects.find(u => u.status === 'failed')
    expect(failedUpdate).toBeDefined()

    expect(dbState.failedRecords).toHaveLength(1)
    expect(dbState.failedRecords[0]!.msg).toContain('ASR 完成但未返回转录结果')
  })

  it('ASR FAILED → 项目和 record 都标记失败', async () => {
    resetState()
    const project = makeProject()
    dbState.records.push(makeRecord())

    const asrClient = makeMockASRClient(
      { taskId: 'task-asr-001', status: 'FAILED', errorMessage: 'ASR 内部错误' },
    )

    await processASRTask(project, asrClient)

    const failedUpdate = dbState.updatedProjects.find(u => u.status === 'failed')
    expect(failedUpdate).toBeDefined()
    expect(failedUpdate!.extra?.errorMessage).toBe('ASR 内部错误')

    expect(dbState.failedRecords).toHaveLength(1)
    expect(dbState.failedRecords[0]!.msg).toBe('ASR 内部错误')

    expect(dbState.notifications).toHaveLength(1)
    expect(dbState.notifications[0]!.status).toBe('failed')
  })

  it('ASR FAILED 无 errorMessage → 使用默认消息', async () => {
    resetState()
    const project = makeProject()
    dbState.records.push(makeRecord())

    const asrClient = makeMockASRClient(
      { taskId: 'task-asr-001', status: 'FAILED' },
    )

    await processASRTask(project, asrClient)

    expect(dbState.failedRecords[0]!.msg).toBe('ASR 任务失败')
  })

  it('ASR PENDING → 不做任何更新，等待下一轮', async () => {
    resetState()
    const project = makeProject()
    dbState.records.push(makeRecord())

    const asrClient = makeMockASRClient(
      { taskId: 'task-asr-001', status: 'PENDING' },
    )

    await processASRTask(project, asrClient)

    expect(dbState.updatedProjects).toHaveLength(0)
    expect(dbState.succeededRecords).toHaveLength(0)
    expect(dbState.failedRecords).toHaveLength(0)
  })

  it('ASR RUNNING → 不做任何更新，等待下一轮', async () => {
    resetState()
    const project = makeProject()
    dbState.records.push(makeRecord())

    const asrClient = makeMockASRClient(
      { taskId: 'task-asr-001', status: 'RUNNING' },
    )

    await processASRTask(project, asrClient)

    expect(dbState.updatedProjects).toHaveLength(0)
    expect(dbState.succeededRecords).toHaveLength(0)
    expect(dbState.failedRecords).toHaveLength(0)
  })
})

// ── processExportTask ──────────────────────────────────

describe('processExportTask', () => {
  it('没有 exportRecordId 时跳过处理', async () => {
    resetState()
    const project = makeProject({ exportRecordId: null, status: 'exporting' })

    await processExportTask(project, makeWorkerConfig())

    expect(dbState.updatedProjects).toHaveLength(0)
  })

  it('没有 sentences 时标记失败', async () => {
    resetState()
    const project = makeProject({
      exportRecordId: 'rec-export-001',
      sentences: null,
      status: 'exporting',
    })

    await processExportTask(project, makeWorkerConfig())

    const failedUpdate = dbState.updatedProjects.find(u => u.status === 'failed')
    expect(failedUpdate).toBeDefined()
    expect(dbState.failedRecords).toHaveLength(1)
    expect(dbState.failedRecords[0]!.msg).toContain('没有字幕内容')
  })

  it('空 sentences 数组时标记失败', async () => {
    resetState()
    const project = makeProject({
      exportRecordId: 'rec-export-001',
      sentences: [],
      status: 'exporting',
    })

    await processExportTask(project, makeWorkerConfig())

    const failedUpdate = dbState.updatedProjects.find(u => u.status === 'failed')
    expect(failedUpdate).toBeDefined()
  })

  it('原始视频文件不存在时标记失败', async () => {
    resetState()
    const project = makeProject({
      exportRecordId: 'rec-export-001',
      sentences: [{ id: 's1', text: '你好', beginTime: 0, endTime: 2000 }],
      status: 'exporting',
    })
    dbState.files = []
    dbState.records.push(makeRecord({ id: 'rec-export-001' }))

    await processExportTask(project, makeWorkerConfig())

    const failedUpdate = dbState.updatedProjects.find(u => u.status === 'failed')
    expect(failedUpdate).toBeDefined()
    expect(dbState.failedRecords.length).toBeGreaterThanOrEqual(1)
    expect(dbState.failedRecords.some(r => r.msg.includes('原始视频文件不存在'))).toBe(true)
  })

  it('导出成功时使用 exportRecordId 生成唯一文件路径，保留历史成片', async () => {
    resetState()
    const project = makeProject({
      exportRecordId: 'rec-export-001',
      sentences: [{ id: 's1', text: '你好', beginTime: 0, endTime: 2000 }],
      status: 'exporting',
    })
    dbState.files.push(makeUploadedFile({ id: 'file-001', publicUrl: './input.mp4', storagePath: 'uploads/input.mp4' }))
    dbState.records.push(makeRecord({ id: 'rec-export-001', taskId: 'task-export-001' }))

    const originalBunFile = Bun.file
    Bun.file = (() => ({
      arrayBuffer: async () => new ArrayBuffer(4),
      delete: async () => {},
    })) as typeof Bun.file

    try {
      await processExportTask(project, makeWorkerConfig())
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
