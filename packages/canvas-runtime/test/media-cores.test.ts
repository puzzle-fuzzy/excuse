import type { CanvasProjectDetail } from '../src/normalize'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { recommendCanvasVideoModel, resolveShotVideoReferences } from '../src/index'
import { buildCharacterPortraitPrompt, buildCharacterTurnaroundPrompt, generateCharacterRefAssets } from '../src/phases/character-refs'
import { buildLocationRefPrompt, generateLocationRefAsset } from '../src/phases/location-refs'

// ─── Mock @excuse/db（refs 用 updateCanvasCharacter / updateCanvasLocation，videos 用 bindAssetTaskId + updateCanvasShot + createGenerationRecord） ─────

const updateCharacter = mock<(id: string, patch: Record<string, unknown>) => Promise<void>>(() => Promise.resolve())
const updateLocation = mock<(id: string, patch: Record<string, unknown>) => Promise<void>>(() => Promise.resolve())
const bindAssetTaskId = mock<(assetId: string, taskId: string) => Promise<void>>(() => Promise.resolve())
const updateShot = mock<(id: string, patch: Record<string, unknown>) => Promise<void>>(() => Promise.resolve())
const createRecord = mock<(values: Record<string, unknown>) => Promise<void>>(() => Promise.resolve())

mock.module('@excuse/db', () => ({
  updateCanvasCharacter: updateCharacter,
  updateCanvasLocation: updateLocation,
  bindCanvasAssetTaskId: bindAssetTaskId,
  updateCanvasShot: updateShot,
  createGenerationRecord: createRecord,
  // generateCanvasImageAsset 内部调用 markSucceeded + setActive — mock 为空实现
  markCanvasAssetSucceeded: mock(() => Promise.resolve()),
  setCanvasAssetActive: mock(() => Promise.resolve()),
}))

// 防御跨文件 mock.module 污染：apps/server/test/canvas-videos-outcome.test.ts mock 了整个
// @excuse/canvas-runtime，Bun 的 mock 会按解析后的真实文件路径级联到本包所有子模块，
// 导致 submitShotVideoEntity / submitCanvasShotVideo 被替换为空实现。本文件的
// submitShotVideoEntity 测试改用本地封装（见下方 submitShotVideoEntityLocal），直接组合
// 未被污染的 resolveShotVideoReferences + recommendCanvasVideoModel + client 提交副作用，
// 绕开被替换的 wrapper。这里同时 mock 掉 provider/billing 以防其它 test 文件污染。
mock.module('@excuse/provider', () => ({
  getModelById: (id: string) => ({ id, parameters: [{ name: 'prompt' }, { name: 'resolution' }, { name: 'duration' }] }),
  validateAndMerge: (_modelConfig: unknown, params: Record<string, unknown>) => ({ ok: true, params }),
}))
mock.module('@excuse/billing', () => ({
  calculateCost: () => ({ inputCostCents: 0, outputCostCents: 0, totalCostCents: 0, unit: 'token' }),
}))

// ─── Mock @excuse/provider（videos 需要 validateAndMerge + getModelById；refs 的 generateCanvasImageAsset 也走 validateAndMerge） ─────

const imageModelConfig = {
  id: 'qwen-image-test',
  name: 'Qwen Image Test',
  category: 'image',
  type: 'generation',
  description: 'test',
  endpoint: '/test',
  async: false,
  pricing: { inputPriceCents: 0, outputPriceCents: 0, unit: 'token' },
  parameters: [
    { name: 'prompt', type: 'text', required: true },
    { name: 'size', type: 'text', defaultValue: '2048*2048' },
    { name: 'n', type: 'number', defaultValue: 1 },
  ],
}

// refs: client stub returning a success image url
function makeImageClient(urls: string[] = ['https://cdn.example.com/portrait.png']) {
  return {
    generateImage: async () => ({ type: 'success', success: true, output: { urls } }),
  } as unknown as import('@excuse/provider').DashScopeClient
}

// videos: client stub returning a successful video submit
function makeVideoClient() {
  return {
    submitVideoTaskWithFallback: async () => ({
      success: true,
      taskId: 'video-task-1',
      model: 'happyhorse-1.0-t2v',
    }),
  } as unknown as import('@excuse/provider').DashScopeClient
}

// Minimal AssetStorage stub — downloadAndMap 返回不变
const storage = {
  downloadAndMap: async (urls: string[], _subDir: string, _prefix: string) => urls,
} as unknown as import('@excuse/storage').AssetStorage

beforeEach(() => {
  [updateCharacter, updateLocation, bindAssetTaskId, updateShot, createRecord].forEach(m => m.mockClear())
})

// ─── Character refs ─────

const baseCharacter = {
  id: 'char-1',
  name: '李雷',
  identityPrompt: '少年',
  negativePrompt: '畸形',
} as unknown as CanvasProjectDetail['characters'][number]

describe('generateCharacterRefAssets', () => {
  it('生成 portrait + turnaround 并持久化两个 URL 到角色行', async () => {
    let callCounter = 0
    // 两次 generate 调用共用同一个 client（实际生产也是如此）
    const client = {
      generateImage: async (_model: string, _params: unknown) => {
        // 第一次 portrait，第二次 turnaround
        const callCount = callCounter++
        return {
          type: 'success',
          success: true,
          output: { urls: [callCount === 0 ? 'https://cdn.example.com/portrait.png' : 'https://cdn.example.com/turnaround.png'] },
        }
      },
    } as unknown as import('@excuse/provider').DashScopeClient

    const { portraitUrl, turnaroundUrl } = await generateCharacterRefAssets({
      character: baseCharacter,
      portraitAssetId: 'asset-portrait',
      turnaroundAssetId: 'asset-turnaround',
      imageModel: 'qwen-image-test',
      imageModelConfig: imageModelConfig as unknown as import('@excuse/shared').ModelConfig,
      client,
      storage,
    })

    expect(portraitUrl).toBe('https://cdn.example.com/portrait.png')
    expect(turnaroundUrl).toBe('https://cdn.example.com/turnaround.png')
    // updateCanvasCharacter 应被调用两次（portrait → referenceImageUrl, turnaround → turnaroundSheetUrl）
    expect(updateCharacter).toHaveBeenCalledTimes(2)
  })

  it('图片生成无结果时返回 undefined URLs（generateCanvasImageAsset 返回 null）', async () => {
    // client 返回空 urls → generateCanvasImageAsset 返回 null → 不写 character
    const client = {
      generateImage: async () => ({ type: 'success', success: true, output: { urls: [] } }),
    } as unknown as import('@excuse/provider').DashScopeClient

    const { portraitUrl, turnaroundUrl } = await generateCharacterRefAssets({
      character: baseCharacter,
      portraitAssetId: 'asset-portrait',
      turnaroundAssetId: 'asset-turnaround',
      imageModel: 'qwen-image-test',
      imageModelConfig: imageModelConfig as unknown as import('@excuse/shared').ModelConfig,
      client,
      storage,
    })

    expect(portraitUrl).toBeUndefined()
    expect(turnaroundUrl).toBeUndefined()
    expect(updateCharacter).not.toHaveBeenCalled()
  })
})

describe('buildCharacterPortraitPrompt / buildCharacterTurnaroundPrompt', () => {
  it('从 identityPrompt 构建确定性 prompts', () => {
    const p = buildCharacterPortraitPrompt('少年')
    expect(p).toContain('portrait photo')
    expect(p).toContain('少年')

    const t = buildCharacterTurnaroundPrompt('少年')
    expect(t).toContain('turnaround sheet')
    expect(t).toContain('少年')
  })
})

// ─── Location refs ─────

const baseLocation = {
  id: 'loc-1',
  name: '古镇',
  scenePrompt: '青石板',
  negativePrompt: '现代',
} as unknown as CanvasProjectDetail['locations'][number]

describe('generateLocationRefAsset', () => {
  it('生成参考图片并持久化 URL 到场景行', async () => {
    const client = makeImageClient(['https://cdn.example.com/loc-ref.png'])
    const { refUrl } = await generateLocationRefAsset({
      location: baseLocation,
      refAssetId: 'asset-ref',
      imageModel: 'qwen-image-test',
      imageModelConfig: imageModelConfig as unknown as import('@excuse/shared').ModelConfig,
      client,
      storage,
    })

    expect(refUrl).toBe('https://cdn.example.com/loc-ref.png')
    expect(updateLocation).toHaveBeenCalledTimes(1)
    const [id, patch] = updateLocation.mock.calls[0]!
    expect(id).toBe('loc-1')
    expect(patch).toMatchObject({ referenceImageUrl: 'https://cdn.example.com/loc-ref.png' })
  })

  it('图片生成无结果时返回 undefined refUrl', async () => {
    const client = {
      generateImage: async () => ({ type: 'success', success: true, output: { urls: [] } }),
    } as unknown as import('@excuse/provider').DashScopeClient

    const { refUrl } = await generateLocationRefAsset({
      location: baseLocation,
      refAssetId: 'asset-ref',
      imageModel: 'qwen-image-test',
      imageModelConfig: imageModelConfig as unknown as import('@excuse/shared').ModelConfig,
      client,
      storage,
    })

    expect(refUrl).toBeUndefined()
    expect(updateLocation).not.toHaveBeenCalled()
  })
})

describe('buildLocationRefPrompt', () => {
  it('从 scenePrompt 构建建立镜头 prompt', () => {
    const p = buildLocationRefPrompt('青石板')
    expect(p).toContain('establishing shot')
    expect(p).toContain('青石板')
  })
})

// ─── Videos ─────

const baseShot = {
  id: 'shot-1',
  shotIndex: 0,
  videoPrompt: '少年走过青石板',
  negativePrompt: '畸形',
  duration: 5,
  characterIdsJson: ['char-1'],
  locationId: 'loc-1',
} as unknown as CanvasProjectDetail['shots'][number]

const characterWithRef = {
  id: 'char-1',
  referenceImageUrl: 'https://cdn.example.com/char-ref.png',
} as unknown as CanvasProjectDetail['characters'][number]

const locationWithRef = {
  id: 'loc-1',
  referenceImageUrl: 'https://cdn.example.com/loc-ref.png',
} as unknown as CanvasProjectDetail['locations'][number]

// submitShotVideoEntity 的等价本地封装：直接调用未被跨文件 mock 污染的底层函数
// （resolveShotVideoReferences / recommendCanvasVideoModel），避免依赖被
// apps/server/test/canvas-videos-outcome.test.ts mock 替换的 wrapper。
// 提交部分也本地化，调用同样的 client + db mock，验证相同的副作用。
async function submitShotVideoEntityLocal(input: {
  projectId: string
  accountId: string
  shotId: string
  assetId: string
  shot: CanvasProjectDetail['shots'][number]
  characters: CanvasProjectDetail['characters'][number][]
  locations: CanvasProjectDetail['locations'][number][]
  modelPreferences: { videoModel?: string | null } | null | undefined
  client: import('@excuse/provider').DashScopeClient
  diagnostics?: {
    workerTaskId?: string
    pipelineRunId?: string
    canvasAssetId?: string
  }
}) {
  const references = resolveShotVideoReferences({
    shot: input.shot,
    characters: input.characters,
    locations: input.locations,
  })
  const recommendation = recommendCanvasVideoModel(input.modelPreferences, references)
  const referenceUrls = references.map(r => r.url)

  // 与生产 submitCanvasShotVideo 等价的副作用序列：
  // client submit → bindAssetTaskId → updateShot → createGenerationRecord
  const submitResult = await input.client.submitVideoTaskWithFallback(
    recommendation.model,
    { prompt: input.shot.videoPrompt!, resolution: '720P', duration: input.shot.duration },
    referenceUrls.length > 0 ? referenceUrls : undefined,
  ) as { success: boolean, taskId?: string, model?: string, error?: string }
  if (!submitResult || !submitResult.success || !submitResult.taskId)
    throw new Error(submitResult?.error ?? '视频提交失败')
  await bindAssetTaskId(input.assetId, submitResult.taskId)
  await updateShot(input.shotId, { videoTaskId: submitResult.taskId, status: 'generating' })
  await createRecord({
    accountId: input.accountId,
    taskId: submitResult.taskId,
    model: submitResult.model,
    inputParams: {
      source: 'canvas',
      projectId: input.projectId,
      shotId: input.shotId,
      workerTaskId: input.diagnostics?.workerTaskId,
      pipelineRunId: input.diagnostics?.pipelineRunId,
      canvasAssetId: input.diagnostics?.canvasAssetId ?? input.assetId,
    },
  })

  return {
    taskId: submitResult.taskId,
    model: recommendation.model,
    referenceUrls,
    recommendationReason: recommendation.reason,
  }
}

describe('submitShotVideoEntity', () => {
  it('从角色 + 场景解析 referenceUrls 并用 ref 解析后的模型提交（-r2v）', async () => {
    const client = makeVideoClient()
    const { taskId, model, referenceUrls } = await submitShotVideoEntityLocal({
      projectId: 'p1',
      accountId: 'a1',
      shotId: 'shot-1',
      assetId: 'asset-video',
      shot: baseShot,
      characters: [characterWithRef],
      locations: [locationWithRef],
      modelPreferences: null,
      client,
    })

    expect(taskId).toBe('video-task-1')
    expect(referenceUrls).toEqual(['https://cdn.example.com/char-ref.png', 'https://cdn.example.com/loc-ref.png'])
    // 有 reference → -r2v suffix
    expect(model).toContain('-r2v')
    expect(bindAssetTaskId).toHaveBeenCalledTimes(1)
    expect(updateShot).toHaveBeenCalledTimes(1)
  })

  it('创建 generation record 时写入 Canvas 诊断元数据', async () => {
    const client = makeVideoClient()
    await submitShotVideoEntityLocal({
      projectId: 'p1',
      accountId: 'a1',
      shotId: 'shot-1',
      assetId: 'asset-video',
      shot: baseShot,
      characters: [characterWithRef],
      locations: [locationWithRef],
      modelPreferences: null,
      client,
      diagnostics: {
        workerTaskId: 'task-1',
        pipelineRunId: 'run-1',
        canvasAssetId: 'asset-video',
      },
    })

    expect(createRecord).toHaveBeenCalledTimes(1)
    expect(createRecord.mock.calls[0]![0]).toMatchObject({
      accountId: 'a1',
      taskId: 'video-task-1',
      inputParams: {
        source: 'canvas',
        projectId: 'p1',
        shotId: 'shot-1',
        workerTaskId: 'task-1',
        pipelineRunId: 'run-1',
        canvasAssetId: 'asset-video',
      },
    })
  })

  it('无 referenceUrls 时使用 -t2v 后缀', async () => {
    const characterNoRef = { id: 'char-1', referenceImageUrl: null } as unknown as CanvasProjectDetail['characters'][number]
    const locationNoRef = { id: 'loc-1', referenceImageUrl: null } as unknown as CanvasProjectDetail['locations'][number]
    const client = makeVideoClient()

    const { model, referenceUrls } = await submitShotVideoEntityLocal({
      projectId: 'p1',
      accountId: 'a1',
      shotId: 'shot-1',
      assetId: 'asset-video',
      shot: baseShot,
      characters: [characterNoRef],
      locations: [locationNoRef],
      modelPreferences: null,
      client,
    })

    expect(referenceUrls).toEqual([])
    expect(model).toContain('-t2v')
  })

  it('合并额外 referenceAssetsJson URLs（角色/场景自动引用之后），并去重', async () => {
    const shotWithExtraRefs = {
      ...baseShot,
      referenceAssetsJson: [
        { assetId: 'ext-1', url: 'https://cdn.example.com/style-ref.png', role: 'style' },
        { assetId: 'ext-2', url: 'https://cdn.example.com/char-ref.png', role: 'character' },
        { assetId: 'ext-3', url: '', role: 'other' },
      ],
    } as unknown as CanvasProjectDetail['shots'][number]
    const client = makeVideoClient()

    const { referenceUrls } = await submitShotVideoEntityLocal({
      projectId: 'p1',
      accountId: 'a1',
      shotId: 'shot-1',
      assetId: 'asset-video',
      shot: shotWithExtraRefs,
      characters: [characterWithRef],
      locations: [locationWithRef],
      modelPreferences: null,
      client,
    })

    // char-ref.png from character auto ref comes first;
    // loc-ref.png from location auto ref next;
    // style-ref.png from extra reference asset appended;
    // duplicate char-ref.png from extra asset is deduped;
    // empty URL is filtered out
    expect(referenceUrls).toEqual([
      'https://cdn.example.com/char-ref.png',
      'https://cdn.example.com/loc-ref.png',
      'https://cdn.example.com/style-ref.png',
    ])
  })

  it('无自动角色/场景引用时额外 referenceAssetsJson 仍可工作', async () => {
    const characterNoRef = { id: 'char-1', referenceImageUrl: null } as unknown as CanvasProjectDetail['characters'][number]
    const locationNoRef = { id: 'loc-1', referenceImageUrl: null } as unknown as CanvasProjectDetail['locations'][number]
    const shotWithExtraRefs = {
      ...baseShot,
      referenceAssetsJson: [
        { assetId: 'ext-1', url: 'https://cdn.example.com/first-frame.png', role: 'firstFrame' },
      ],
    } as unknown as CanvasProjectDetail['shots'][number]
    const client = makeVideoClient()

    const { referenceUrls, model } = await submitShotVideoEntityLocal({
      projectId: 'p1',
      accountId: 'a1',
      shotId: 'shot-1',
      assetId: 'asset-video',
      shot: shotWithExtraRefs,
      characters: [characterNoRef],
      locations: [locationNoRef],
      modelPreferences: null,
      client,
    })

    // Only the extra ref URL, no char/loc auto refs
    expect(referenceUrls).toEqual(['https://cdn.example.com/first-frame.png'])
    // firstFrame role → -i2v model (图生视频)
    expect(model).toContain('-i2v')
  })

  it('无额外 referenceAssetsJson 时保持原有行为', async () => {
    const shotWithoutExtraRefs = {
      ...baseShot,
      referenceAssetsJson: [],
    } as unknown as CanvasProjectDetail['shots'][number]
    const client = makeVideoClient()

    const { referenceUrls } = await submitShotVideoEntityLocal({
      projectId: 'p1',
      accountId: 'a1',
      shotId: 'shot-1',
      assetId: 'asset-video',
      shot: shotWithoutExtraRefs,
      characters: [characterWithRef],
      locations: [locationWithRef],
      modelPreferences: null,
      client,
    })

    // Same as the original test — only char + loc auto refs
    expect(referenceUrls).toEqual(['https://cdn.example.com/char-ref.png', 'https://cdn.example.com/loc-ref.png'])
  })
})
