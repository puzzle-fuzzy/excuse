import type { CanvasAssetsPoll } from '@excuse/shared'
import type { CanvasPollDeltaTarget } from '../src/lib/canvas-poll'

import { describe, expect, it } from 'vitest'
import { buildActiveImageTaskMaps, hasCanvasPollDelta } from '../src/lib/canvas-poll'

// ── Fixtures ──────────────────────────────────────────────

/** 构造一个完整的最小 CanvasAssetsPoll，测试只覆盖关心的字段 */
function makePoll(overrides: Partial<CanvasAssetsPoll> = {}): CanvasAssetsPoll {
  return {
    scope: 'canvas',
    projectId: 'proj-1',
    projectStatus: 'analyzed',
    characters: [],
    locations: [],
    shots: [],
    activeTasks: [],
    recentFailures: [],
    costs: [],
    costSummary: {
      totalEstimatedCents: 0,
      totalFinalCents: 0,
      totalFailedCents: 0,
      byPhase: {},
    },
    generatedAt: 0,
    ...overrides,
  }
}

/** 构造一个与给定 poll 快照「对齐」的本地 project（无差异） */
function makeProject(poll: CanvasAssetsPoll): CanvasPollDeltaTarget {
  return {
    status: poll.projectStatus,
    characters: poll.characters.map(c => ({
      id: c.characterId,
      referenceImageUrl: c.referenceImageUrl,
      turnaroundSheetUrl: c.turnaroundSheetUrl,
    })),
    locations: poll.locations.map(l => ({
      id: l.locationId,
      referenceImageUrl: l.referenceImageUrl,
    })),
    shots: poll.shots.map(s => ({ id: s.shotId, status: s.status })),
  }
}

// ── hasCanvasPollDelta ────────────────────────────────────

describe('hasCanvasPollDelta', () => {
  it('poll 与 project 完全一致时返回 false', () => {
    const poll = makePoll({
      characters: [{ characterId: 'c1', name: '主角', referenceImageUrl: 'img-a', turnaroundSheetUrl: null, activeImageTaskIds: [] }],
      locations: [{ locationId: 'l1', name: '客厅', referenceImageUrl: 'loc-a', activeImageTaskIds: [] }],
      shots: [{ shotId: 's1', shotIndex: 0, status: 'ready', videoUrl: null, activeVideoTaskIds: [] }],
    })
    expect(hasCanvasPollDelta(makeProject(poll), poll)).toBe(false)
  })

  it('projectStatus 不同时返回 true（阶段推进）', () => {
    const poll = makePoll({ projectStatus: 'characters_ready' })
    const project = makeProject(makePoll({ projectStatus: 'analyzed' }))
    expect(hasCanvasPollDelta(project, poll)).toBe(true)
  })

  it('镜头状态不同时返回 true（视频生成进度）', () => {
    const poll = makePoll({
      shots: [{ shotId: 's1', shotIndex: 0, status: 'completed', videoUrl: 'v', activeVideoTaskIds: [] }],
    })
    const project = makeProject(makePoll({
      shots: [{ shotId: 's1', shotIndex: 0, status: 'generating', videoUrl: null, activeVideoTaskIds: [] }],
    }))
    expect(hasCanvasPollDelta(project, poll)).toBe(true)
  })

  it('角色参考图 URL 不同时返回 true（polling 模式图片逐个完成）', () => {
    const poll = makePoll({
      characters: [{ characterId: 'c1', name: '主角', referenceImageUrl: 'img-new', turnaroundSheetUrl: null, activeImageTaskIds: [] }],
    })
    const project = makeProject(makePoll({
      characters: [{ characterId: 'c1', name: '主角', referenceImageUrl: null, turnaroundSheetUrl: null, activeImageTaskIds: [] }],
    }))
    expect(hasCanvasPollDelta(project, poll)).toBe(true)
  })

  it('角色转面图 URL 不同时返回 true', () => {
    const poll = makePoll({
      characters: [{ characterId: 'c1', name: '主角', referenceImageUrl: null, turnaroundSheetUrl: 'turn-new', activeImageTaskIds: [] }],
    })
    const project = makeProject(makePoll({
      characters: [{ characterId: 'c1', name: '主角', referenceImageUrl: null, turnaroundSheetUrl: null, activeImageTaskIds: [] }],
    }))
    expect(hasCanvasPollDelta(project, poll)).toBe(true)
  })

  it('场景参考图 URL 不同时返回 true', () => {
    const poll = makePoll({
      locations: [{ locationId: 'l1', name: '客厅', referenceImageUrl: 'loc-new', activeImageTaskIds: [] }],
    })
    const project = makeProject(makePoll({
      locations: [{ locationId: 'l1', name: '客厅', referenceImageUrl: null, activeImageTaskIds: [] }],
    }))
    expect(hasCanvasPollDelta(project, poll)).toBe(true)
  })

  it('poll 中存在 project 没有的角色时返回 true', () => {
    const poll = makePoll({
      characters: [{ characterId: 'c-new', name: '新角色', referenceImageUrl: null, turnaroundSheetUrl: null, activeImageTaskIds: [] }],
    })
    const project = makeProject(makePoll())
    expect(hasCanvasPollDelta(project, poll)).toBe(true)
  })
})

// ── buildActiveImageTaskMaps ──────────────────────────────

describe('buildActiveImageTaskMaps', () => {
  it('pollData 为 null/undefined 时返回空 Map', () => {
    expect(buildActiveImageTaskMaps(null)).toEqual({ character: new Map(), location: new Map() })
    expect(buildActiveImageTaskMaps(undefined)).toEqual({ character: new Map(), location: new Map() })
  })

  it('无活跃图片任务时返回空 Map', () => {
    const poll = makePoll({
      characters: [{ characterId: 'c1', name: '主角', referenceImageUrl: null, turnaroundSheetUrl: null, activeImageTaskIds: [] }],
      locations: [{ locationId: 'l1', name: '客厅', referenceImageUrl: null, activeImageTaskIds: [] }],
    })
    expect(buildActiveImageTaskMaps(poll)).toEqual({ character: new Map(), location: new Map() })
  })

  it('把有活跃任务的角色/场景映射到任务 ID 列表，跳过空数组', () => {
    const poll = makePoll({
      characters: [
        { characterId: 'c1', name: '主角', referenceImageUrl: null, turnaroundSheetUrl: null, activeImageTaskIds: ['task-1', 'task-2'] },
        { characterId: 'c2', name: '配角', referenceImageUrl: null, turnaroundSheetUrl: null, activeImageTaskIds: [] },
      ],
      locations: [
        { locationId: 'l1', name: '客厅', referenceImageUrl: null, activeImageTaskIds: ['task-3'] },
      ],
    })
    const { character, location } = buildActiveImageTaskMaps(poll)

    expect(character.get('c1')).toEqual(['task-1', 'task-2'])
    expect(character.has('c2')).toBe(false)
    expect(location.get('l1')).toEqual(['task-3'])
  })
})
