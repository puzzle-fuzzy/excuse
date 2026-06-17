import type { GenerationNotifyPayload, OutputResult, VideoOutputResult } from '@excuse/shared'
import type { WorkerAuditEntry } from '../src/services/audit'
import type { TaskProcessorDeps } from '../src/task-processor'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { createWorkerContext } from '../src/context'
import { resetWorkerAuditWriter, setWorkerAuditWriter } from '../src/services/audit'
import { createTaskProcessor, extractVideoUrl } from '../src/task-processor'

// 可按测试重置的 listCanvasShotsByProject — 用于触发 Canvas 全部完成场景
const listCanvasShotsByProjectMock = mock(() => [])

// Mock heavy dependencies to avoid drizzle-orm isFalse import error
mock.module('@excuse/db', () => ({
  markGenerationFailed: async () => {},
  markGenerationProcessing: async () => {},
  markGenerationSucceeded: async () => {},
  notifyGenerationStatus: async () => {},
  notifyNotification: async () => {},
  debitCredit: async () => {},
  refundCredit: async () => {},
  updateCanvasProject: async () => {},
  updateCanvasShot: async () => {},
  listCanvasShotsByProject: listCanvasShotsByProjectMock,
  markCanvasAssetSucceededByTaskId: async () => null,
  markCanvasAssetFailedByTaskId: async () => null,
  setCanvasAssetActive: async () => null,
}))

mock.module('@excuse/provider', () => ({
  DashScopeClient: class {},
  AssetStorage: class {},
  ASRClient: class {},
  getModelById: () => undefined,
}))

// ─── 测试用 mock 依赖 ──────────────────────────────────

function createMockDeps(overrides: Partial<TaskProcessorDeps> = {}): TaskProcessorDeps {
  return {
    queryTask: async () => ({ status: 'UNKNOWN' }),
    downloadAndMap: async (urls: string[]) => urls,
    markGenerationFailed: async () => {},
    markGenerationSucceeded: async () => {},
    markGenerationProcessing: async () => {},
    notifyGenerationStatus: async () => {},
    notifyNotification: async () => {},
    debitCredit: async () => {},
    refundCredit: async () => {},
    ...overrides,
  }
}

function createTestProcessor(deps: Partial<TaskProcessorDeps> = {}) {
  return createTaskProcessor(
    createWorkerContext({
      dashscopeApiKey: 'test-key',
      dashscopeBaseUrl: 'https://test.api.com',
      storageRoot: '/tmp/test-uploads',
      pollIntervalMs: 5000,
      staleTimeoutMs: 1000, // 1 秒超时，方便测试
      oss: undefined,
    } as never),
    deps,
  )
}

/** 构造一条合法的待处理 record */
function createRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rec-001',
    accountId: 'acc-001',
    taskId: 'task-001',
    model: 'happyhorse-1.0-t2v',
    status: 'pending',
    category: 'video',
    createdAt: new Date(), // 刚创建，不会超时
    inputParams: { prompt: 'test', duration: 5 },
    cost: null,
    ...overrides,
  }
}

// ─── extractVideoUrl ──────────────────────────────────

describe('extractVideoUrl', () => {
  it('提取 video_url', () => {
    expect(extractVideoUrl({ video_url: 'https://cdn/video.mp4' }))
      .toBe('https://cdn/video.mp4')
  })

  it('提取首个 result url 作为回退', () => {
    expect(extractVideoUrl({ results: [{ url: 'https://cdn/result.mp4' }] }))
      .toBe('https://cdn/result.mp4')
  })

  it('video_url 优先于 results', () => {
    expect(extractVideoUrl({
      video_url: 'https://cdn/video.mp4',
      results: [{ url: 'https://cdn/other.mp4' }],
    })).toBe('https://cdn/video.mp4')
  })

  it('空 output 时返回 undefined', () => {
    expect(extractVideoUrl(undefined)).toBeUndefined()
    expect(extractVideoUrl({})).toBeUndefined()
  })
})

// ─── processTask ──────────────────────────────────────

describe('processTask', () => {
  // 每个测试前重置 listCanvasShotsByProject 默认返回空（保证 Canvas 完成检测隔离）
  beforeEach(() => {
    listCanvasShotsByProjectMock.mockImplementation(() => [])
  })

  // ── 跳过：没有 taskId ──────────────────────────────

  it('跳过没有 taskId 的记录', async () => {
    const deps = createMockDeps()
    const { processTask } = createTestProcessor(deps)
    const result = await processTask(createRecord({ taskId: null }))

    expect(result.action).toBe('skipped')
    if (result.action === 'skipped') {
      expect(result.reason).toBe('no taskId')
    }
  })

  // ── 超时 ──────────────────────────────────────────

  it('任务超时时标记为失败', async () => {
    const failed: Array<{ id: string, msg: string }> = []
    const refunds: Array<{ generationRecordId: string }> = []
    const deps = createMockDeps({
      markGenerationFailed: async (id, msg) => {
        failed.push({ id, msg })
      },
      refundCredit: async (opts) => {
        refunds.push({ generationRecordId: opts.generationRecordId })
      },
    })
    const { processTask } = createTestProcessor(deps)

    // createdAt 设为 2 秒前，超过 staleTimeoutMs=1000
    const result = await processTask(createRecord({
      createdAt: new Date(Date.now() - 2000),
      cost: { unit: 'video', totalPriceCents: 1, totalPrice: 0.01 },
    }))

    expect(result.action).toBe('completed')
    expect(failed).toHaveLength(1)
    expect(failed[0]!.id).toBe('rec-001')
    expect(failed[0]!.msg).toContain('timed out')
    expect(refunds).toEqual([{ generationRecordId: 'rec-001' }])
  })

  // ── SUCCEEDED ─────────────────────────────────────

  it('下载、计算费用并标记成功', async () => {
    const succeeded: Array<{ id: string, output: OutputResult }> = []
    const downloaded: string[][] = []
    const debits: Array<{ generationRecordId: string, actualCents: number }> = []
    const deps = createMockDeps({
      queryTask: async () => ({
        status: 'SUCCEEDED',
        output: { video_url: 'https://cdn/video.mp4' },
      }),
      downloadAndMap: async (urls, _subDir, _prefix) => {
        downloaded.push(urls)
        return ['/api/uploads/task-001/video.mp4']
      },
      markGenerationSucceeded: async (id, output, _cost) => {
        succeeded.push({ id, output })
      },
      debitCredit: async (opts) => {
        debits.push({ generationRecordId: opts.generationRecordId, actualCents: opts.actualCents })
      },
    })

    const { processTask } = createTestProcessor(deps)
    const result = await processTask(createRecord({ cost: { unit: 'video', totalPriceCents: 1, totalPrice: 0.01 } }))

    expect(result.action).toBe('completed')
    expect(downloaded).toHaveLength(1)
    expect(downloaded[0]).toEqual(['https://cdn/video.mp4'])
    expect(succeeded).toHaveLength(1)
    expect(succeeded[0]!.id).toBe('rec-001')
    // output 应包含 savedUrls 和 originalUrl
    const output = succeeded[0]!.output as VideoOutputResult
    expect(output.savedUrls).toEqual(['/api/uploads/task-001/video.mp4'])
    expect(output.originalUrl).toBe('https://cdn/video.mp4')
    expect(debits).toEqual([{ generationRecordId: 'rec-001', actualCents: 1 }])
  })

  it('处理 SUCCEEDED 但无视频 URL 的情况', async () => {
    const succeeded: Array<{ id: string }> = []
    const deps = createMockDeps({
      queryTask: async () => ({
        status: 'SUCCEEDED',
        output: {},
      }),
      downloadAndMap: async urls => urls,
      markGenerationSucceeded: async (id, _output, _cost) => {
        succeeded.push({ id })
      },
    })

    const { processTask } = createTestProcessor(deps)
    const result = await processTask(createRecord())

    expect(result.action).toBe('completed')
    expect(succeeded).toHaveLength(1)
  })

  // ── FAILED ────────────────────────────────────────

  it('用错误信息标记为失败', async () => {
    const failed: Array<{ id: string, msg: string }> = []
    const refunds: Array<{ generationRecordId: string }> = []
    const deps = createMockDeps({
      queryTask: async () => ({
        status: 'FAILED',
        errorMessage: 'Model internal error',
      }),
      markGenerationFailed: async (id, msg) => {
        failed.push({ id, msg })
      },
      refundCredit: async (opts) => {
        refunds.push({ generationRecordId: opts.generationRecordId })
      },
    })

    const { processTask } = createTestProcessor(deps)
    const result = await processTask(createRecord({ cost: { unit: 'video', totalPriceCents: 1, totalPrice: 0.01 } }))

    expect(result.action).toBe('completed')
    expect(failed).toHaveLength(1)
    expect(failed[0]!.msg).toBe('Model internal error')
    expect(refunds).toEqual([{ generationRecordId: 'rec-001' }])
  })

  it('缺少错误信息时使用默认错误信息', async () => {
    const failed: Array<{ id: string, msg: string }> = []
    const deps = createMockDeps({
      queryTask: async () => ({
        status: 'FAILED',
      }),
      markGenerationFailed: async (id, msg) => {
        failed.push({ id, msg })
      },
    })

    const { processTask } = createTestProcessor(deps)
    await processTask(createRecord())

    expect(failed[0]!.msg).toBe('DashScope task failed')
  })

  // ── PENDING / RUNNING ─────────────────────────────

  it('记录为 pending 且任务为 PENDING 时标记为 processing', async () => {
    const processingCalls: string[] = []
    const deps = createMockDeps({
      queryTask: async () => ({ status: 'PENDING' }),
      markGenerationProcessing: async (id) => {
        processingCalls.push(id)
      },
    })

    const { processTask } = createTestProcessor(deps)
    const result = await processTask(createRecord({ status: 'pending' }))

    expect(result.action).toBe('skipped')
    expect(processingCalls).toEqual(['rec-001'])
  })

  it('记录已为 processing 时不调用 markProcessing', async () => {
    const processingCalls: string[] = []
    const deps = createMockDeps({
      queryTask: async () => ({ status: 'RUNNING' }),
      markGenerationProcessing: async (id) => {
        processingCalls.push(id)
      },
    })

    const { processTask } = createTestProcessor(deps)
    const result = await processTask(createRecord({ status: 'processing' }))

    expect(result.action).toBe('skipped')
    expect(processingCalls).toHaveLength(0) // 不应该调用
  })

  // ── 未知状态 ──────────────────────────────────────

  it('未知状态返回 ignored', async () => {
    const deps = createMockDeps({
      queryTask: async () => ({ status: 'CANCELLING' }),
    })

    const { processTask } = createTestProcessor(deps)
    const result = await processTask(createRecord())

    expect(result.action).toBe('ignored')
    if (result.action === 'ignored') {
      expect(result.status).toBe('CANCELLING')
    }
  })

  // ── Canvas pipeline: canvasMeta propagation ────────

  it('canvas 来源记录成功时在通知中传递 canvasMeta', async () => {
    const notifications: Array<GenerationNotifyPayload> = []
    const deps = createMockDeps({
      queryTask: async () => ({
        status: 'SUCCEEDED',
        output: { video_url: 'https://cdn/video.mp4' },
      }),
      downloadAndMap: async urls => urls,
      markGenerationSucceeded: async () => {},
      notifyGenerationStatus: async (payload) => {
        notifications.push(payload)
      },
    })

    const { processTask } = createTestProcessor(deps)
    await processTask(createRecord({
      inputParams: {
        source: 'canvas',
        projectId: 'proj-123',
        shotId: 'shot-456',
        prompt: 'test',
        duration: 5,
      },
    }))

    expect(notifications).toHaveLength(1)
    expect(notifications[0]!.canvasMeta).toEqual({
      projectId: 'proj-123',
      shotId: 'shot-456',
    })
  })

  it('canvas 来源记录失败时在通知中传递 canvasMeta', async () => {
    const notifications: Array<GenerationNotifyPayload> = []
    const deps = createMockDeps({
      queryTask: async () => ({
        status: 'FAILED',
        errorMessage: 'Model error',
      }),
      markGenerationFailed: async () => {},
      notifyGenerationStatus: async (payload) => {
        notifications.push(payload)
      },
    })

    const { processTask } = createTestProcessor(deps)
    await processTask(createRecord({
      inputParams: {
        source: 'canvas',
        projectId: 'proj-789',
        shotId: 'shot-012',
        prompt: 'test',
        duration: 5,
      },
    }))

    expect(notifications).toHaveLength(1)
    expect(notifications[0]!.canvasMeta).toEqual({
      projectId: 'proj-789',
      shotId: 'shot-012',
    })
  })

  it('非 canvas 来源记录不包含 canvasMeta', async () => {
    const notifications: Array<GenerationNotifyPayload> = []
    const deps = createMockDeps({
      queryTask: async () => ({
        status: 'SUCCEEDED',
        output: { video_url: 'https://cdn/video.mp4' },
      }),
      downloadAndMap: async urls => urls,
      markGenerationSucceeded: async () => {},
      notifyGenerationStatus: async (payload) => {
        notifications.push(payload)
      },
    })

    const { processTask } = createTestProcessor(deps)
    await processTask(createRecord({
      inputParams: { prompt: 'test', duration: 5 },
    }))

    expect(notifications).toHaveLength(1)
    expect(notifications[0]!.canvasMeta).toBeUndefined()
  })

  // ── 异常处理：queryTask 抛出异常 ────────────────────

  it('queryTask 抛出异常时向上传播错误', async () => {
    const deps = createMockDeps({
      queryTask: async () => { throw new Error('Network timeout') },
    })

    const { processTask } = createTestProcessor(deps)

    // queryTask 异常应该向上传播，由轮询循环捕获
    await expect(processTask(createRecord())).rejects.toThrow('Network timeout')
  })

  // ── 异常处理：downloadAndMap 抛出异常 ──────────────

  it('SUCCEEDED 时 downloadAndMap 抛出异常向上传播', async () => {
    const deps = createMockDeps({
      queryTask: async () => ({
        status: 'SUCCEEDED',
        output: { video_url: 'https://cdn/video.mp4' },
      }),
      downloadAndMap: async () => { throw new Error('Disk full') },
    })

    const { processTask } = createTestProcessor(deps)

    // downloadAndMap 异常应向上传播
    await expect(processTask(createRecord())).rejects.toThrow('Disk full')
  })

  // ── 异常处理：markGenerationFailed 抛出异常 ────────

  it('markGenerationFailed 抛出异常时向上传播', async () => {
    const deps = createMockDeps({
      queryTask: async () => ({
        status: 'FAILED',
        errorMessage: 'Model error',
      }),
      markGenerationFailed: async () => { throw new Error('DB connection lost') },
    })

    const { processTask } = createTestProcessor(deps)

    await expect(processTask(createRecord())).rejects.toThrow('DB connection lost')
  })

  // ── RUNNING + stale 记录也应超时 ──────────────────

  it('RUNNING 任务超时时标记为失败', async () => {
    const failed: Array<{ id: string, msg: string }> = []
    const deps = createMockDeps({
      markGenerationFailed: async (id, msg) => {
        failed.push({ id, msg })
      },
    })
    const { processTask } = createTestProcessor(deps)

    const result = await processTask(createRecord({
      status: 'processing',
      createdAt: new Date(Date.now() - 2000), // 超过 staleTimeoutMs=1000
    }))

    expect(result.action).toBe('completed')
    expect(failed).toHaveLength(1)
    expect(failed[0]!.msg).toContain('timed out')
  })

  // ── extractVideoDuration ──────────────────────────

  it('从 output 中提取视频时长', async () => {
    const succeeded: Array<{ id: string, output: OutputResult }> = []
    const deps = createMockDeps({
      queryTask: async () => ({
        status: 'SUCCEEDED',
        output: { video_url: 'https://cdn/video.mp4', video_duration: 8 },
      }),
      downloadAndMap: async urls => urls,
      markGenerationSucceeded: async (id, output) => {
        succeeded.push({ id, output })
      },
    })

    const { processTask } = createTestProcessor(deps)
    await processTask(createRecord({ inputParams: { prompt: 'test', duration: 5 } }))

    expect(succeeded).toHaveLength(1)
  })

  // ── P2-2 通知触发器 ──────────────────────────────────

  it('SUCCEEDED 时推送 task_completed 通知（P2-2）', async () => {
    const notifications: Array<{ type: string, meta?: { recordId?: string, category?: string } }> = []
    const deps = createMockDeps({
      queryTask: async () => ({
        status: 'SUCCEEDED',
        output: { video_url: 'https://cdn/video.mp4' },
      }),
      downloadAndMap: async urls => urls,
      markGenerationSucceeded: async () => {},
      notifyNotification: async (opts) => {
        notifications.push({ type: opts.type, meta: opts.meta })
      },
    })

    const { processTask } = createTestProcessor(deps)
    await processTask(createRecord())

    const completed = notifications.find(n => n.type === 'task_completed')
    expect(completed).toBeDefined()
    expect(completed!.meta?.recordId).toBe('rec-001')
    expect(completed!.meta?.category).toBe('video')
  })

  it('FAILED 时推送 task_failed 通知（P2-2）', async () => {
    const notifications: Array<{ type: string, body?: string }> = []
    const deps = createMockDeps({
      queryTask: async () => ({ status: 'FAILED', errorMessage: 'Model error' }),
      markGenerationFailed: async () => {},
      notifyNotification: async opts => notifications.push({ type: opts.type, body: opts.body }),
    })

    const { processTask } = createTestProcessor(deps)
    await processTask(createRecord())

    expect(notifications).toContainEqual({ type: 'task_failed', body: 'Model error' })
  })

  it('项目所有镜头完成时推送 canvas_completed（P2-2）', async () => {
    // 模拟该 shot 完成后，项目所有镜头均已完成 → projectStatus='completed'
    listCanvasShotsByProjectMock.mockImplementation(() => [
      { status: 'completed' },
      { status: 'completed' },
    ])

    const notifications: Array<{ type: string, meta?: { projectId?: string } }> = []
    const deps = createMockDeps({
      queryTask: async () => ({
        status: 'SUCCEEDED',
        output: { video_url: 'https://cdn/video.mp4' },
      }),
      downloadAndMap: async urls => urls,
      markGenerationSucceeded: async () => {},
      markCanvasAssetSucceededByTaskId: async () => ({ id: 'asset-1' }),
      setCanvasAssetActive: async () => null,
      notifyNotification: async (opts) => {
        notifications.push({ type: opts.type, meta: opts.meta })
      },
    })

    const { processTask } = createTestProcessor(deps)
    await processTask(createRecord({
      inputParams: {
        source: 'canvas',
        projectId: 'proj-999',
        shotId: 'shot-1',
        prompt: 'test',
        duration: 5,
      },
    }))

    const canvasDone = notifications.find(n => n.type === 'canvas_completed')
    expect(canvasDone).toBeDefined()
    expect(canvasDone!.meta?.projectId).toBe('proj-999')
  })
})

// ── P2-2 第二条：通知 meta 携带 projectId + shotId（Canvas 链路） ──

describe('notifyUser meta payload', () => {
  interface CapturedNotification {
    type: string
    meta?: Record<string, unknown>
  }

  function createCanvasRecord(overrides: Record<string, unknown> = {}) {
    return createRecord({
      inputParams: {
        source: 'canvas',
        projectId: 'proj-canvas-1',
        shotId: 'shot-canvas-1',
        prompt: 'test',
        duration: 5,
      },
      ...overrides,
    })
  }

  it('task_completed + canvas 链路 meta 含 projectId + shotId', async () => {
    const notifications: CapturedNotification[] = []
    const deps = createMockDeps({
      queryTask: async () => ({
        status: 'SUCCEEDED',
        output: { video_url: 'https://cdn/video.mp4' },
      }),
      downloadAndMap: async urls => urls,
      markGenerationSucceeded: async () => {},
      notifyNotification: async opts =>
        notifications.push({ type: opts.type, meta: opts.meta as Record<string, unknown> | undefined }),
    })

    const { processTask } = createTestProcessor(deps)
    await processTask(createCanvasRecord())

    const completed = notifications.find(n => n.type === 'task_completed')
    expect(completed).toBeDefined()
    expect(completed!.meta).toMatchObject({
      recordId: 'rec-001',
      category: 'video',
      projectId: 'proj-canvas-1',
      shotId: 'shot-canvas-1',
    })
  })

  it('task_completed + 非 canvas 链路 meta 仅含 recordId + category', async () => {
    const notifications: CapturedNotification[] = []
    const deps = createMockDeps({
      queryTask: async () => ({
        status: 'SUCCEEDED',
        output: { video_url: 'https://cdn/video.mp4' },
      }),
      downloadAndMap: async urls => urls,
      markGenerationSucceeded: async () => {},
      notifyNotification: async opts =>
        notifications.push({ type: opts.type, meta: opts.meta as Record<string, unknown> | undefined }),
    })

    const { processTask } = createTestProcessor(deps)
    await processTask(createRecord({ inputParams: { source: 'workspace', prompt: 'test', duration: 5 } }))

    const completed = notifications.find(n => n.type === 'task_completed')
    expect(completed).toBeDefined()
    expect(completed!.meta).toEqual({ recordId: 'rec-001', category: 'video' })
  })

  it('task_failed + canvas 链路 meta 含 projectId + shotId', async () => {
    const notifications: CapturedNotification[] = []
    const deps = createMockDeps({
      queryTask: async () => ({ status: 'FAILED', errorMessage: 'Model error' }),
      markGenerationFailed: async () => {},
      notifyNotification: async opts =>
        notifications.push({ type: opts.type, meta: opts.meta as Record<string, unknown> | undefined }),
    })

    const { processTask } = createTestProcessor(deps)
    await processTask(createCanvasRecord())

    const failed = notifications.find(n => n.type === 'task_failed')
    expect(failed).toBeDefined()
    expect(failed!.meta).toMatchObject({
      recordId: 'rec-001',
      category: 'video',
      projectId: 'proj-canvas-1',
      shotId: 'shot-canvas-1',
    })
  })

  it('task_failed 超时 + canvas 链路 meta 含 projectId + shotId', async () => {
    const notifications: CapturedNotification[] = []
    const deps = createMockDeps({
      queryTask: async () => ({ status: 'RUNNING' }),
      markGenerationFailed: async () => {},
      notifyNotification: async opts =>
        notifications.push({ type: opts.type, meta: opts.meta as Record<string, unknown> | undefined }),
    })

    const { processTask } = createTestProcessor(deps)
    // staleTimeoutMs=1000，构造 5s 前的 createdAt 触发超时分支
    await processTask(createCanvasRecord({ createdAt: new Date(Date.now() - 5000) }))

    const timeoutFailed = notifications.find(n => n.type === 'task_failed')
    expect(timeoutFailed).toBeDefined()
    expect(timeoutFailed!.meta).toMatchObject({
      recordId: 'rec-001',
      category: 'video',
      projectId: 'proj-canvas-1',
      shotId: 'shot-canvas-1',
    })
  })
})

// ── P2.3 第二条：worker 资金类操作审计 ──

describe('credit audit', () => {
  let auditCalls: WorkerAuditEntry[]
  let auditWriter: ReturnType<typeof mock<(entry: WorkerAuditEntry) => Promise<void>>>

  beforeEach(() => {
    auditCalls = []
    auditWriter = mock<(entry: WorkerAuditEntry) => Promise<void>>((entry) => {
      auditCalls.push(entry)
      return Promise.resolve()
    })
    setWorkerAuditWriter(auditWriter)
  })

  afterEach(() => {
    resetWorkerAuditWriter()
  })

  it('成功路径：actualCost.totalPriceCents > 0 → debit + audit credit_debit (source=worker_video)', async () => {
    const deps = createMockDeps({
      queryTask: async () => ({
        status: 'SUCCEEDED',
        output: { video_url: 'https://cdn/video.mp4' },
      }),
      downloadAndMap: async urls => urls,
      markGenerationSucceeded: async () => {},
    })

    const { processTask } = createTestProcessor(deps)
    await processTask(createRecord({
      cost: { unit: 'video', totalPriceCents: 150, totalPrice: 1.5 },
    }))

    const debitAudit = auditCalls.find(a => a.action === 'credit_debit')
    expect(debitAudit).toBeDefined()
    expect(debitAudit!.accountId).toBe('acc-001')
    expect(debitAudit!.targetId).toBe('rec-001')
    expect(debitAudit!.detail).toMatchObject({
      accountId: 'acc-001',
      generationRecordId: 'rec-001',
      amountCents: 150,
      description: '视频生成成功扣款：happyhorse-1.0-t2v',
      source: 'worker_video',
    })
  })

  it('失败路径：record.cost.totalPriceCents > 0 → refund + audit credit_refund', async () => {
    const deps = createMockDeps({
      queryTask: async () => ({ status: 'FAILED', errorMessage: 'Provider error' }),
      markGenerationFailed: async () => {},
    })

    const { processTask } = createTestProcessor(deps)
    await processTask(createRecord({
      cost: { unit: 'video', totalPriceCents: 200, totalPrice: 2 },
    }))

    const refundAudit = auditCalls.find(a => a.action === 'credit_refund')
    expect(refundAudit).toBeDefined()
    expect(refundAudit!.detail).toMatchObject({
      amountCents: 200,
      description: '视频生成失败退款：happyhorse-1.0-t2v',
      source: 'worker_video',
    })
  })

  it('超时路径：createdAt 早于 staleTimeoutMs → refund + audit credit_refund (description 含超时)', async () => {
    const deps = createMockDeps({
      queryTask: async () => ({ status: 'RUNNING' }),
      markGenerationFailed: async () => {},
    })

    const { processTask } = createTestProcessor(deps)
    await processTask(createRecord({
      createdAt: new Date(Date.now() - 5000),
      cost: { unit: 'video', totalPriceCents: 80, totalPrice: 0.8 },
    }))

    const refundAudit = auditCalls.find(a => a.action === 'credit_refund')
    expect(refundAudit).toBeDefined()
    expect(refundAudit!.detail).toMatchObject({
      amountCents: 80,
      description: '视频任务超时退款',
      source: 'worker_video',
    })
  })

  it('成功路径：actualCost.totalPriceCents === 0 → debit 不调用，audit credit_debit 也不调用', async () => {
    const deps = createMockDeps({
      queryTask: async () => ({
        status: 'SUCCEEDED',
        output: { video_url: 'https://cdn/video.mp4' },
      }),
      downloadAndMap: async urls => urls,
      markGenerationSucceeded: async () => {},
    })

    const { processTask } = createTestProcessor(deps)
    await processTask(createRecord({
      cost: { unit: 'video', totalPriceCents: 0, totalPrice: 0 },
    }))

    const debitAudit = auditCalls.find(a => a.action === 'credit_debit')
    expect(debitAudit).toBeUndefined()
  })

  it('失败路径：record.cost.totalPriceCents === 0 → refund 不调用，audit credit_refund 也不调用', async () => {
    const deps = createMockDeps({
      queryTask: async () => ({ status: 'FAILED', errorMessage: 'Provider error' }),
      markGenerationFailed: async () => {},
    })

    const { processTask } = createTestProcessor(deps)
    await processTask(createRecord({
      cost: { unit: 'video', totalPriceCents: 0, totalPrice: 0 },
    }))

    const refundAudit = auditCalls.find(a => a.action === 'credit_refund')
    expect(refundAudit).toBeUndefined()
  })

  it('audit writer 抛错 → 业务流程不中断，debit/refund 仍正常完成', async () => {
    const throwingWriter = mock<(entry: WorkerAuditEntry) => Promise<void>>(() =>
      Promise.reject(new Error('audit DB down')),
    )
    setWorkerAuditWriter(throwingWriter)

    const debits: Array<{ generationRecordId: string, actualCents: number }> = []
    const deps = createMockDeps({
      queryTask: async () => ({
        status: 'SUCCEEDED',
        output: { video_url: 'https://cdn/video.mp4' },
      }),
      downloadAndMap: async urls => urls,
      markGenerationSucceeded: async () => {},
      debitCredit: async opts => debits.push({ generationRecordId: opts.generationRecordId, actualCents: opts.actualCents }),
    })

    const { processTask } = createTestProcessor(deps)
    // 不应抛错
    const result = await processTask(createRecord({
      cost: { unit: 'video', totalPriceCents: 100, totalPrice: 1 },
    }))

    expect(result.action).toBe('completed')
    // debit 已正常执行（audit 抛错被 .catch + audit 内部 try/catch 双层吞掉）
    expect(debits).toHaveLength(1)
    expect(debits[0]!.actualCents).toBe(100)
  })
})
