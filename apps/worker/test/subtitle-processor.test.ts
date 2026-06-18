/**
 * 字幕任务处理器单元测试 — processASRTask
 *
 * 策略：mock.module 替换 @excuse/db，验证 ASR 任务轮询流程。
 */
import type { GenerationRecordRow, SubtitleProjectRow, UploadedFileRow } from '@excuse/db'
import type { ASRClient, ASRTaskStatus } from '@excuse/provider'
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
  scheduleASRProjectProviderRetry: async (id: string, msg: string, nextPollAt: Date) => {
    dbState.updatedProjects.push({ id, status: 'asr_processing', extra: { errorMessage: msg, nextPollAt } })
  },
  notifyGenerationStatus: async (payload: Record<string, unknown>) => {
    dbState.notifications.push(payload)
  },
  notifyNotification: async (payload: Record<string, unknown>) => {
    dbState.notifications.push(payload)
  },
}))

// 在 mock 之后导入 processor
const { processASRTask } = await import('../src/subtitle-processor')

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
    lockedBy: '',
    lockedUntil: null,
    providerFailureCount: 0,
    nextPollAt: null,
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
    lockedBy: '',
    lockedUntil: null,
    providerFailureCount: 0,
    nextPollAt: null,
    dedupeKey: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as GenerationRecordRow
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

    // SSE 通知（notifyGenerationStatus + notifyNotification = 2）
    expect(dbState.notifications.length).toBeGreaterThanOrEqual(1)
    expect(dbState.notifications.some(n => n.status === 'succeeded')).toBe(true)
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

    // notifyGenerationStatus + notifyNotification = 2 notifications
    expect(dbState.notifications.length).toBeGreaterThanOrEqual(1)
    expect(dbState.notifications.some(n => n.status === 'failed')).toBe(true)
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

  it('ASR FAILED 为可重试 provider 错误时仅排下次轮询，不终态失败', async () => {
    resetState()
    const project = makeProject()
    dbState.records.push(makeRecord())

    const asrClient = makeMockASRClient(
      { taskId: 'task-asr-001', status: 'FAILED', errorMessage: 'Throttling: please retry later' },
    )

    await processASRTask(project, asrClient)

    expect(dbState.failedRecords).toHaveLength(0)
    expect(dbState.notifications).toHaveLength(0)
    const retryUpdate = dbState.updatedProjects.find(u => u.status === 'asr_processing')
    expect(retryUpdate).toBeDefined()
    expect(retryUpdate!.extra?.errorMessage).toBe('Throttling: please retry later')
    expect(retryUpdate!.extra?.nextPollAt).toBeInstanceOf(Date)
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

  it('ASR 超时（updatedAt 早于 staleTimeoutMs）→ 项目和 record 标记失败 + 通知，且不调用 queryTask', async () => {
    resetState()
    // updatedAt 设为 2 小时前，staleTimeoutMs = 1 小时 → 超时
    const project = makeProject({ updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) })
    dbState.records.push(makeRecord())

    // queryTask 即便返回 PENDING 也不该被调用到（超时在前短路）
    const queryTask = mock(() => Promise.resolve({ taskId: 'task-asr-001', status: 'PENDING' as const }))
    const asrClient = { queryTask } as unknown as ASRClient

    await processASRTask(project, asrClient, { staleTimeoutMs: 60 * 60 * 1000 })

    expect(queryTask).toHaveBeenCalledTimes(0)

    const failedUpdate = dbState.updatedProjects.find(u => u.status === 'failed')
    expect(failedUpdate).toBeDefined()
    expect(failedUpdate!.extra?.errorMessage).toContain('超时')

    expect(dbState.failedRecords).toHaveLength(1)
    expect(dbState.failedRecords[0]!.msg).toContain('超时')

    // SSE 失败通知 + 用户通知
    expect(dbState.notifications.some(n => n.status === 'failed')).toBe(true)
    expect(dbState.notifications.some(n => n.type === 'task_failed')).toBe(true)
  })

  it('ASR 未超时（updatedAt 在窗口内）→ 正常轮询，PENDING 不标记失败', async () => {
    resetState()
    // updatedAt 设为 5 分钟前，staleTimeoutMs = 1 小时 → 未超时
    const project = makeProject({ updatedAt: new Date(Date.now() - 5 * 60 * 1000) })
    dbState.records.push(makeRecord())

    const asrClient = makeMockASRClient({ taskId: 'task-asr-001', status: 'PENDING' })

    await processASRTask(project, asrClient, { staleTimeoutMs: 60 * 60 * 1000 })

    expect(dbState.updatedProjects).toHaveLength(0)
    expect(dbState.failedRecords).toHaveLength(0)
  })
})
