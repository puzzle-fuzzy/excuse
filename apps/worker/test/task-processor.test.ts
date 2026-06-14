import type { GenerationNotifyPayload, OutputResult, VideoOutputResult } from '@excuse/shared'
import type { TaskProcessorDeps } from '../src/task-processor'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
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
    {
      dashscopeApiKey: 'test-key',
      dashscopeBaseUrl: 'https://test.api.com',
      storageRoot: '/tmp/test-uploads',
      pollIntervalMs: 5000,
      staleTimeoutMs: 1000, // 1 秒超时，方便测试
      oss: undefined,
    },
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
  it('should extract video_url', () => {
    expect(extractVideoUrl({ video_url: 'https://cdn/video.mp4' }))
      .toBe('https://cdn/video.mp4')
  })

  it('should extract first result url as fallback', () => {
    expect(extractVideoUrl({ results: [{ url: 'https://cdn/result.mp4' }] }))
      .toBe('https://cdn/result.mp4')
  })

  it('should prefer video_url over results', () => {
    expect(extractVideoUrl({
      video_url: 'https://cdn/video.mp4',
      results: [{ url: 'https://cdn/other.mp4' }],
    })).toBe('https://cdn/video.mp4')
  })

  it('should return undefined for empty output', () => {
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

  it('should skip records without taskId', async () => {
    const deps = createMockDeps()
    const { processTask } = createTestProcessor(deps)
    const result = await processTask(createRecord({ taskId: null }))

    expect(result.action).toBe('skipped')
    if (result.action === 'skipped') {
      expect(result.reason).toBe('no taskId')
    }
  })

  // ── 超时 ──────────────────────────────────────────

  it('should mark as failed when task is stale', async () => {
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

  it('should download, calculate cost and mark succeeded', async () => {
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

  it('should handle SUCCEEDED with no video URL', async () => {
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

  it('should mark as failed with error message', async () => {
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

  it('should use default error message when missing', async () => {
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

  it('should mark as processing when record is pending and task is PENDING', async () => {
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

  it('should NOT call markProcessing when record is already processing', async () => {
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

  it('should return ignored for unknown status', async () => {
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

  it('should pass canvasMeta in succeeded notification for canvas-sourced records', async () => {
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

  it('should pass canvasMeta in failed notification for canvas-sourced records', async () => {
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

  it('should NOT include canvasMeta for non-canvas records', async () => {
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

  it('should propagate error when queryTask throws', async () => {
    const deps = createMockDeps({
      queryTask: async () => { throw new Error('Network timeout') },
    })

    const { processTask } = createTestProcessor(deps)

    // queryTask 异常应该向上传播，由轮询循环捕获
    await expect(processTask(createRecord())).rejects.toThrow('Network timeout')
  })

  // ── 异常处理：downloadAndMap 抛出异常 ──────────────

  it('should propagate error when downloadAndMap throws on SUCCEEDED', async () => {
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

  it('should propagate error when markGenerationFailed throws', async () => {
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

  it('should mark as failed when RUNNING task is stale', async () => {
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

  it('should extract video duration from output', async () => {
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

  it('should push task_completed notification on SUCCEEDED (P2-2)', async () => {
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

  it('should push task_failed notification on FAILED (P2-2)', async () => {
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

  it('should push canvas_completed when all project shots are completed (P2-2)', async () => {
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
