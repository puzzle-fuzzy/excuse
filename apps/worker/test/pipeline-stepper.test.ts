/**
 * Pipeline Stepper 测试 — 自动推进 Canvas pipeline 阶段
 *
 * 测试 advancePipelineAfterTaskSuccess 的条件分支：
 *   - 非 canvas domain → 不推进
 *   - autoProgress=false → 不推进
 *   - PAUSE_BEFORE 阶段 → 不推进
 *   - 已有 active run → 不推进
 *   - 正常推进 → 创建 pipeline_run + task
 */
import type { CanvasModelPreferences, CanvasPipelinePhase } from '@excuse/db'
import { beforeEach, describe, expect, it, mock } from 'bun:test'

// Mock DB functions
const mockGetCanvasProjectById = mock<(id: string) => Promise<any>>(() => Promise.resolve(null))
const mockCreatePipelineRun = mock<(values: any) => Promise<any>>(() => Promise.resolve({ id: 'run-next' }))
const mockCreateTask = mock<(values: any) => Promise<any>>(() => Promise.resolve({ id: 'task-next' }))
const mockLinkPipelineRunToTask = mock<(runId: string, taskId: string) => Promise<any>>(() => Promise.resolve(null))
const mockFindActiveRunForPhase = mock<(projectId: string, phase: CanvasPipelinePhase) => Promise<any | null>>(() => Promise.resolve(null))

mock.module('@excuse/db', () => ({
  getCanvasProjectById: mockGetCanvasProjectById,
  createPipelineRun: mockCreatePipelineRun,
  createTask: mockCreateTask,
  linkPipelineRunToTask: mockLinkPipelineRunToTask,
  findActiveRunForPhase: mockFindActiveRunForPhase,
}))

mock.module('@excuse/shared', () => ({
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {} }),
}))

// eslint-disable-next-line import/first
import { advancePipelineAfterTaskSuccess, PAUSE_BEFORE, PHASE_ORDER } from '../src/pipeline-stepper'

const mockConfig = {
  dashscopeApiKey: 'test',
  dashscopeBaseUrl: undefined,
  storageRoot: '/tmp',
  pollIntervalMs: 5000,
  staleTimeoutMs: 14400000,
  claimTtlMs: 30000,
  sweepIntervalMs: 60000,
  oss: undefined,
}

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-001',
    type: 'canvas.analyze',
    domain: 'canvas',
    projectId: 'proj-001',
    accountId: 'acc-001',
    ...overrides,
  }
}

function makeProject(autoProgress: boolean) {
  const modelPrefs: CanvasModelPreferences = { autoProgress }
  return {
    id: 'proj-001',
    accountId: 'acc-001',
    modelPreferencesJson: modelPrefs,
  }
}

describe('Pipeline Stepper', () => {
  // 每个 test 清除 mock 状态
  beforeEach(() => {
    mockGetCanvasProjectById.mockClear()
    mockCreatePipelineRun.mockClear()
    mockCreateTask.mockClear()
    mockLinkPipelineRunToTask.mockClear()
    mockFindActiveRunForPhase.mockClear()
    // 重置默认返回值
    mockGetCanvasProjectById.mockResolvedValue(null)
    mockCreatePipelineRun.mockResolvedValue({ id: 'run-next' })
    mockCreateTask.mockResolvedValue({ id: 'task-next' })
    mockFindActiveRunForPhase.mockResolvedValue(null)
  })

  it('PHASE_ORDER 有 12 个阶段', () => {
    expect(PHASE_ORDER).toHaveLength(12)
    expect(PHASE_ORDER[0]).toBe('analyze')
    expect(PHASE_ORDER[8]).toBe('dialogue')
    expect(PHASE_ORDER[11]).toBe('assemble')
  })

  it('PAUSE_BEFORE 包含 storyboard / videos / assemble', () => {
    expect(PAUSE_BEFORE.has('storyboard')).toBe(true)
    expect(PAUSE_BEFORE.has('videos')).toBe(true)
    expect(PAUSE_BEFORE.has('assemble')).toBe(true)
    expect(PAUSE_BEFORE.size).toBe(3)
  })

  it('非 canvas domain 不推进', async () => {
    const result = await advancePipelineAfterTaskSuccess(
      makeTask({ domain: 'generate' }),
      mockConfig,
    )
    expect(result).toBeNull()
  })

  it('autoProgress=false 不推进', async () => {
    mockGetCanvasProjectById.mockResolvedValue(makeProject(false))

    const result = await advancePipelineAfterTaskSuccess(
      makeTask(),
      mockConfig,
    )
    expect(result).toBeNull()
  })

  it('最后一个阶段（assemble）不推进', async () => {
    mockGetCanvasProjectById.mockResolvedValue(makeProject(true))

    const result = await advancePipelineAfterTaskSuccess(
      makeTask({ type: 'canvas.assemble' }),
      mockConfig,
    )
    expect(result).toBeNull()
  })

  it('下一阶段是 PAUSE_BEFORE（storyboard）时不推进', async () => {
    // locationRefs 之后是 storyboard，storyboard 在 PAUSE_BEFORE 中
    mockGetCanvasProjectById.mockResolvedValue(makeProject(true))

    const result = await advancePipelineAfterTaskSuccess(
      makeTask({ type: 'canvas.locationRefs' }),
      mockConfig,
    )
    expect(result).toBeNull()
  })

  it('下一阶段已有 active run时不推进', async () => {
    mockGetCanvasProjectById.mockResolvedValue(makeProject(true))
    mockFindActiveRunForPhase.mockResolvedValue({ id: 'run-existing' })

    const result = await advancePipelineAfterTaskSuccess(
      makeTask({ type: 'canvas.analyze' }),
      mockConfig,
    )
    expect(result).toBeNull()

    // 并发守卫必须短路：不得创建 run/task
    expect(mockCreatePipelineRun).not.toHaveBeenCalled()
    expect(mockCreateTask).not.toHaveBeenCalled()
  })

  it('正常推进：analyze → characters', async () => {
    mockGetCanvasProjectById.mockResolvedValue(makeProject(true))
    mockFindActiveRunForPhase.mockResolvedValue(null)
    mockCreatePipelineRun.mockResolvedValue({ id: 'run-characters' })
    mockCreateTask.mockResolvedValue({ id: 'task-characters' })

    const result = await advancePipelineAfterTaskSuccess(
      makeTask({ type: 'canvas.analyze' }),
      mockConfig,
    )
    expect(result).toBe('task-characters')

    // Verify createPipelineRun was called with correct phase
    expect(mockCreatePipelineRun).toHaveBeenCalledWith({
      projectId: 'proj-001',
      phase: 'characters',
      createdBy: 'acc-001',
    })

    // Verify createTask was called with correct type
    expect(mockCreateTask).toHaveBeenCalledWith({
      accountId: 'acc-001',
      type: 'canvas.characters',
      domain: 'canvas',
      priority: 5,
      projectId: 'proj-001',
      targetType: 'pipeline_run',
      targetId: 'run-characters',
    })

    // Verify linkPipelineRunToTask was called
    expect(mockLinkPipelineRunToTask).toHaveBeenCalledWith('run-characters', 'task-characters')
  })

  it('locationRefs → storyboard 不推进（PAUSE_BEFORE）', async () => {
    mockGetCanvasProjectById.mockResolvedValue(makeProject(true))

    const result = await advancePipelineAfterTaskSuccess(
      makeTask({ type: 'canvas.locationRefs' }),
      mockConfig,
    )
    expect(result).toBeNull()
  })

  it('dialogue → videos 不推进（PAUSE_BEFORE）', async () => {
    // dialogue 之后是 videos，videos 在 PAUSE_BEFORE 中 → 不自动推进
    mockGetCanvasProjectById.mockResolvedValue(makeProject(true))

    const result = await advancePipelineAfterTaskSuccess(
      makeTask({ type: 'canvas.dialogue' }),
      mockConfig,
    )
    expect(result).toBeNull()
  })
})
