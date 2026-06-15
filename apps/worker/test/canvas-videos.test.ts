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

const mockCreateDashScopeClient = mock(() => ({ submitVideoTaskWithFallback: mock(async () => ({ success: true, taskId: 'provider-task-1', model: 'wanx2.1-t2v' })) }))
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

mock.module('../src/canvas-execution', () => ({
  createDashScopeClient: mockCreateDashScopeClient,
  getVideoModel: mockGetVideoModel,
  loadRunnableCanvasProject: mockLoadRunnableCanvasProject,
}))

const { executeCanvasVideos } = await import('../src/canvas-videos')

const workerConfig = {
  dashscopeApiKey: 'test-key',
  dashscopeBaseUrl: 'https://example.com',
  storageRoot: './uploads',
  pollIntervalMs: 1000,
  staleTimeoutMs: 1000,
  claimTtlMs: 1000,
  sweepIntervalMs: 1000,
  oss: undefined,
  metricsAccessToken: undefined,
  metricsAllowedCidrs: ['127.0.0.1/32'],
}

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
    mockCreateDashScopeClient.mockClear()
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

    const result = await executeCanvasVideos('project-1', workerConfig, 'run-1', 'worker-task-1')

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

    const result = await executeCanvasVideos('project-1', workerConfig, 'run-1', 'worker-task-1')

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
    const result = await executeCanvasVideos('project-1', workerConfig, 'run-1', 'worker-task-1')

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
