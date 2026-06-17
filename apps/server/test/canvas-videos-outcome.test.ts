/**
 * generateVideos 批量提交结果分类测试
 *
 * 锁定 videos.ts 把本次提交结果经 decideBatchOutcome 分类后的项目状态映射：
 *   - 全部提交成功 / 部分成功 → status 'generating'，pipeline run succeeded
 *   - 全部提交失败 / 没有任何 shot 带 prompt → status 'prompts_ready'，pipeline run failed
 *
 * 这是“本轮接入 batch outcome 不改变视频阶段既有语义”的回归保护。
 * 视频最终 completed/partial_failed 由 worker 轮询后判定，不在本测试范围。
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test'

// ===== Mock 设置（必须在 videos import 之前） =====

const mockGetCanvasProjectDetail = mock<(id: string) => Promise<any>>(async () => null)
const mockUpdateCanvasProject = mock<(id: string, patch: any) => Promise<any>>(async () => null)
const mockMarkPipelineRunRunning = mock<(runId: string) => Promise<any>>(async () => null)
const mockMarkPipelineRunSucceeded = mock<(runId: string, meta?: any) => Promise<any>>(async () => null)
const mockMarkPipelineRunFailed = mock<(runId: string, message: string) => Promise<any>>(async () => null)
const mockCreateCanvasAsset = mock<(values: any) => Promise<any>>(async () => ({ id: 'asset-1' }))
const mockMarkCanvasAssetRunning = mock<(id: string) => Promise<any>>(async () => null)
const mockMarkCanvasAssetFailed = mock<(id: string, message: string) => Promise<any>>(async () => null)
const mockUpdateCanvasShot = mock<(id: string, patch: any) => Promise<any>>(async () => null)

// 本次提交成败的控制点
const mockSubmitShotVideoEntity = mock<(args: any) => Promise<void>>(async () => {})

mock.module('@excuse/canvas-runtime', () => ({
  submitShotVideoEntity: mockSubmitShotVideoEntity,
  submitCanvasShotVideo: async () => {},
  getCanvasVideoModel: () => 'video-model',
}))

mock.module('@excuse/db', () => ({
  getCanvasProjectDetail: mockGetCanvasProjectDetail,
  updateCanvasProject: mockUpdateCanvasProject,
  markPipelineRunRunning: mockMarkPipelineRunRunning,
  markPipelineRunSucceeded: mockMarkPipelineRunSucceeded,
  markPipelineRunFailed: mockMarkPipelineRunFailed,
  createCanvasAsset: mockCreateCanvasAsset,
  markCanvasAssetRunning: mockMarkCanvasAssetRunning,
  markCanvasAssetFailed: mockMarkCanvasAssetFailed,
  updateCanvasShot: mockUpdateCanvasShot,
  getCanvasShotById: async () => null,
  resetCanvasShotToDraft: async () => null,
}))

mock.module('../src/modules/canvas/service-helpers', () => ({
  getVideoModel: () => 'video-model',
  notifyNode: () => {},
}))

mock.module('../src/modules/canvas/service-crud', () => ({
  getProjectDetail: async () => ({ project: { id: 'proj-1', status: 'generating' }, characters: [], locations: [], shots: [] }),
}))

// eslint-disable-next-line import/first
import { generateVideos } from '../src/modules/canvas/videos'

const mockClient = { chatCompletion: async () => ({ success: true, output: { text: 'mock' } }) } as any

function makeShot(id: string, videoPrompt?: string) {
  return { id, videoPrompt }
}

function makeDetail(shots: any[]) {
  return {
    project: { accountId: 'acc-1', modelPreferencesJson: {} },
    shots,
    characters: [],
    locations: [],
    latestContinuity: null,
  }
}

function lastProjectStatus(): string | undefined {
  const calls = mockUpdateCanvasProject.mock.calls
  if (calls.length === 0)
    return undefined
  return calls[calls.length - 1]![1]?.status
}

describe('generateVideos batch outcome', () => {
  beforeEach(() => {
    mockGetCanvasProjectDetail.mockClear()
    mockUpdateCanvasProject.mockClear()
    mockMarkPipelineRunRunning.mockClear()
    mockMarkPipelineRunSucceeded.mockClear()
    mockMarkPipelineRunFailed.mockClear()
    mockCreateCanvasAsset.mockClear()
    mockMarkCanvasAssetRunning.mockClear()
    mockMarkCanvasAssetFailed.mockClear()
    mockUpdateCanvasShot.mockClear()
    mockSubmitShotVideoEntity.mockClear()
    mockSubmitShotVideoEntity.mockImplementation(async () => {})
  })

  it('全部提交成功 → generating + run succeeded（shotsSubmitted = 总数）', async () => {
    mockGetCanvasProjectDetail.mockResolvedValue(makeDetail([
      makeShot('shot-1', 'p1'),
      makeShot('shot-2', 'p2'),
    ]))

    const result = await generateVideos('proj-1', mockClient, 'run-1')

    expect(result).toBeTruthy()
    expect(lastProjectStatus()).toBe('generating')
    expect(mockMarkPipelineRunSucceeded).toHaveBeenCalledWith('run-1', { phase: 'videos', shotsSubmitted: 2 })
    expect(mockMarkPipelineRunFailed).not.toHaveBeenCalled()
    expect(mockSubmitShotVideoEntity).toHaveBeenCalledTimes(2)
  })

  it('部分提交失败 → 仍 generating + run succeeded（既有 hasAnyVideo 行为）', async () => {
    mockGetCanvasProjectDetail.mockResolvedValue(makeDetail([
      makeShot('shot-1', 'p1'),
      makeShot('shot-2', 'p2'),
    ]))
    mockSubmitShotVideoEntity.mockImplementation(async () => {
      throw new Error('dashscope down')
    })
    // 只让第二个失败：第一次成功，第二次抛错
    let calls = 0
    mockSubmitShotVideoEntity.mockImplementation(async () => {
      calls += 1
      if (calls === 2)
        throw new Error('dashscope down')
    })

    await generateVideos('proj-1', mockClient, 'run-1')

    expect(lastProjectStatus()).toBe('generating')
    expect(mockMarkPipelineRunSucceeded).toHaveBeenCalledTimes(1)
    expect(mockMarkPipelineRunFailed).not.toHaveBeenCalled()
    // 失败的 shot 被标记 failed
    expect(mockUpdateCanvasShot).toHaveBeenCalledWith('shot-2', expect.objectContaining({ status: 'failed' }))
  })

  it('全部提交失败 → prompts_ready + run failed', async () => {
    mockGetCanvasProjectDetail.mockResolvedValue(makeDetail([
      makeShot('shot-1', 'p1'),
    ]))
    mockSubmitShotVideoEntity.mockImplementation(async () => {
      throw new Error('dashscope down')
    })

    await generateVideos('proj-1', mockClient, 'run-1')

    expect(lastProjectStatus()).toBe('prompts_ready')
    expect(mockMarkPipelineRunFailed).toHaveBeenCalledWith('run-1', '所有视频提交失败')
    expect(mockMarkPipelineRunSucceeded).not.toHaveBeenCalled()
  })

  it('没有 shot 带 prompt（empty）→ prompts_ready + run failed', async () => {
    mockGetCanvasProjectDetail.mockResolvedValue(makeDetail([
      makeShot('shot-1', undefined),
      makeShot('shot-2', undefined),
    ]))

    await generateVideos('proj-1', mockClient, 'run-1')

    expect(lastProjectStatus()).toBe('prompts_ready')
    expect(mockMarkPipelineRunFailed).toHaveBeenCalledWith('run-1', '所有视频提交失败')
    expect(mockMarkPipelineRunSucceeded).not.toHaveBeenCalled()
    // 没有 prompt 的 shot 不提交
    expect(mockSubmitShotVideoEntity).not.toHaveBeenCalled()
  })
})
