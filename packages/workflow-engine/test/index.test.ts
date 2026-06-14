import { describe, expect, it } from 'bun:test'
import {
  canAdvanceToPhase,
  canCancelPipelineRun,
  canResumeFromPhase,
  canRetryPipelineRun,
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
  it('defines the canonical canvas phase order', () => {
    expect(CANVAS_PHASE_ORDER).toEqual([
      'analyze',
      'characters',
      'locations',
      'characterRefs',
      'locationRefs',
      'storyboard',
      'continuity',
      'rebuild',
      'videos',
    ])
    expect(CANVAS_PAUSE_BEFORE.has('storyboard')).toBe(true)
    expect(CANVAS_PAUSE_BEFORE.has('videos')).toBe(true)
  })

  it('maps between phases and canvas task types', () => {
    expect(phaseToTaskType('characters')).toBe('canvas.characters')
    expect(getCanvasPhaseFromTaskType('canvas.characters')).toBe('characters')
    expect(getCanvasPhaseFromTaskType('canvas.unknown')).toBeNull()
    expect(getCanvasPhaseFromTaskType('generate.video')).toBeNull()
  })

  it('returns the next phase when one exists', () => {
    expect(getNextCanvasPhase('analyze')).toBe('characters')
    expect(getNextCanvasPhase('rebuild')).toBe('videos')
    expect(getNextCanvasPhase('videos')).toBeNull()
  })

  it('decides not to advance non-canvas or incomplete tasks', () => {
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

  it('decides not to advance when auto progress is disabled', () => {
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

  it('pauses before user confirmation phases', () => {
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

  it('allows ordinary automatic phase advancement', () => {
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

  it('creates and links the next canvas pipeline task through an adapter', async () => {
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
})

describe('canvas pipeline run state rules', () => {
  it('treats pending and running as active', () => {
    expect(isActivePipelineRun({ status: 'pending' })).toBe(true)
    expect(isActivePipelineRun({ status: 'running' })).toBe(true)
  })

  it('treats succeeded, failed and cancelled as not active', () => {
    expect(isActivePipelineRun({ status: 'succeeded' })).toBe(false)
    expect(isActivePipelineRun({ status: 'failed' })).toBe(false)
    expect(isActivePipelineRun({ status: 'cancelled' })).toBe(false)
  })

  it('treats succeeded, failed and cancelled as terminal', () => {
    expect(isTerminalPipelineRun({ status: 'succeeded' })).toBe(true)
    expect(isTerminalPipelineRun({ status: 'failed' })).toBe(true)
    expect(isTerminalPipelineRun({ status: 'cancelled' })).toBe(true)
  })

  it('treats pending and running as not terminal', () => {
    expect(isTerminalPipelineRun({ status: 'pending' })).toBe(false)
    expect(isTerminalPipelineRun({ status: 'running' })).toBe(false)
  })

  it('filters a run list down to active runs, preserving order and extra fields', () => {
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

  it('returns an empty array when no runs are active', () => {
    const runs = [
      { id: 'r1', status: 'succeeded' as const },
      { id: 'r2', status: 'failed' as const },
    ]
    expect(filterActivePipelineRuns(runs)).toEqual([])
  })

  it('treats failed and cancelled runs as retryable', () => {
    expect(isRetryablePipelineRun({ status: 'failed' })).toBe(true)
    expect(isRetryablePipelineRun({ status: 'cancelled' })).toBe(true)
  })

  it('treats succeeded, pending and running runs as not retryable', () => {
    expect(isRetryablePipelineRun({ status: 'succeeded' })).toBe(false)
    expect(isRetryablePipelineRun({ status: 'pending' })).toBe(false)
    expect(isRetryablePipelineRun({ status: 'running' })).toBe(false)
  })
})

describe('canvas phase decision rules', () => {
  it('flags storyboard and videos as pause-before phases', () => {
    expect(isPauseBeforePhase('storyboard')).toBe(true)
    expect(isPauseBeforePhase('videos')).toBe(true)
  })

  it('does not flag ordinary phases as pause-before', () => {
    expect(isPauseBeforePhase('analyze')).toBe(false)
    expect(isPauseBeforePhase('characters')).toBe(false)
    expect(isPauseBeforePhase('rebuild')).toBe(false)
  })

  it('allows advancing to an ordinary phase when there is no active run', () => {
    expect(canAdvanceToPhase('characters')).toBe(true)
    expect(canAdvanceToPhase('characters', { hasActiveRun: false })).toBe(true)
  })

  it('blocks advancing to a pause-before phase even without an active run', () => {
    expect(canAdvanceToPhase('storyboard')).toBe(false)
    expect(canAdvanceToPhase('videos', { hasActiveRun: false })).toBe(false)
  })

  it('blocks advancing when the target phase already has an active run', () => {
    expect(canAdvanceToPhase('characters', { hasActiveRun: true })).toBe(false)
  })

  it('decideCanvasAutoAdvance still pauses before storyboard (regression)', () => {
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

describe('batch outcome rules', () => {
  it('classifies an empty batch as empty', () => {
    expect(decideBatchOutcome([])).toEqual({ type: 'empty' })
  })

  it('classifies a fully succeeded batch', () => {
    const items = [{ status: 'succeeded' as const }, { status: 'succeeded' as const }]
    expect(decideBatchOutcome(items)).toEqual({
      type: 'all_succeeded',
      succeeded: 2,
      failed: 0,
      total: 2,
    })
  })

  it('classifies a fully failed batch', () => {
    const items = [{ status: 'failed' as const }, { status: 'failed' as const }]
    expect(decideBatchOutcome(items)).toEqual({
      type: 'all_failed',
      succeeded: 0,
      failed: 2,
      total: 2,
    })
  })

  it('classifies a mixed succeeded/failed batch as partial_failed', () => {
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

  it('treats a batch with pending/processing items as in_progress', () => {
    expect(decideBatchOutcome([
      { status: 'succeeded' as const },
      { status: 'pending' as const },
      { status: 'failed' as const },
    ])).toMatchObject({ type: 'in_progress' })

    expect(decideBatchOutcome([
      { status: 'processing' as const },
    ])).toMatchObject({ type: 'in_progress' })
  })

  it('counts cancelled items toward the failed count', () => {
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

  it('keeps an all-cancelled batch as all_failed', () => {
    expect(decideBatchOutcome([
      { status: 'cancelled' as const },
      { status: 'cancelled' as const },
    ])).toMatchObject({ type: 'all_failed', failed: 2 })
  })
})

describe('pipeline command rules', () => {
  it('allows cancelling pending and running runs', () => {
    expect(canCancelPipelineRun({ status: 'pending' })).toBe(true)
    expect(canCancelPipelineRun({ status: 'running' })).toBe(true)
  })

  it('forbids cancelling terminal runs', () => {
    expect(canCancelPipelineRun({ status: 'succeeded' })).toBe(false)
    expect(canCancelPipelineRun({ status: 'failed' })).toBe(false)
    expect(canCancelPipelineRun({ status: 'cancelled' })).toBe(false)
  })

  it('allows retrying failed and cancelled runs', () => {
    expect(canRetryPipelineRun({ status: 'failed' })).toBe(true)
    expect(canRetryPipelineRun({ status: 'cancelled' })).toBe(true)
  })

  it('forbids retrying pending, running and succeeded runs', () => {
    expect(canRetryPipelineRun({ status: 'pending' })).toBe(false)
    expect(canRetryPipelineRun({ status: 'running' })).toBe(false)
    expect(canRetryPipelineRun({ status: 'succeeded' })).toBe(false)
  })

  it('allows resume only from pause-before phases (storyboard / videos)', () => {
    expect(canResumeFromPhase('storyboard')).toBe(true)
    expect(canResumeFromPhase('videos')).toBe(true)
  })

  it('forbids resume from ordinary phases', () => {
    expect(canResumeFromPhase('analyze')).toBe(false)
    expect(canResumeFromPhase('characters')).toBe(false)
    expect(canResumeFromPhase('rebuild')).toBe(false)
  })
})
