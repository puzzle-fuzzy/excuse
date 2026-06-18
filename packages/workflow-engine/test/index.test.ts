import { describe, expect, it } from 'bun:test'
import {
  canAdvanceToPhase,
  canCancelPipelineRun,
  CANVAS_PAUSE_BEFORE,
  CANVAS_PHASE_ORDER,
  createNextCanvasPipelineTask,
  decideBatchOutcome,
  decideCanvasAutoAdvance,
  filterActivePipelineRuns,
  getCanvasPhaseFromTaskType,
  getNextCanvasPhase,
  isActivePipelineRun,
  isPauseBeforePhase,
  isRetryablePipelineRun,
  isTerminalPipelineRun,
  phaseToTaskType,
} from '../src'

describe('@excuse/workflow-engine', () => {
  it('定义标准 canvas 阶段顺序', () => {
    expect(CANVAS_PHASE_ORDER).toEqual([
      'analyze',
      'characters',
      'locations',
      'characterRefs',
      'locationRefs',
      'storyboard',
      'continuity',
      'rebuild',
      'dialogue',
      'videos',
      'bgm',
      'assemble',
    ])
    expect(CANVAS_PAUSE_BEFORE.has('storyboard')).toBe(true)
    expect(CANVAS_PAUSE_BEFORE.has('videos')).toBe(true)
    expect(CANVAS_PAUSE_BEFORE.has('assemble')).toBe(true)
  })

  it('阶段与 canvas 任务类型双向映射', () => {
    expect(phaseToTaskType('characters')).toBe('canvas.characters')
    expect(getCanvasPhaseFromTaskType('canvas.characters')).toBe('characters')
    expect(getCanvasPhaseFromTaskType('canvas.unknown')).toBeNull()
    expect(getCanvasPhaseFromTaskType('generate.video')).toBeNull()
  })

  it('存在下一阶段时返回下一阶段', () => {
    expect(getNextCanvasPhase('analyze')).toBe('characters')
    expect(getNextCanvasPhase('rebuild')).toBe('dialogue')
    expect(getNextCanvasPhase('dialogue')).toBe('videos')
    expect(getNextCanvasPhase('videos')).toBe('bgm')
    expect(getNextCanvasPhase('bgm')).toBe('assemble')
    expect(getNextCanvasPhase('assemble')).toBeNull()
  })

  it('非 canvas 或未完成任务不自动推进', () => {
    expect(decideCanvasAutoAdvance({
      type: 'canvas.analyze',
      domain: 'generate',
      projectId: 'project-1',
      accountId: 'account-1',
    }, true)).toMatchObject({
      shouldAdvance: false,
      reason: 'not_canvas_task',
    })
  })

  it('自动推进关闭时不推进', () => {
    expect(decideCanvasAutoAdvance({
      type: 'canvas.analyze',
      domain: 'canvas',
      projectId: 'project-1',
      accountId: 'account-1',
    }, false)).toEqual({
      shouldAdvance: false,
      currentPhase: 'analyze',
      nextPhase: 'characters',
      reason: 'auto_progress_disabled',
    })
  })

  it('用户确认阶段前暂停', () => {
    expect(decideCanvasAutoAdvance({
      type: 'canvas.locationRefs',
      domain: 'canvas',
      projectId: 'project-1',
      accountId: 'account-1',
    }, true)).toEqual({
      shouldAdvance: false,
      currentPhase: 'locationRefs',
      nextPhase: 'storyboard',
      reason: 'pause_before',
    })
  })

  it('普通阶段允许自动推进', () => {
    expect(decideCanvasAutoAdvance({
      type: 'canvas.analyze',
      domain: 'canvas',
      projectId: 'project-1',
      accountId: 'account-1',
    }, true)).toEqual({
      shouldAdvance: true,
      currentPhase: 'analyze',
      nextPhase: 'characters',
    })
  })

  it('通过 adapter 创建并关联下一个 pipeline 任务', async () => {
    const calls: string[] = []
    const result = await createNextCanvasPipelineTask({
      projectId: 'project-1',
      accountId: 'account-1',
      nextPhase: 'characters',
      adapter: {
        createPipelineRun: async (values) => {
          calls.push(`run:${values.phase}`)
          expect(values).toEqual({
            projectId: 'project-1',
            phase: 'characters',
            createdBy: 'account-1',
          })
          return { id: 'run-1' }
        },
        createTask: async (values) => {
          calls.push(`task:${values.type}`)
          expect(values).toEqual({
            accountId: 'account-1',
            type: 'canvas.characters',
            domain: 'canvas',
            priority: 5,
            projectId: 'project-1',
            targetType: 'pipeline_run',
            targetId: 'run-1',
          })
          return { id: 'task-1' }
        },
        linkPipelineRunToTask: async (runId, taskId) => {
          calls.push(`link:${runId}:${taskId}`)
        },
      },
    })

    expect(result).toEqual({
      runId: 'run-1',
      taskId: 'task-1',
      taskType: 'canvas.characters',
    })
    expect(calls).toEqual(['run:characters', 'task:canvas.characters', 'link:run-1:task-1'])
  })

  it('videos 阶段使用较低队列优先级，避免挤占小任务', async () => {
    await createNextCanvasPipelineTask({
      projectId: 'project-1',
      accountId: 'account-1',
      nextPhase: 'videos',
      adapter: {
        createPipelineRun: async () => ({ id: 'run-videos' }),
        createTask: async (values) => {
          expect(values.priority).toBe(6)
          expect(values.type).toBe('canvas.videos')
          return { id: 'task-videos' }
        },
        linkPipelineRunToTask: async () => {},
      },
    })
  })
})

describe('canvas pipeline 运行状态规则', () => {
  it('pending 和 running 视为活跃', () => {
    expect(isActivePipelineRun({ status: 'pending' })).toBe(true)
    expect(isActivePipelineRun({ status: 'running' })).toBe(true)
  })

  it('succeeded、failed、cancelled 视为非活跃', () => {
    expect(isActivePipelineRun({ status: 'succeeded' })).toBe(false)
    expect(isActivePipelineRun({ status: 'failed' })).toBe(false)
    expect(isActivePipelineRun({ status: 'cancelled' })).toBe(false)
  })

  it('succeeded、failed、cancelled 视为终态', () => {
    expect(isTerminalPipelineRun({ status: 'succeeded' })).toBe(true)
    expect(isTerminalPipelineRun({ status: 'failed' })).toBe(true)
    expect(isTerminalPipelineRun({ status: 'cancelled' })).toBe(true)
  })

  it('pending 和 running 视为非终态', () => {
    expect(isTerminalPipelineRun({ status: 'pending' })).toBe(false)
    expect(isTerminalPipelineRun({ status: 'running' })).toBe(false)
  })

  it('过滤运行列表仅保留活跃项，保持顺序和额外字段', () => {
    const runs = [
      { id: 'r1', status: 'succeeded' as const },
      { id: 'r2', status: 'running' as const },
      { id: 'r3', status: 'cancelled' as const },
      { id: 'r4', status: 'pending' as const },
    ]
    const active = filterActivePipelineRuns(runs)
    expect(active).toEqual([
      { id: 'r2', status: 'running' },
      { id: 'r4', status: 'pending' },
    ])
  })

  it('无活跃运行时返回空数组', () => {
    const runs = [
      { id: 'r1', status: 'succeeded' as const },
      { id: 'r2', status: 'failed' as const },
    ]
    expect(filterActivePipelineRuns(runs)).toEqual([])
  })

  it('failed 和 cancelled 视为可重试', () => {
    expect(isRetryablePipelineRun({ status: 'failed' })).toBe(true)
    expect(isRetryablePipelineRun({ status: 'cancelled' })).toBe(true)
  })

  it('succeeded、pending、running 视为不可重试', () => {
    expect(isRetryablePipelineRun({ status: 'succeeded' })).toBe(false)
    expect(isRetryablePipelineRun({ status: 'pending' })).toBe(false)
    expect(isRetryablePipelineRun({ status: 'running' })).toBe(false)
  })
})

describe('canvas 阶段决策规则', () => {
  it('storyboard 和 videos 标记为暂停前阶段', () => {
    expect(isPauseBeforePhase('storyboard')).toBe(true)
    expect(isPauseBeforePhase('videos')).toBe(true)
  })

  it('普通阶段不标记为暂停前', () => {
    expect(isPauseBeforePhase('analyze')).toBe(false)
    expect(isPauseBeforePhase('characters')).toBe(false)
    expect(isPauseBeforePhase('rebuild')).toBe(false)
  })

  it('无活跃运行时允许推进到普通阶段', () => {
    expect(canAdvanceToPhase('characters')).toBe(true)
    expect(canAdvanceToPhase('characters', { hasActiveRun: false })).toBe(true)
  })

  it('即使无活跃运行也阻止推进到暂停前阶段', () => {
    expect(canAdvanceToPhase('storyboard')).toBe(false)
    expect(canAdvanceToPhase('videos', { hasActiveRun: false })).toBe(false)
  })

  it('目标阶段已有活跃运行时阻止推进', () => {
    expect(canAdvanceToPhase('characters', { hasActiveRun: true })).toBe(false)
  })

  it('decideCanvasAutoAdvance 在 storyboard 前仍暂停（回归测试）', () => {
    expect(decideCanvasAutoAdvance({
      type: 'canvas.locationRefs',
      domain: 'canvas',
      projectId: 'project-1',
      accountId: 'account-1',
    }, true)).toMatchObject({
      shouldAdvance: false,
      nextPhase: 'storyboard',
      reason: 'pause_before',
    })
  })
})

describe('批次结果规则', () => {
  it('空批次分类为 empty', () => {
    expect(decideBatchOutcome([])).toEqual({ type: 'empty' })
  })

  it('全部成功的批次分类为 all_succeeded', () => {
    const items = [{ status: 'succeeded' as const }, { status: 'succeeded' as const }]
    expect(decideBatchOutcome(items)).toEqual({
      type: 'all_succeeded',
      succeeded: 2,
      failed: 0,
      total: 2,
    })
  })

  it('全部失败的批次分类为 all_failed', () => {
    const items = [{ status: 'failed' as const }, { status: 'failed' as const }]
    expect(decideBatchOutcome(items)).toEqual({
      type: 'all_failed',
      succeeded: 0,
      failed: 2,
      total: 2,
    })
  })

  it('成功/失败混合批次分类为 partial_failed', () => {
    const items = [
      { status: 'succeeded' as const },
      { status: 'failed' as const },
      { status: 'succeeded' as const },
    ]
    expect(decideBatchOutcome(items)).toEqual({
      type: 'partial_failed',
      succeeded: 2,
      failed: 1,
      total: 3,
    })
  })

  it('含 pending/processing 的批次视为 in_progress', () => {
    expect(decideBatchOutcome([
      { status: 'succeeded' as const },
      { status: 'pending' as const },
      { status: 'failed' as const },
    ])).toMatchObject({ type: 'in_progress' })

    expect(decideBatchOutcome([
      { status: 'processing' as const },
    ])).toMatchObject({ type: 'in_progress' })
  })

  it('cancelled 计入失败数量', () => {
    const items = [
      { status: 'cancelled' as const },
      { status: 'failed' as const },
    ]
    // 全部 failed/cancelled → all_failed，failed count 含 cancelled
    expect(decideBatchOutcome(items)).toEqual({
      type: 'all_failed',
      succeeded: 0,
      failed: 2,
      total: 2,
    })

    // cancelled 混 succeeded → partial_failed，cancelled 计入 failed
    expect(decideBatchOutcome([
      { status: 'succeeded' as const },
      { status: 'cancelled' as const },
    ])).toEqual({
      type: 'partial_failed',
      succeeded: 1,
      failed: 1,
      total: 2,
    })
  })

  it('全 cancelled 批次仍为 all_failed', () => {
    expect(decideBatchOutcome([
      { status: 'cancelled' as const },
      { status: 'cancelled' as const },
    ])).toMatchObject({ type: 'all_failed', failed: 2 })
  })
})

describe('pipeline 命令规则', () => {
  it('允许取消 pending 和 running 运行', () => {
    expect(canCancelPipelineRun({ status: 'pending' })).toBe(true)
    expect(canCancelPipelineRun({ status: 'running' })).toBe(true)
  })

  it('禁止取消终态运行', () => {
    expect(canCancelPipelineRun({ status: 'succeeded' })).toBe(false)
    expect(canCancelPipelineRun({ status: 'failed' })).toBe(false)
    expect(canCancelPipelineRun({ status: 'cancelled' })).toBe(false)
  })
})
