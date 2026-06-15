/**
 * 字幕生成服务单元测试 — createAndStartProject + retryProject
 *
 * 策略：mock.module 替换 @excuse/db, @excuse/provider, @excuse/billing，
 * 验证业务逻辑流程（校验、状态转换、错误处理）。
 *
 * 注意：service 内部使用 Bun.file(audioPath).arrayBuffer() 读取本地文件，
 * 该操作无法通过 deps 注入 mock。涉及音频文件读写的流程（createAndStartProject
 * 成功路径、retryProject 从头开始路径）由于 Bun.file 的全局性质无法在
 * mock.module 模式下测试，这些路径由 worker 集成测试覆盖。
 *
 * 本测试聚焦于可通过 DI mock 验证的路径：
 *   - 文件校验（存在性 + 归属）
 *   - ASR 提交失败处理
 *   - retryProject 智能跳过（sentences/audioFileUrl 存在时）
 */
import type { SubtitleProjectRow, UploadedFileRow } from '@excuse/db'
import type { ASRClient, AssetStorage } from '@excuse/provider'
import type { ServerConfig } from '../src/config'
import { describe, expect, it, mock } from 'bun:test'

// ── Mock 依赖 ──────────────────────────────────────────

/** mock createGenerationRecord 返回的记录类型 */
interface MockGenerationRecord {
  id: string
  accountId: string
  taskId: string
  model: string
  category: string
  status: string
  cost: Record<string, unknown>
  inputParams: unknown
  traceId: string
  createdAt: Date
  updatedAt: Date
}

const dbState = {
  projects: [] as SubtitleProjectRow[],
  records: [] as MockGenerationRecord[],
  files: [] as UploadedFileRow[],
  notifications: [] as Array<Record<string, unknown>>,
}

mock.module('@excuse/db', () => ({
  getUploadedFileById: async (id: string) => dbState.files.find(f => f.id === id),
  createSubtitleProject: async (values: Record<string, unknown>) => {
    const project = {
      id: `proj-${crypto.randomUUID().slice(0, 8)}`,
      accountId: values.accountId as string,
      videoFileId: values.videoFileId as string,
      videoUrl: values.videoUrl as string,
      status: values.status as string || 'draft',
      audioFileUrl: null,
      videoDurationMs: null,
      asrRecordId: null,
      sentences: null,
      styleConfig: null,
      rawTranscription: null,
      exportRecordId: null,
      exportedVideoUrl: null,
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as SubtitleProjectRow
    dbState.projects.push(project)
    return project
  },
  getSubtitleProjectForAccount: async (id: string, accountId: string) => {
    return dbState.projects.find(p => p.id === id && p.accountId === accountId)
  },
  updateSubtitleProjectStatus: async (id: string, status: string, extra?: Record<string, unknown>) => {
    const project = dbState.projects.find(p => p.id === id)
    if (project) {
      (project as Record<string, unknown>).status = status
      if (extra) {
        for (const [key, value] of Object.entries(extra)) {
          (project as Record<string, unknown>)[key] = value
        }
      }
    }
    return project
  },
  createGenerationRecord: async (values: Record<string, unknown>) => {
    const record: MockGenerationRecord = {
      id: `rec-${crypto.randomUUID().slice(0, 8)}`,
      accountId: values.accountId as string,
      taskId: values.taskId as string,
      model: values.model as string,
      category: values.category as string,
      status: values.status as string,
      cost: values.cost as Record<string, unknown>,
      inputParams: values.inputParams,
      traceId: crypto.randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    dbState.records.push(record)
    return record
  },
  notifyGenerationStatus: async (payload: Record<string, unknown>) => {
    dbState.notifications.push(payload)
  },
  notifyNotification: async (payload: Record<string, unknown>) => {
    dbState.notifications.push(payload)
  },
  listNotifications: async () => [],
  getUnreadCount: async () => 0,
  markNotificationRead: async () => null,
  markAllNotificationsRead: async () => 0,
  findApiKeyByHash: async () => null,
  touchApiKeyLastUsed: async () => {},
}))

mock.module('@excuse/provider', () => ({
  extractAudioFromVideo: async () => ({ audioPath: '/tmp/test.wav', durationMs: 30000 }),
  getMediaDurationMs: async () => 30000,
  AssetStorage: class {
    async uploadGenerated() { return 'https://cdn/audio.wav' }
  },
}))

mock.module('@excuse/billing', () => ({
  calculateCost: (_model: Record<string, unknown>, params: { duration: number }) => ({
    unit: 'audio',
    duration: params.duration,
    unitPriceCents: 0.008,
    unitPrice: 0.0001,
    totalPriceCents: params.duration * 0.008,
    totalPrice: (params.duration * 0.008) / 100,
  }),
}))

// 在 mock 之后导入 service
const { createAndStartProject, retryProject } = await import('../src/modules/subtitle/service')

// ── 测试工具 ──────────────────────────────────────────

function resetState() {
  dbState.projects = []
  dbState.records = []
  dbState.files = []
  dbState.notifications = []
}

function makeUploadedFile(overrides: Partial<UploadedFileRow> = {}): UploadedFileRow {
  return {
    id: 'file-001',
    accountId: 'acc-test',
    fileName: 'test.mp4',
    fileSize: 1024 * 1024,
    mimeType: 'video/mp4',
    storagePath: 'uploads/test.mp4',
    publicUrl: '/uploads/test.mp4',
    purpose: 'reference',
    metadata: null,
    createdAt: new Date(),
    ...overrides,
  }
}

function makeProject(overrides: Partial<SubtitleProjectRow> = {}): SubtitleProjectRow {
  return {
    id: 'proj-test',
    accountId: 'acc-test',
    videoFileId: 'file-001',
    videoUrl: '/uploads/test.mp4',
    status: 'failed',
    audioFileUrl: null,
    videoDurationMs: null,
    asrRecordId: null,
    sentences: null,
    styleConfig: null,
    rawTranscription: null,
    exportRecordId: null,
    exportedVideoUrl: null,
    errorMessage: '之前的错误',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as SubtitleProjectRow
}

function makeConfig(): ServerConfig {
  return {
    port: 5007,
    databaseUrl: '',
    dashscopeApiKey: 'test-key',
    dashscopeBaseUrl: '',
    storageRoot: '/tmp/test-storage',
    frontendUrl: '',
    workerPollIntervalMs: 5000,
    jwtSecret: 'test-secret',
    jwtExpiresIn: '1h',
    oss: undefined,
    metricsAccessToken: undefined,
    metricsAllowedCidrs: ['127.0.0.1/32', '::1/128'],
  }
}

function makeDeps(asrOverrides: Partial<ASRClient> = {}): { asrClient: ASRClient, storage: AssetStorage } {
  return {
    asrClient: {
      submitTranscription: async () => ({ success: true, taskId: 'asr-task-001' }),
      ...asrOverrides,
    } as unknown as ASRClient,
    storage: {
      uploadGenerated: async () => 'https://cdn/audio.wav',
    } as unknown as AssetStorage,
  }
}

// ── createAndStartProject ──────────────────────────────

describe('createAndStartProject', () => {
  it('视频文件不存在时抛出错误', async () => {
    resetState()

    await expect(
      createAndStartProject('acc-test', 'nonexistent', makeConfig(), makeDeps()),
    ).rejects.toThrow('视频文件不存在或不属于当前用户')
  })

  it('视频文件不属于当前用户时抛出错误', async () => {
    resetState()
    dbState.files.push(makeUploadedFile({ accountId: 'other-user' }))

    await expect(
      createAndStartProject('acc-test', 'file-001', makeConfig(), makeDeps()),
    ).rejects.toThrow('视频文件不存在或不属于当前用户')
  })
})

// ── retryProject ──────────────────────────────────────

describe('retryProject', () => {
  it('ASR 已完成（有 sentences）→ 回到 subtitle_editing', async () => {
    resetState()

    const project = makeProject({
      sentences: [
        { id: 's1', text: '你好', beginTime: 0, endTime: 2000 },
      ],
    })
    dbState.projects.push(project)

    const result = await retryProject(project, 'acc-test', makeConfig(), makeDeps())

    expect(result.status).toBe('subtitle_editing')
    expect(result.errorMessage).toBeNull()
  })

  it('音频已提取（有 audioFileUrl）→ 只重新提交 ASR', async () => {
    resetState()

    const project = makeProject({
      audioFileUrl: 'https://cdn/audio.wav',
      videoDurationMs: 30000,
    })
    dbState.projects.push(project)

    const deps = makeDeps()
    const result = await retryProject(project, 'acc-test', makeConfig(), deps)

    expect(result.status).toBe('asr_processing')
    expect(dbState.records.length).toBeGreaterThanOrEqual(1)
    expect(dbState.records[0]!.category).toBe('subtitle')
    expect(dbState.records[0]!.model).toBe('paraformer-v2')
  })

  it('音频已提取 → ASR 成功 → 创建 generation_record', async () => {
    resetState()

    const project = makeProject({
      audioFileUrl: 'https://cdn/audio.wav',
      videoDurationMs: 30000,
    })
    dbState.projects.push(project)

    await retryProject(project, 'acc-test', makeConfig(), makeDeps())

    // 验证计费计算 — paraformer-v2 0.008 分/秒 × 30秒 = 0.24 分
    const record = dbState.records[0]
    expect(record!.cost.unit).toBe('audio')
    expect(record!.cost.duration).toBe(30)
  })

  it('音频已提取但 ASR 失败 → 项目状态为 failed', async () => {
    resetState()

    const project = makeProject({
      audioFileUrl: 'https://cdn/audio.wav',
      videoDurationMs: 30000,
    })
    dbState.projects.push(project)

    const deps = makeDeps({
      submitTranscription: async () => ({ success: false, taskId: '', error: 'ASR 内部错误' }),
    })

    const result = await retryProject(project, 'acc-test', makeConfig(), deps)

    expect(result.status).toBe('failed')
  })

  it('音频已提取但 ASR 失败 → SSE 通知', async () => {
    resetState()

    const project = makeProject({
      audioFileUrl: 'https://cdn/audio.wav',
      videoDurationMs: 30000,
    })
    dbState.projects.push(project)

    const deps = makeDeps({
      submitTranscription: async () => ({ success: false, taskId: '', error: 'ASR 连接超时' }),
    })

    await retryProject(project, 'acc-test', makeConfig(), deps)

    // ASR 失败后 updateSubtitleProjectStatus 会设置 errorMessage
    // createGenerationRecord 只在 ASR 成功时创建
    // pushNotification 会在 ASR 失败时推送 task_failed 通知
    expect(dbState.notifications).toHaveLength(1)
    expect(dbState.notifications[0]).toMatchObject({ type: 'task_failed', title: '字幕重试失败' })
    expect(dbState.records).toHaveLength(0)
  })

  it('从头开始但视频文件不存在 → 抛出错误', async () => {
    resetState()

    const project = makeProject()
    dbState.projects.push(project)

    await expect(
      retryProject(project, 'acc-test', makeConfig(), makeDeps()),
    ).rejects.toThrow('视频文件不存在或不属于当前用户')
  })

  it('从头开始但视频文件不属于当前用户 → 抛出错误', async () => {
    resetState()
    dbState.files.push(makeUploadedFile({ accountId: 'other-user' }))

    const project = makeProject()
    dbState.projects.push(project)

    await expect(
      retryProject(project, 'acc-test', makeConfig(), makeDeps()),
    ).rejects.toThrow('视频文件不存在或不属于当前用户')
  })
})
