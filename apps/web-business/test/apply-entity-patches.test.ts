import type { CanvasEntityPatch, ProjectDTO, ShotDTO } from '@excuse/shared'
import { describe, expect, it } from 'vitest'
import { applyEntityPatches } from '../src/lib/apply-entity-patches'

// ── Fixtures ──────────────────────────────────────────────

/** 最小可用 ShotDTO；camera/continuity 等本测试不关心的字段给空对象（类型断言，非 any）。 */
function makeShot(overrides: Partial<ShotDTO> = {}): ShotDTO {
  return {
    id: 'shot-1',
    projectId: 'proj-1',
    shotIndex: 0,
    duration: 5,
    locationId: null,
    characterIds: [],
    narrative: 'narrative',
    camera: {} as ShotDTO['camera'],
    continuity: {} as ShotDTO['continuity'],
    timeline: null,
    environment: null,
    videoPrompt: null,
    negativePrompt: null,
    videoTaskId: null,
    videoUrl: null,
    status: 'draft',
    errorMessage: null,
    referenceAssets: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeProject(shots: ShotDTO[] = [makeShot()]): ProjectDTO {
  return {
    id: 'proj-1',
    accountId: 'acc-1',
    title: null,
    storyText: 'story',
    status: 'analyzed',
    analysis: null,
    modelPreferences: null,
    characters: [],
    locations: [],
    shots,
    continuityIssues: [],
    canvasLayout: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }
}

function patch(overrides: Partial<CanvasEntityPatch> = {}): CanvasEntityPatch {
  return {
    projectId: 'proj-1',
    nodeType: 'shot',
    nodeId: 'shot-1',
    status: 'completed',
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────

describe('applyEntityPatches', () => {
  it('把 shot 的 running 状态映射为 generating，不透传非法值', () => {
    const result = applyEntityPatches(makeProject(), [patch({ status: 'running' })])
    expect(result.shots[0]?.status).toBe('generating')
  })

  it('completed 清空历史 errorMessage', () => {
    const project = makeProject([makeShot({ status: 'failed', errorMessage: '旧错误' })])
    const result = applyEntityPatches(project, [patch({ status: 'completed' })])
    expect(result.shots[0]?.status).toBe('completed')
    expect(result.shots[0]?.errorMessage).toBeNull()
  })

  it('failed 写入 errorMessage', () => {
    const result = applyEntityPatches(makeProject(), [patch({ status: 'failed', error: '生成失败' })])
    expect(result.shots[0]?.status).toBe('failed')
    expect(result.shots[0]?.errorMessage).toBe('生成失败')
  })

  it('data.videoUrl 存在时回填（后端将来下发该字段时自动生效）', () => {
    const result = applyEntityPatches(makeProject(), [patch({ status: 'completed', data: { videoUrl: 'https://cdn/x.mp4' } })])
    expect(result.shots[0]?.videoUrl).toBe('https://cdn/x.mp4')
  })

  it('未知 status（如 cancelled）跳过该实体，不破坏不变量', () => {
    const project = makeProject([makeShot({ status: 'completed' })])
    const result = applyEntityPatches(project, [patch({ status: 'cancelled' })])
    expect(result.shots[0]?.status).toBe('completed')
  })

  it('找不到 nodeId（新实体/已删除）跳过，不抛错', () => {
    const project = makeProject([makeShot({ status: 'draft' })])
    const result = applyEntityPatches(project, [patch({ nodeId: 'shot-999', status: 'completed' })])
    expect(result.shots[0]?.status).toBe('draft')
  })

  it('character/location 事件无可即时 patch 字段，原引用不变', () => {
    const project = makeProject([makeShot({ status: 'draft' })])
    const result = applyEntityPatches(project, [
      { projectId: 'proj-1', nodeType: 'character', nodeId: 'char-1', status: 'completed', data: { referenceImageUrl: 'x' } },
      { projectId: 'proj-1', nodeType: 'location', nodeId: 'loc-1', status: 'completed' },
    ])
    // 无任何 shot patch → 函数未重赋 updated → 返回原引用
    expect(result).toBe(project)
    expect(result.shots[0]?.status).toBe('draft')
  })

  it('多个 shot 补丁各自原位应用', () => {
    const project = makeProject([makeShot({ id: 'a', status: 'draft' }), makeShot({ id: 'b', status: 'draft', shotIndex: 1 })])
    const result = applyEntityPatches(project, [
      patch({ nodeId: 'a', status: 'running' }),
      patch({ nodeId: 'b', status: 'failed', error: 'err' }),
    ])
    expect(result.shots.find(s => s.id === 'a')?.status).toBe('generating')
    expect(result.shots.find(s => s.id === 'b')?.status).toBe('failed')
    expect(result.shots.find(s => s.id === 'b')?.errorMessage).toBe('err')
  })

  it('空补丁列表返回原引用（无谓重渲染）', () => {
    const project = makeProject()
    expect(applyEntityPatches(project, [])).toBe(project)
  })
})
