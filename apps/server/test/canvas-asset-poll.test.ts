/**
 * Canvas 资产轮询端点测试
 *
 * 测试 /api/canvas/projects/:projectId/assets/poll 的：
 *   - 权限校验（404 非存在、无权访问）
 *   - draft 项目返回空数据
 *   - generating 项目返回活跃任务和成本映射
 *   - generatedAt 时间戳合理性
 */
import type { CanvasProjectRow, CanvasProjectStatus } from '@excuse/db'
import { treaty } from '@elysia/eden'
import { jwt } from '@elysia/jwt'
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Elysia } from 'elysia'
import { extractEdenData, extractEdenError, makeTestConfig } from './helpers/test-factory'

// ===== Mock 设置（必须在 route import 之前） =====

const mockGetCanvasProjectByIdForAccount = mock<(id: string, accountId: string) => Promise<CanvasProjectRow | null>>(() => Promise.resolve(null))
const mockGetCanvasProjectById = mock<(id: string) => Promise<CanvasProjectRow | null>>(() => Promise.resolve(null))
const mockGetCanvasProjectDetail = mock<() => Promise<{
  project: CanvasProjectRow
  characters: any[]
  locations: any[]
  shots: any[]
  latestContinuity: any | null
} | null>>(() => Promise.resolve(null))
const mockListCanvasGenerationRecordsByProject = mock<() => Promise<any[]>>(() => Promise.resolve([]))
const mockListActiveCanvasAssetsByProject = mock<() => Promise<any[]>>(() => Promise.resolve([]))
const mockListTerminalCanvasAssetsByProject = mock<() => Promise<any[]>>(() => Promise.resolve([]))

// 其他 canvas route 依赖的 DB 函数（inline stub，无需精细控制）
const stubDBFunctions = {
  createPipelineRun: async () => ({ id: 'run-001' }),
  findActiveRunForPhase: async () => null,
  getPipelineRunById: async () => null,
  listPipelineRunsByProject: async () => [],
  updateCanvasProject: async () => null,
  getCanvasCharacterForAccount: async () => null,
  getCanvasLocationForAccount: async () => null,
  getCanvasShotForAccount: async () => null,
  pgClient: { listen: async () => {} },
  // canvas_asset repo functions needed by asset-poll
  listActiveCanvasAssetsByProject: mockListActiveCanvasAssetsByProject,
  listTerminalCanvasAssetsByProject: mockListTerminalCanvasAssetsByProject,
}

mock.module('@excuse/db', () => ({
  ...stubDBFunctions,
  getCanvasProjectByIdForAccount: mockGetCanvasProjectByIdForAccount,
  getCanvasProjectById: mockGetCanvasProjectById,
  getCanvasProjectDetail: mockGetCanvasProjectDetail,
  listCanvasGenerationRecordsByProject: mockListCanvasGenerationRecordsByProject,
  listActiveCanvasAssetsByProject: mockListActiveCanvasAssetsByProject,
  listTerminalCanvasAssetsByProject: mockListTerminalCanvasAssetsByProject,
}))

mock.module('@excuse/provider', () => ({
  DashScopeClient: class { chatCompletion = async () => ({ success: true, output: { text: 'mock' } }) },
  AssetStorage: class { downloadAndMap = async (urls: string[]) => urls },
  validateAndMerge: (_mc: any, params: any) => ({ ok: true, params }),
  getModelById: async () => null,
}))

mock.module('@excuse/billing', () => ({
  calculateCost: () => ({ unit: 'token', totalPriceCents: 1, totalPrice: 0.01 }),
}))

mock.module('../src/modules/canvas/service', () => ({
  listProjects: async () => [],
  createProject: async () => null,
  getProjectDetail: async () => null,
  softDeleteProject: async () => {},
  updateProjectProperties: async () => null,
  updateModelPreferences: async () => null,
  saveCanvasLayout: async () => null,
  updateCharacterData: async () => null,
  updateLocationData: async () => null,
  updateShotData: async () => null,
  deleteCharacter: async () => {},
  deleteLocation: async () => {},
  deleteShot: async () => {},
  analyzeProject: async () => null,
  generateCharacters: async () => null,
  generateLocations: async () => null,
  generateCharacterRefs: async () => null,
  generateLocationRefs: async () => null,
  generateStoryboard: async () => null,
  checkContinuity: async () => null,
  rebuildShotPrompts: async () => null,
  generateVideos: async () => null,
  retryShotVideo: async () => null,
  retryFailedShots: async () => null,
  regenerateCharacter: async () => null,
  regenerateLocation: async () => null,
  regenerateShotVideo: async () => null,
}))

mock.module('../src/services/sse-manager', () => ({
  dispatchToUser: () => {},
}))

mock.module('../src/plugins/auth', () => ({
  createAuthPlugin: () => new Elysia(),
  createRequireAuthPlugin: (_config: any) => new Elysia().derive(({ headers }: any) => ({
    userId: headers?.authorization?.replace('Bearer ', '') ?? '',
  })),
}))

// eslint-disable-next-line import/first
import { createCanvasRoutes } from '../src/routes/canvas'

// ===== 测试基础设施 =====

const testConfig = makeTestConfig({ jwtSecret: 'test-canvas-poll-secret' })
let client: ReturnType<typeof treaty>
let token: string

function makeProjectRow(overrides: Partial<CanvasProjectRow> = {}): CanvasProjectRow {
  return {
    id: 'proj-001',
    accountId: 'acc-001',
    title: null,
    storyText: '一段超过十个字的故事文本内容',
    status: 'draft' as CanvasProjectStatus,
    analysisJson: null,
    modelPreferencesJson: null,
    canvasLayout: null,
    isDeleted: false,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }
}

async function getAuthToken(accountId: string = 'acc-001'): Promise<string> {
  const jwtApp = new Elysia()
    .use(jwt({ name: 'jwt', secret: testConfig.jwtSecret, exp: '1h' }))
    .get('/sign', async ({ jwt }) => jwt.sign({ sub: accountId }))

  const jwtClient = treaty(jwtApp)
  const { data } = await jwtClient.sign.get()
  return data as unknown as string
}

beforeAll(async () => {
  token = await getAuthToken()
})

beforeEach(() => {
  for (const m of [mockGetCanvasProjectByIdForAccount, mockGetCanvasProjectById, mockGetCanvasProjectDetail, mockListCanvasGenerationRecordsByProject, mockListActiveCanvasAssetsByProject, mockListTerminalCanvasAssetsByProject]) {
    m.mockClear()
  }

  const app = createCanvasRoutes(testConfig)
  client = treaty(app)
})

// ===== 测试 =====

describe('Canvas 资产轮询端点', () => {
  const headers = { headers: { Authorization: `Bearer ${token}` } }

  it('返回 404 当项目不存在', async () => {
    mockGetCanvasProjectByIdForAccount.mockResolvedValue(null)

    const res = await client.api.canvas.projects({ projectId: 'nonexistent' }).assets.poll.get(headers)
    const err = extractEdenError(res)
    expect(err).toBeTruthy()
    expect(err!.error).toContain('不存在')
  })

  it('返回 404 当项目不属于当前用户', async () => {
    // 项目存在但属于其他用户 → getCanvasProjectByIdForAccount 返回 null
    const otherUserToken = await getAuthToken('acc-other')
    mockGetCanvasProjectByIdForAccount.mockResolvedValue(null)

    const res = await client.api.canvas.projects({ projectId: 'proj-001' }).assets.poll.get({
      headers: { Authorization: `Bearer ${otherUserToken}` },
    })
    const err = extractEdenError(res)
    expect(err).toBeTruthy()
  })

  it('draft 项目返回空 activeTasks 和 costs', async () => {
    const projectRow = makeProjectRow({ status: 'draft' })
    mockGetCanvasProjectByIdForAccount.mockResolvedValue(projectRow)
    mockGetCanvasProjectById.mockResolvedValue(projectRow)
    mockGetCanvasProjectDetail.mockResolvedValue({
      project: projectRow,
      characters: [],
      locations: [],
      shots: [],
      latestContinuity: null,
    })
    mockListCanvasGenerationRecordsByProject.mockResolvedValue([])

    const res = await client.api.canvas.projects({ projectId: 'proj-001' }).assets.poll.get(headers)

    // Eden 返回结构
    const data = extractEdenData(res)
    expect(data.success).toBe(true)
    expect(data.data.scope).toBe('canvas')
    expect(data.data.projectId).toBe('proj-001')
    expect(data.data.projectStatus).toBe('draft')
    expect(data.data.activeTasks).toEqual([])
    expect(data.data.costs).toEqual([])
    expect(data.data.costSummary.totalEstimatedCents).toBe(0)
    expect(data.data.costSummary.totalFinalCents).toBe(0)
    expect(data.data.costSummary.totalFailedCents).toBe(0)
    expect(data.data.costSummary.byPhase).toEqual({})
    expect(data.data.characters).toEqual([])
    expect(data.data.locations).toEqual([])
    expect(data.data.shots).toEqual([])
    expect(data.data.generatedAt).toBeGreaterThan(0)
  })

  it('generating 项目返回活跃视频任务和成本', async () => {
    const projectRow = makeProjectRow({ status: 'generating' })
    const shotRow = { id: 'shot-001', shotIndex: 0, status: 'generating', videoUrl: null }

    mockGetCanvasProjectByIdForAccount.mockResolvedValue(projectRow)
    mockGetCanvasProjectById.mockResolvedValue(projectRow)
    mockGetCanvasProjectDetail.mockResolvedValue({
      project: projectRow,
      characters: [],
      locations: [],
      shots: [shotRow],
      latestContinuity: null,
    })
    mockListCanvasGenerationRecordsByProject.mockResolvedValue([
      {
        id: 'gen-001',
        category: 'video',
        status: 'processing',
        totalPriceCents: 100,
        cost: null,
        shotId: 'shot-001',
      },
    ])

    const res = await client.api.canvas.projects({ projectId: 'proj-001' }).assets.poll.get(headers)

    const data = extractEdenData(res)
    expect(data.success).toBe(true)

    const poll = data.data
    expect(poll.projectStatus).toBe('generating')
    expect(poll.shots).toHaveLength(1)
    expect(poll.shots[0].shotId).toBe('shot-001')
    expect(poll.shots[0].activeVideoTaskIds).toEqual(['gen-001'])
    expect(poll.shots[0].status).toBe('generating')

    expect(poll.activeTasks).toHaveLength(1)
    expect(poll.activeTasks[0].id).toBe('gen-001')
    expect(poll.activeTasks[0].category).toBe('video')
    expect(poll.activeTasks[0].targetId).toBe('shot-001')
    expect(poll.activeTasks[0].targetType).toBe('shot')

    expect(poll.costs).toHaveLength(1)
    expect(poll.costs[0].recordId).toBe('gen-001')
    expect(poll.costs[0].category).toBe('video')
    expect(poll.costs[0].state).toBe('active')
    expect(poll.costs[0].estimatedCostCents).toBe(100)
    expect(poll.costs[0].finalCostCents).toBeNull()

    // P2-1 成本 rollup：进行中视频任务计入 videos 阶段 estimated
    expect(poll.costSummary.totalEstimatedCents).toBe(100)
    expect(poll.costSummary.totalFinalCents).toBe(0)
    expect(poll.costSummary.totalFailedCents).toBe(0)
    expect(poll.costSummary.byPhase.videos).toEqual({ estimatedCents: 100, finalCents: 0, failedCents: 0, count: 1 })
  })

  it('终态记录映射为 completed/failed cost state', async () => {
    const projectRow = makeProjectRow({ status: 'completed' })
    const shotRow = { id: 'shot-001', shotIndex: 0, status: 'completed', videoUrl: 'https://video.url' }

    mockGetCanvasProjectByIdForAccount.mockResolvedValue(projectRow)
    mockGetCanvasProjectById.mockResolvedValue(projectRow)
    mockGetCanvasProjectDetail.mockResolvedValue({
      project: projectRow,
      characters: [],
      locations: [],
      shots: [shotRow],
      latestContinuity: null,
    })
    mockListCanvasGenerationRecordsByProject.mockResolvedValue([
      {
        id: 'gen-suc',
        category: 'video',
        status: 'succeeded',
        totalPriceCents: 200,
        cost: null,
        shotId: 'shot-001',
      },
      {
        id: 'gen-fail',
        category: 'image',
        status: 'failed',
        totalPriceCents: 50,
        cost: null,
        shotId: null,
      },
    ])

    const res = await client.api.canvas.projects({ projectId: 'proj-001' }).assets.poll.get(headers)

    const data = extractEdenData(res)
    expect(data.success).toBe(true)

    const costs = data.data.costs
    // succeeded → state: completed
    expect(costs.find((c: any) => c.recordId === 'gen-suc')?.state).toBe('completed')
    expect(costs.find((c: any) => c.recordId === 'gen-suc')?.finalCostCents).toBe(200)
    expect(costs.find((c: any) => c.recordId === 'gen-suc')?.estimatedCostCents).toBeNull()

    // failed → state: failed
    expect(costs.find((c: any) => c.recordId === 'gen-fail')?.state).toBe('failed')
    expect(costs.find((c: any) => c.recordId === 'gen-fail')?.finalCostCents).toBe(50)
    expect(costs.find((c: any) => c.recordId === 'gen-fail')?.estimatedCostCents).toBeNull()
  })

  it('cancelled 记录映射为 failed cost state', async () => {
    const projectRow = makeProjectRow({ status: 'draft' })
    mockGetCanvasProjectByIdForAccount.mockResolvedValue(projectRow)
    mockGetCanvasProjectById.mockResolvedValue(projectRow)
    mockGetCanvasProjectDetail.mockResolvedValue({
      project: projectRow,
      characters: [],
      locations: [],
      shots: [],
      latestContinuity: null,
    })
    mockListCanvasGenerationRecordsByProject.mockResolvedValue([
      {
        id: 'gen-cancel',
        category: 'video',
        status: 'cancelled',
        totalPriceCents: 30,
        cost: null,
        shotId: null,
      },
    ])

    const res = await client.api.canvas.projects({ projectId: 'proj-001' }).assets.poll.get(headers)
    const data = extractEdenData(res)
    expect(data.data.costs[0].state).toBe('failed')
  })

  it('generatedAt 是近期时间戳', async () => {
    const projectRow = makeProjectRow()
    mockGetCanvasProjectByIdForAccount.mockResolvedValue(projectRow)
    mockGetCanvasProjectById.mockResolvedValue(projectRow)
    mockGetCanvasProjectDetail.mockResolvedValue({
      project: projectRow,
      characters: [],
      locations: [],
      shots: [],
      latestContinuity: null,
    })
    mockListCanvasGenerationRecordsByProject.mockResolvedValue([])

    const before = Date.now()
    const res = await client.api.canvas.projects({ projectId: 'proj-001' }).assets.poll.get(headers)
    const after = Date.now()

    const data = extractEdenData(res)
    expect(data.data.generatedAt).toBeGreaterThanOrEqual(before)
    expect(data.data.generatedAt).toBeLessThanOrEqual(after)
  })

  it('character/location activeImageTaskIds 从 canvas_assets 填充', async () => {
    const projectRow = makeProjectRow({ status: 'refs_ready' })
    mockGetCanvasProjectByIdForAccount.mockResolvedValue(projectRow)
    mockGetCanvasProjectById.mockResolvedValue(projectRow)
    mockGetCanvasProjectDetail.mockResolvedValue({
      project: projectRow,
      characters: [
        { id: 'char-001', name: '角色A', referenceImageUrl: null, turnaroundSheetUrl: null },
        { id: 'char-002', name: '角色B', referenceImageUrl: 'https://img.url', turnaroundSheetUrl: null },
      ],
      locations: [
        { id: 'loc-001', name: '场景A', referenceImageUrl: null },
      ],
      shots: [],
      latestContinuity: null,
    })
    mockListCanvasGenerationRecordsByProject.mockResolvedValue([])
    mockListActiveCanvasAssetsByProject.mockResolvedValue([
      // 角色 char-001 有一个活跃的肖像 + 一个活跃的三视图
      { id: 'asset-portrait-1', category: 'characterPortrait', targetEntityType: 'character', targetEntityId: 'char-001', status: 'running', totalPriceCents: null },
      { id: 'asset-turnaround-1', category: 'characterTurnaround', targetEntityType: 'character', targetEntityId: 'char-001', status: 'queued', totalPriceCents: null },
      // 场景 loc-001 有一个活跃的参考图
      { id: 'asset-locref-1', category: 'locationRef', targetEntityType: 'location', targetEntityId: 'loc-001', status: 'running', totalPriceCents: null },
    ])
    mockListTerminalCanvasAssetsByProject.mockResolvedValue([])

    const res = await client.api.canvas.projects({ projectId: 'proj-001' }).assets.poll.get(headers)
    const data = extractEdenData(res)

    expect(data.success).toBe(true)
    const poll = data.data

    // char-001 应有 2 个活跃图片任务
    expect(poll.characters).toHaveLength(2)
    expect(poll.characters[0].characterId).toBe('char-001')
    expect(poll.characters[0].activeImageTaskIds).toEqual(['asset-portrait-1', 'asset-turnaround-1'])

    // char-002 没有活跃图片任务
    expect(poll.characters[1].characterId).toBe('char-002')
    expect(poll.characters[1].activeImageTaskIds).toEqual([])

    // loc-001 应有 1 个活跃图片任务
    expect(poll.locations).toHaveLength(1)
    expect(poll.locations[0].locationId).toBe('loc-001')
    expect(poll.locations[0].activeImageTaskIds).toEqual(['asset-locref-1'])

    // activeTasks 应包含 3 个来自 canvas_assets 的条目
    expect(poll.activeTasks).toHaveLength(3)
    expect(poll.activeTasks[0].category).toBe('image')
    expect(poll.activeTasks[0].targetType).toBe('character')
    expect(poll.activeTasks[2].category).toBe('image')
    expect(poll.activeTasks[2].targetType).toBe('location')
  })

  it('recentFailures 分类失败原因并给出建议（generation_records + canvas_assets）', async () => {
    const projectRow = makeProjectRow({ status: 'partial_failed' })
    mockGetCanvasProjectByIdForAccount.mockResolvedValue(projectRow)
    mockGetCanvasProjectById.mockResolvedValue(projectRow)
    mockGetCanvasProjectDetail.mockResolvedValue({
      project: projectRow,
      characters: [],
      locations: [],
      shots: [],
      latestContinuity: null,
    })
    mockListCanvasGenerationRecordsByProject.mockResolvedValue([
      // 余额不足 → balance
      {
        id: 'gen-balance',
        category: 'video',
        status: 'failed',
        totalPriceCents: 0,
        cost: null,
        errorMessage: '账号欠费，请前往阿里云控制台充值后重试',
        retryCount: 2,
        updatedAt: new Date('2024-06-13T10:00:00Z'),
        shotId: 'shot-001',
      },
      // 用户取消 → cancel
      {
        id: 'gen-cancel',
        category: 'video',
        status: 'cancelled',
        totalPriceCents: 0,
        cost: null,
        errorMessage: '用户取消',
        retryCount: 0,
        updatedAt: new Date('2024-06-13T09:00:00Z'),
        shotId: null,
      },
    ])
    mockListActiveCanvasAssetsByProject.mockResolvedValue([])
    mockListTerminalCanvasAssetsByProject.mockResolvedValue([
      // 内容审核未通过 → content（canvas_asset）
      {
        id: 'asset-content',
        category: 'characterPortrait',
        targetEntityType: 'character',
        targetEntityId: 'char-001',
        status: 'failed',
        totalPriceCents: null,
        errorMessage: '生成内容不合规，请调整提示词后重试',
        updatedAt: new Date('2024-06-13T11:00:00Z'),
      },
      // 成功资产不应出现在 recentFailures
      {
        id: 'asset-ok',
        category: 'locationRef',
        targetEntityType: 'location',
        targetEntityId: 'loc-001',
        status: 'succeeded',
        totalPriceCents: 30,
        updatedAt: new Date('2024-06-13T08:00:00Z'),
      },
    ])

    const res = await client.api.canvas.projects({ projectId: 'proj-001' }).assets.poll.get(headers)
    const data = extractEdenData(res)
    const poll = data.data

    // 仅失败/取消记录进入 recentFailures（成功资产排除）
    expect(poll.recentFailures).toHaveLength(3)

    // 按失败时间倒序：11:00(content) → 10:00(balance) → 09:00(cancel)
    expect(poll.recentFailures[0].id).toBe('asset-content')
    expect(poll.recentFailures[0].failureKind).toBe('content')
    expect(poll.recentFailures[0].targetType).toBe('character')
    expect(poll.recentFailures[0].suggestion).toBeTruthy()

    expect(poll.recentFailures[1].id).toBe('gen-balance')
    expect(poll.recentFailures[1].failureKind).toBe('balance')
    expect(poll.recentFailures[1].retryCount).toBe(2)

    expect(poll.recentFailures[2].id).toBe('gen-cancel')
    expect(poll.recentFailures[2].failureKind).toBe('cancel')
  })

  it('costSummary 按阶段聚合成本（generation_records + canvas_assets 多阶段）', async () => {
    const projectRow = makeProjectRow({ status: 'generating' })
    mockGetCanvasProjectByIdForAccount.mockResolvedValue(projectRow)
    mockGetCanvasProjectById.mockResolvedValue(projectRow)
    mockGetCanvasProjectDetail.mockResolvedValue({
      project: projectRow,
      characters: [],
      locations: [],
      shots: [],
      latestContinuity: null,
    })
    // 视频管线：一条进行中（estimated）、一条成功（final）
    mockListCanvasGenerationRecordsByProject.mockResolvedValue([
      { id: 'gen-active', category: 'video', status: 'processing', totalPriceCents: 100, cost: null, shotId: null },
      { id: 'gen-done', category: 'video', status: 'succeeded', totalPriceCents: 200, cost: null, shotId: null },
    ])
    mockListActiveCanvasAssetsByProject.mockResolvedValue([])
    // 前置阶段终态资产：角色参考图、场景参考图、分镜
    mockListTerminalCanvasAssetsByProject.mockResolvedValue([
      { id: 'a-portrait', category: 'characterPortrait', targetEntityType: 'character', targetEntityId: 'char-1', status: 'succeeded', totalPriceCents: 40 },
      { id: 'a-locref', category: 'locationRef', targetEntityType: 'location', targetEntityId: 'loc-1', status: 'succeeded', totalPriceCents: 30 },
      { id: 'a-story', category: 'storyboard', targetEntityType: 'project', targetEntityId: 'proj-001', status: 'succeeded', totalPriceCents: 20 },
      // 失败资产计入 failedCents
      { id: 'a-fail', category: 'characterTurnaround', targetEntityType: 'character', targetEntityId: 'char-1', status: 'failed', totalPriceCents: 15 },
    ])

    const res = await client.api.canvas.projects({ projectId: 'proj-001' }).assets.poll.get(headers)
    const data = extractEdenData(res)
    const summary = data.data.costSummary

    // 总额：estimated=100, final=200+40+30+20=290, failed=15
    expect(summary.totalEstimatedCents).toBe(100)
    expect(summary.totalFinalCents).toBe(290)
    expect(summary.totalFailedCents).toBe(15)

    // 视频阶段：estimated 100 + final 200（两条记录）
    expect(summary.byPhase.videos).toEqual({ estimatedCents: 100, finalCents: 200, failedCents: 0, count: 2 })
    // 角色参考图阶段：characterPortrait(final 40) + characterTurnaround(failed 15)
    expect(summary.byPhase.characterRefs).toEqual({ estimatedCents: 0, finalCents: 40, failedCents: 15, count: 2 })
    // 场景参考图阶段
    expect(summary.byPhase.locationRefs).toEqual({ estimatedCents: 0, finalCents: 30, failedCents: 0, count: 1 })
    // 分镜阶段
    expect(summary.byPhase.storyboard).toEqual({ estimatedCents: 0, finalCents: 20, failedCents: 0, count: 1 })
    // 未涉及的阶段不应出现
    expect(summary.byPhase.analyze).toBeUndefined()
    expect(summary.byPhase.continuity).toBeUndefined()
  })
})
