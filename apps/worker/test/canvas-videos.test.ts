import { beforeEach, describe, expect, it, mock } from 'bun:test'

const mockSubmitShotVideoEntity = mock(async () => ({ taskId: 'provider-task-1', model: 'wanx2.1-t2v', referenceUrls: [], recommendationReason: '默认模型' }))

const mockCreateCanvasAsset = mock(async () => ({
  id: 'asset-new',
  status: 'queued',
  taskId: null,
}))
const mockFindReusableCanvasAssetForPipelineTarget = mock(async () => null)
const mockMarkCanvasAssetFailed = mock(async () => undefined)
const mockMarkCanvasAssetRunning = mock(async () => undefined)
const mockNotifyNotification = mock(async () => undefined)
const mockUpdateCanvasProject = mock(async () => undefined)
const mockUpdateCanvasShot = mock(async () => undefined)

const mockClient = { submitVideoTaskWithFallback: mock(async () => ({ success: true, taskId: 'provider-task-1', model: 'wanx2.1-t2v' })) }
const mockGetVideoModel = mock(() => 'wanx2.1-t2v')
const mockLoadRunnableCanvasProject = mock(async () => ({
  project: {
    id: 'project-1',
    accountId: 'account-1',
    modelPreferencesJson: null,
  },
  shots: [
    {
      id: 'shot-1',
      duration: 5,
      videoPrompt: '镜头提示词',
      negativePrompt: null,
      videoTaskId: null,
    },
  ],
  characters: [],
  locations: [],
}))

mock.module('@excuse/canvas-runtime', () => ({
  submitShotVideoEntity: mockSubmitShotVideoEntity,
}))

mock.module('@excuse/db', () => ({
  createCanvasAsset: mockCreateCanvasAsset,
  findReusableCanvasAssetForPipelineTarget: mockFindReusableCanvasAssetForPipelineTarget,
  markCanvasAssetFailed: mockMarkCanvasAssetFailed,
  markCanvasAssetRunning: mockMarkCanvasAssetRunning,
  notifyNotification: mockNotifyNotification,
  updateCanvasProject: mockUpdateCanvasProject,
  updateCanvasShot: mockUpdateCanvasShot,
}))

// Mock canvas-adapter-factory to avoid importing ALL DB functions at module level
const fakeRepo = {
  getCanvasProjectById: mock(async () => null),
  getCanvasProjectDetail: mock(async () => null),
  updateCanvasProject: mockUpdateCanvasProject,
  createCanvasCharacter: mock(async () => ({ id: 'char-1' })),
  updateCanvasCharacter: mock(async () => undefined),
  deleteCanvasCharactersByProject: mock(async () => undefined),
  createCanvasLocation: mock(async () => ({ id: 'loc-1' })),
  updateCanvasLocation: mock(async () => undefined),
  deleteCanvasLocationsByProject: mock(async () => undefined),
  batchCreateCanvasShots: mock(async () => []),
  deleteCanvasShotsByProject: mock(async () => undefined),
  updateCanvasShot: mockUpdateCanvasShot,
  createContinuityReport: mock(async () => undefined),
  createCanvasAsset: mockCreateCanvasAsset,
  markCanvasAssetRunning: mockMarkCanvasAssetRunning,
  markCanvasAssetSucceeded: mock(async () => undefined),
  markCanvasAssetFailed: mockMarkCanvasAssetFailed,
  setCanvasAssetActive: mock(async () => undefined),
  bindCanvasAssetTaskId: mock(async () => undefined),
  createGenerationRecord: mock(async () => undefined),
}
const fakeProvider = {
  getModelById: mock(() => ({ id: 'test-model', name: 'Test', category: 'text' as const, type: 'generation' as const, description: '', endpoint: '', async: false, pricing: { inputPriceCents: 0, outputPriceCents: 0, unit: 'token' as const }, parameters: [] })),
  validateAndMerge: mock((_config, params) => ({ ok: true, params: params as Record<string, unknown> & { readonly __brand: true } })),
}
mock.module('../src/canvas-adapter-factory', () => ({
  createWorkerRepoAdapter: () => fakeRepo,
  createWorkerProviderAdapter: () => fakeProvider,
  createWorkerFfmpegAdapter: () => ({ concatVideos: mock(async () => ({ outputPath: '/tmp/out.mp4' })), mixBgmTrack: mock(async () => ({ outputPath: '/tmp/mixed.mp4' })) }),
  createWorkerCanvasAdapters: () => ({ repo: fakeRepo, provider: fakeProvider, ffmpeg: { concatVideos: mock(async () => ({ outputPath: '/tmp/out.mp4' })), mixBgmTrack: mock(async () => ({ outputPath: '/tmp/mixed.mp4' })) }, storage: {} }),
}))

mock.module('../src/canvas-execution', () => ({
  getVideoModel: mockGetVideoModel,
  loadRunnableCanvasProject: mockLoadRunnableCanvasProject,
}))

const { executeCanvasVideos } = await import('../src/canvas-videos')

describe('executeCanvasVideos 幂等提交', () => {
  beforeEach(() => {
    mockSubmitShotVideoEntity.mockClear()
    mockCreateCanvasAsset.mockClear()
    mockFindReusableCanvasAssetForPipelineTarget.mockClear()
    mockMarkCanvasAssetFailed.mockClear()
    mockMarkCanvasAssetRunning.mockClear()
    mockNotifyNotification.mockClear()
    mockUpdateCanvasProject.mockClear()
    mockUpdateCanvasShot.mockClear()
    mockClient.submitVideoTaskWithFallback.mockClear()
    mockGetVideoModel.mockClear()
    mockLoadRunnableCanvasProject.mockClear()
    mockFindReusableCanvasAssetForPipelineTarget.mockResolvedValue(null)
    mockCreateCanvasAsset.mockResolvedValue({ id: 'asset-new', status: 'queued', taskId: null })
  })

  it('同一 pipeline run 已有绑定 provider task 的 asset 时不重复提交', async () => {
    mockFindReusableCanvasAssetForPipelineTarget.mockResolvedValueOnce({
      id: 'asset-existing',
      status: 'running',
      taskId: 'provider-task-existing',
    })

    const result = await executeCanvasVideos('project-1', mockClient, 'run-1', 'worker-task-1')

    expect(result.shotsSubmitted).toBe(1)
    expect(mockCreateCanvasAsset).not.toHaveBeenCalled()
    expect(mockMarkCanvasAssetRunning).not.toHaveBeenCalled()
    expect(mockSubmitShotVideoEntity).not.toHaveBeenCalled()
    expect(mockFindReusableCanvasAssetForPipelineTarget).toHaveBeenCalledWith({
      pipelineRunId: 'run-1',
      targetEntityType: 'shot',
      targetEntityId: 'shot-1',
      category: 'shotVideo',
    })
  })

  it('同一 pipeline run 已有 queued asset 时复用该 asset 继续提交', async () => {
    mockFindReusableCanvasAssetForPipelineTarget.mockResolvedValueOnce({
      id: 'asset-existing',
      status: 'queued',
      taskId: null,
    })

    const result = await executeCanvasVideos('project-1', mockClient, 'run-1', 'worker-task-1')

    expect(result.shotsSubmitted).toBe(1)
    expect(mockCreateCanvasAsset).not.toHaveBeenCalled()
    expect(mockMarkCanvasAssetRunning).toHaveBeenCalledWith('asset-existing')
    expect(mockSubmitShotVideoEntity).toHaveBeenCalledWith(expect.objectContaining({
      assetId: 'asset-existing',
      diagnostics: {
        workerTaskId: 'worker-task-1',
        pipelineRunId: 'run-1',
        canvasAssetId: 'asset-existing',
      },
    }))
  })

  it('没有可复用 asset 时创建新 asset 再提交', async () => {
    const result = await executeCanvasVideos('project-1', mockClient, 'run-1', 'worker-task-1')

    expect(result.shotsSubmitted).toBe(1)
    expect(mockCreateCanvasAsset).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'account-1',
      projectId: 'project-1',
      category: 'shotVideo',
      targetEntityType: 'shot',
      targetEntityId: 'shot-1',
      pipelineRunId: 'run-1',
    }))
    expect(mockSubmitShotVideoEntity).toHaveBeenCalledWith(expect.objectContaining({
      assetId: 'asset-new',
    }))
  })
})
