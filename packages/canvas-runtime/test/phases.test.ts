import type { DashScopeClient } from '@excuse/provider'
import type { ModelConfig } from '@excuse/shared'
import type { RunTextLlmOnceDeps } from '../src/llm-helpers'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { runAnalysisPhase } from '../src/phases/analysis'
import { generateCharacterEntity } from '../src/phases/characters'
import { generateLocationEntity } from '../src/phases/locations'
import { runStoryboardPhase } from '../src/phases/storyboard'

const textModel: ModelConfig = {
  id: 'qwen-test',
  name: 'Qwen Test',
  category: 'text',
  type: 'generation',
  description: 'test',
  endpoint: '/test',
  async: false,
  pricing: { inputPriceCents: 0, outputPriceCents: 0, unit: 'token' },
  parameters: [
    { name: 'prompt', type: 'text', required: true },
    { name: 'temperature', type: 'number', defaultValue: 0.7 },
    { name: 'max_tokens', type: 'number', defaultValue: 1500 },
  ],
}

/**
 * provider 默认 deps 在 llm-helpers 模块加载时被捕获到常量，mock.module 无法在导入后替换它，
 * 因此通过 core 的 textLlmDeps 注入点直接注入（与 prepareCanvasVideoParams 的 deps 注入同构）。
 * @excuse/db 的调用发生在运行时（test body 内），mock.module 可正常拦截。
 */
const textLlmDeps: RunTextLlmOnceDeps = {
  getModelById: (id: string) => (id === 'qwen-test' ? textModel : undefined),
  validateAndMerge: (_config, params) => ({ ok: true, params: params as never }),
}

// ─── Mock @excuse/db（运行时调用，mock.module 拦截） ─────

const deleteShots = mock(() => Promise.resolve())
const deleteLocations = mock(() => Promise.resolve())
const deleteCharacters = mock(() => Promise.resolve())
const updateProject = mock<(projectId: string, patch: Record<string, unknown>) => Promise<void>>(() => Promise.resolve())
const createCharacter = mock<(values: Record<string, unknown>) => Promise<{ id: string } & Record<string, unknown>>>(
  values => Promise.resolve({ id: 'char-new', ...values }),
)
const createLocation = mock<(values: Record<string, unknown>) => Promise<{ id: string } & Record<string, unknown>>>(
  values => Promise.resolve({ id: 'loc-new', ...values }),
)
const batchCreateShots = mock<(values: Array<Record<string, unknown>>) => Promise<Array<Record<string, unknown>>>>(
  values => Promise.resolve(values.map((v, i) => ({ id: `shot-${i}`, ...v }))),
)

mock.module('@excuse/db', () => ({
  deleteCanvasShotsByProject: deleteShots,
  deleteCanvasLocationsByProject: deleteLocations,
  deleteCanvasCharactersByProject: deleteCharacters,
  updateCanvasProject: updateProject,
  createCanvasCharacter: createCharacter,
  createCanvasLocation: createLocation,
  batchCreateCanvasShots: batchCreateShots,
}))

function makeClient(text: string): DashScopeClient {
  return {
    chatCompletion: async () => ({ type: 'text', success: true, model: 'qwen-test', output: { text } }),
  } as unknown as DashScopeClient
}

const analysis = { summary: '故事梗概', mainConflict: '核心冲突', timeline: [], characterNames: [], sceneNames: [] }

beforeEach(() => {
  [deleteShots, deleteLocations, deleteCharacters, updateProject, createCharacter, createLocation, batchCreateShots]
    .forEach(m => m.mockClear())
})

describe('runAnalysisPhase', () => {
  it('重新分析时级联删除子资源并持久化 analysisJson', async () => {
    const { analysis: result } = await runAnalysisPhase({
      projectId: 'p1',
      storyText: 'story',
      isReanalysis: true,
      client: makeClient('{"summary":"梗概","mainConflict":"冲突"}'),
      textModel: 'qwen-test',
      textLlmDeps,
    })

    expect(result.summary).toBe('梗概')
    expect(deleteShots).toHaveBeenCalledTimes(1)
    expect(deleteLocations).toHaveBeenCalledTimes(1)
    expect(deleteCharacters).toHaveBeenCalledTimes(1)
    expect(updateProject).toHaveBeenCalledTimes(1)
    const [projectId, patch] = updateProject.mock.calls[0]!
    expect(projectId).toBe('p1')
    expect(patch).toMatchObject({ status: 'analyzed' })
    expect((patch as Record<string, unknown>).analysisJson).toEqual(result)
  })

  it('首次分析时不级联删除（draft）', async () => {
    await runAnalysisPhase({
      projectId: 'p1',
      storyText: 'story',
      isReanalysis: false,
      client: makeClient('{"summary":"x","mainConflict":"y"}'),
      textModel: 'qwen-test',
      textLlmDeps,
    })

    expect(deleteShots).not.toHaveBeenCalled()
    expect(deleteLocations).not.toHaveBeenCalled()
    expect(deleteCharacters).not.toHaveBeenCalled()
  })
})

describe('generateCharacterEntity', () => {
  it('创建角色行，profile.name 缺失时回退到输入名称', async () => {
    const { character, profile } = await generateCharacterEntity({
      projectId: 'p1',
      storyText: 'story',
      analysis,
      name: '李雷',
      client: makeClient('{"name":"李雷","identityPrompt":"少年","negativePrompt":"畸形"}'),
      textModel: 'qwen-test',
      textLlmDeps,
    })

    expect(profile.identityPrompt).toBe('少年')
    expect(character.id).toBe('char-new')
    const [values] = createCharacter.mock.calls[0]!
    expect(values.name).toBe('李雷')
    expect(values.identityPrompt).toBe('少年')
  })
})

describe('generateLocationEntity', () => {
  it('返回创建的行以便宿主按 id 通知（锁定 bug 修复契约）', async () => {
    const { location, profile } = await generateLocationEntity({
      projectId: 'p1',
      storyText: 'story',
      analysis,
      name: '古镇',
      client: makeClient('{"name":"古镇","type":"exterior","scenePrompt":"青石板","negativePrompt":"现代"}'),
      textModel: 'qwen-test',
      textLlmDeps,
    })

    expect(profile.scenePrompt).toBe('青石板')
    expect(location.id).toBe('loc-new')
    expect(createLocation).toHaveBeenCalledTimes(1)
  })
})

describe('runStoryboardPhase', () => {
  it('批量创建前删除旧镜头并返回创建的行', async () => {
    const llmOutput = JSON.stringify([
      { shotIndex: 0, narrative: '开场', duration: 5, locationId: null, characterIds: [], camera: {}, continuity: {} },
      { shotIndex: 1, narrative: '冲突', duration: 4, locationId: null, characterIds: [], camera: {}, continuity: {} },
    ])
    const { shots, shotsCreated } = await runStoryboardPhase({
      projectId: 'p1',
      storyText: 'story',
      analysis,
      characters: [],
      locations: [],
      client: makeClient(llmOutput),
      textModel: 'qwen-test',
      textLlmDeps,
    })

    expect(shots).toHaveLength(2)
    expect(shotsCreated).toHaveLength(2)
    expect(shotsCreated[0]!.id).toBe('shot-0')
    expect(deleteShots).toHaveBeenCalledTimes(1)
    // delete happens before batch create
    expect(deleteShots.mock.invocationCallOrder[0]).toBeLessThan(batchCreateShots.mock.invocationCallOrder[0]!)
  })
})
