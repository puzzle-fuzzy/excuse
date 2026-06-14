import type { CanvasProjectRow } from '@excuse/db'
import type { ServerConfig } from '../src/config'
import { treaty } from '@elysia/eden'
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { extractEdenError, makeValidatedParams } from './helpers/test-factory'

/**
 * Canvas 路由测试 — 认证守卫 + CRUD 路径
 *
 * Mock @excuse/db, @excuse/provider, @excuse/billing, @excuse/shared, sse-manager,
 * 测试同步 CRUD 端点的认证和响应格式
 */

// ─── Mock factories（返回带 Date 字段的 row 对象，匹配 mapper 期望） ──

interface MockCanvasProjectDetail {
  project: CanvasProjectRow
  characters: []
  locations: []
  shots: []
  latestContinuity: null
}

function makeProjectRow(overrides: Partial<CanvasProjectRow> = {}): CanvasProjectRow {
  return {
    id: 'proj-001',
    accountId: 'acc-001',
    title: null,
    storyText: '一段超过十个字的故事文本内容',
    status: 'draft' as const,
    analysisJson: null,
    modelPreferencesJson: null,
    canvasLayout: null,
    isDeleted: false,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }
}

function makeProjectDetail(projectOverrides: Partial<CanvasProjectRow> = {}): MockCanvasProjectDetail {
  return {
    project: makeProjectRow(projectOverrides),
    characters: [],
    locations: [],
    shots: [],
    latestContinuity: null,
  }
}

// ─── @excuse/db mock ──────────────────────────────────────

const mockCreateCanvasProject = mock(() => Promise.resolve(makeProjectRow()))
const mockGetCanvasProjectById = mock<() => Promise<CanvasProjectRow | null>>(() => Promise.resolve(null))
const mockGetCanvasProjectDetail = mock<() => Promise<MockCanvasProjectDetail | null>>(() => Promise.resolve(null))
const mockListCanvasProjectsByAccount = mock(() => Promise.resolve([]))
const mockSoftDeleteCanvasProject = mock(() => Promise.resolve(undefined))
const mockUpdateCanvasProject = mock<(values?: Partial<CanvasProjectRow>) => Promise<CanvasProjectRow>>(() => Promise.resolve(makeProjectRow()))
const mockGetCanvasCharacterById = mock(() => Promise.resolve(null))
const mockUpdateCanvasCharacter = mock(() => Promise.resolve({ id: 'char-001', name: '新名', updatedAt: new Date() }))
const mockUpdateCanvasLocation = mock(() => Promise.resolve({ id: 'loc-001', updatedAt: new Date() }))
const mockUpdateCanvasShot = mock(() => Promise.resolve({ id: 'shot-001', updatedAt: new Date() }))
const mockDeleteCanvasCharacterById = mock(() => Promise.resolve(undefined))
const mockDeleteCanvasLocationById = mock(() => Promise.resolve(undefined))
const mockDeleteCanvasShotById = mock(() => Promise.resolve(undefined))
const mockGetCanvasProjectByIdForAccount = mock<() => Promise<ReturnType<typeof makeProjectRow> | null>>(() => Promise.resolve(makeProjectRow()))
const mockGetCanvasCharacterForAccount = mock(() => Promise.resolve({ id: 'char-001' }))
const mockGetCanvasLocationForAccount = mock(() => Promise.resolve({ id: 'loc-001' }))
const mockGetCanvasShotForAccount = mock(() => Promise.resolve({ id: 'shot-001' }))
mock.module('@excuse/db', () => ({
  createCanvasProject: mockCreateCanvasProject,
  getCanvasProjectById: mockGetCanvasProjectById,
  getCanvasProjectDetail: mockGetCanvasProjectDetail,
  listCanvasProjectsByAccount: mockListCanvasProjectsByAccount,
  softDeleteCanvasProject: mockSoftDeleteCanvasProject,
  updateCanvasProject: mockUpdateCanvasProject,
  createCanvasCharacter: async () => ({ id: 'char-001' }),
  getCanvasCharacterById: mockGetCanvasCharacterById,
  updateCanvasCharacter: mockUpdateCanvasCharacter,
  deleteCanvasCharacterById: mockDeleteCanvasCharacterById,
  deleteCanvasCharactersByProject: async () => {},
  createCanvasLocation: async () => ({ id: 'loc-001' }),
  getCanvasLocationById: async () => null,
  updateCanvasLocation: mockUpdateCanvasLocation,
  deleteCanvasLocationById: mockDeleteCanvasLocationById,
  deleteCanvasLocationsByProject: async () => {},
  createCanvasShot: async () => ({ id: 'shot-001' }),
  batchCreateCanvasShots: async () => [],
  getCanvasShotById: async () => null,
  listCanvasShotsByProject: async () => [],
  updateCanvasShot: mockUpdateCanvasShot,
  deleteCanvasShotsByProject: async () => {},
  deleteCanvasShotById: mockDeleteCanvasShotById,
  getCanvasProjectByIdForAccount: mockGetCanvasProjectByIdForAccount,
  getCanvasCharacterForAccount: mockGetCanvasCharacterForAccount,
  getCanvasLocationForAccount: mockGetCanvasLocationForAccount,
  getCanvasShotForAccount: mockGetCanvasShotForAccount,
  resetCanvasShotToDraft: async () => {},
  listPendingVideoShots: async () => [],
  createContinuityReport: async () => ({ id: 'cont-001' }),
  getLatestContinuityReport: async () => null,
  createGenerationRecord: async () => ({ id: 'gen-001' }),
  markGenerationProcessing: async () => {},
  notifyGenerationStatus: async () => {},
  getGenerationRecordsByTaskIds: async () => [],
  pgClient: { listen: async () => {} },
  findActiveRunForPhase: async () => null,
  createPipelineRun: async () => ({ id: 'run-001', projectId: 'proj-001', phase: 'analyze', status: 'pending', createdBy: 'acc-001', createdAt: new Date() }),
  getPipelineRunById: async () => null,
  listPipelineRunsByProject: async () => [],
  markPipelineRunRunning: async () => null,
  markPipelineRunSucceeded: async () => null,
  markPipelineRunFailed: async () => null,
}))

mock.module('@excuse/provider', () => ({
  DashScopeClient: class {
    chatCompletion = async () => ({ success: true, output: { text: 'mock' } })
    generate = async () => ({ success: true, output: { text: 'mock' } })
  },
  AssetStorage: class { downloadAndMap = async (urls: string[]) => urls },
  getModelById: () => ({ id: 'mock', category: 'text', pricing: { inputPriceCents: 100, unit: 'token' }, parameters: [] }),
  mergeWithDefaults: (_modelConfig: unknown, params: Record<string, unknown>) => params,
  validateModelParameters: () => ({ valid: true, errors: [] }),
  validateAndMerge: (_modelConfig: unknown, params: Record<string, unknown>) => ({ ok: true, params: makeValidatedParams(params) }),
}))

mock.module('@excuse/billing', () => ({
  calculateCost: () => ({ unit: 'token', totalPriceCents: 1, totalPrice: 0.01 }),
}))

mock.module('../src/modules/canvas/service', () => ({
  listProjects: mockListCanvasProjectsByAccount,
  createProject: async (accountId: string, input: { title?: string, storyText: string }) =>
    makeProjectRow({ accountId, title: input.title ?? null, storyText: input.storyText }),
  getProjectDetail: mockGetCanvasProjectDetail,
  softDeleteProject: mockSoftDeleteCanvasProject,
  updateProjectProperties: async (_projectId: string, input: Partial<Pick<CanvasProjectRow, 'title' | 'storyText'>>) =>
    mockUpdateCanvasProject(input),
  updateCharacterData: mockUpdateCanvasCharacter,
  updateLocationData: mockUpdateCanvasLocation,
  updateShotData: mockUpdateCanvasShot,
  deleteCharacter: mockDeleteCanvasCharacterById,
  deleteLocation: mockDeleteCanvasLocationById,
  deleteShot: mockDeleteCanvasShotById,
  saveCanvasLayout: async () => undefined,
  updateModelPreferences: mockUpdateCanvasProject,
  analyzeProject: async () => undefined,
  generateCharacters: async () => undefined,
  generateLocations: async () => undefined,
  generateCharacterRefs: async () => undefined,
  generateLocationRefs: async () => undefined,
  generateStoryboard: async () => undefined,
  checkContinuity: async () => undefined,
  rebuildShotPrompts: async () => undefined,
  generateVideos: async () => undefined,
  retryShotVideo: async () => undefined,
  retryFailedShots: async () => undefined,
}))

// 不 mock @excuse/shared — 只包含类型 + logger，不影响测试逻辑
// 不 mock ../src/services/sse-manager — fireAndForget 只做 dispatch，
// 且 mock sse-manager 在并行测试时会干扰 SSE manager 测试的全局 connections Map

// eslint-disable-next-line import/first
import { createCanvasRoutes } from '../src/routes/canvas'

// ─── Config + auth ──────────────────────────────────────

const testConfig: ServerConfig = {
  port: 0,
  databaseUrl: '',
  dashscopeApiKey: 'test-key',
  dashscopeBaseUrl: 'https://test.local',
  storageRoot: '/tmp/test-uploads',
  frontendUrl: '',
  workerPollIntervalMs: 0,
  jwtSecret: 'test-canvas-secret',
  jwtExpiresIn: '1h',
  oss: undefined,
  metricsAccessToken: undefined,
  metricsAllowedCidrs: ['127.0.0.1/32', '::1/128'],
}

async function getAuthToken(): Promise<string> {
  const { Elysia } = await import('elysia')
  const jwtApp = new Elysia()
    .use((await import('@elysia/jwt')).jwt({ name: 'jwt', secret: testConfig.jwtSecret, exp: '1h' }))
    .get('/sign', async ({ jwt }) => jwt.sign({ sub: 'acc-001' }))

  const jwtClient = treaty(jwtApp)
  const { data } = await jwtClient.sign.get()
  return data as unknown as string
}

describe('canvas routes', () => {
  let client: ReturnType<typeof treaty>
  let token: string

  beforeAll(async () => {
    token = await getAuthToken()
  })

  beforeEach(() => {
    mockCreateCanvasProject.mockClear()
    mockGetCanvasProjectDetail.mockClear()
    mockListCanvasProjectsByAccount.mockClear()
    mockSoftDeleteCanvasProject.mockClear()
    mockUpdateCanvasProject.mockClear()
    mockUpdateCanvasCharacter.mockClear()
    mockUpdateCanvasLocation.mockClear()
    mockUpdateCanvasShot.mockClear()
    mockDeleteCanvasCharacterById.mockClear()
    mockGetCanvasProjectByIdForAccount.mockClear()
    mockGetCanvasCharacterForAccount.mockClear()
    mockGetCanvasLocationForAccount.mockClear()
    mockGetCanvasShotForAccount.mockClear()

    const app = createCanvasRoutes(testConfig)
    client = treaty(app)
  })

  // ═══════════════════════════════════════════════════
  //  GET /projects — 列表 + 认证
  // ═══════════════════════════════════════════════════

  describe('GET /projects', () => {
    it('未登录时返回错误', async () => {
      const res = await client.api.canvas.projects.get()
      const err = extractEdenError(res)
      expect(err).toBeTruthy()
    })

    it('登录后返回项目列表', async () => {
      mockGetCanvasProjectDetail.mockResolvedValue(makeProjectDetail())
      const { data } = await client.api.canvas.projects.get({
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(data?.success).toBe(true)
      expect(data?.items).toBeDefined()
    })
  })

  // ═══════════════════════════════════════════════════
  //  POST /projects — 创建项目
  // ═══════════════════════════════════════════════════

  describe('POST /projects', () => {
    it('未登录时返回错误', async () => {
      const res = await client.api.canvas.projects.post({ storyText: '一段超过十个字的故事文本内容' })
      const err = extractEdenError(res)
      expect(err).toBeTruthy()
    })

    it('登录后创建项目', async () => {
      mockCreateCanvasProject.mockResolvedValue(makeProjectRow({ id: 'proj-new' }))
      const { data } = await client.api.canvas.projects.post(
        { storyText: '一段超过十个字的故事文本内容' },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      expect(data?.success).toBe(true)
      expect((data?.data as Record<string, unknown>).storyText).toBe('一段超过十个字的故事文本内容')
    })
  })

  // ═══════════════════════════════════════════════════
  //  GET /projects/:projectId — 详情
  // ═══════════════════════════════════════════════════

  describe('GET /projects/:projectId', () => {
    it('登录后返回项目详情', async () => {
      mockGetCanvasProjectByIdForAccount.mockResolvedValue(makeProjectRow())
      mockGetCanvasProjectDetail.mockResolvedValue(makeProjectDetail())
      const { data } = await client.api.canvas.projects({ projectId: 'proj-001' }).get({
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(data?.success).toBe(true)
      expect(data?.data).toBeDefined()
    })

    it('项目不存在返回错误', async () => {
      mockGetCanvasProjectByIdForAccount.mockResolvedValue(null)
      const res = await client.api.canvas.projects({ projectId: 'nonexistent' }).get({
        headers: { Authorization: `Bearer ${token}` },
      })
      const err = extractEdenError(res)
      expect(err).toBeTruthy()
    })
  })

  // ═══════════════════════════════════════════════════
  //  DELETE /projects/:projectId
  // ═══════════════════════════════════════════════════

  describe('DELETE /projects/:projectId', () => {
    it('登录后软删除项目', async () => {
      mockGetCanvasProjectByIdForAccount.mockResolvedValue(makeProjectRow())
      const { data } = await client.api.canvas.projects({ projectId: 'proj-001' }).delete(null, {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(data?.success).toBe(true)
      expect(mockSoftDeleteCanvasProject).toHaveBeenCalledWith('proj-001')
    })
  })

  // ═══════════════════════════════════════════════════
  //  资源 PATCH
  // ═══════════════════════════════════════════════════

  describe('PATCH /characters/:characterId', () => {
    it('更新角色数据', async () => {
      mockGetCanvasCharacterForAccount.mockResolvedValue({ id: 'char-001' })
      const { data } = await client.api.canvas.characters({ characterId: 'char-001' }).patch(
        { name: '新名' },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      expect(data?.success).toBe(true)
    })
  })

  describe('PATCH /locations/:locationId', () => {
    it('更新场景数据', async () => {
      mockGetCanvasLocationForAccount.mockResolvedValue({ id: 'loc-001' })
      const { data } = await client.api.canvas.locations({ locationId: 'loc-001' }).patch(
        { scenePrompt: '新描述' },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      expect(data?.success).toBe(true)
    })
  })

  describe('PATCH /shots/:shotId', () => {
    it('更新镜头数据', async () => {
      mockGetCanvasShotForAccount.mockResolvedValue({ id: 'shot-001' })
      const { data } = await client.api.canvas.shots({ shotId: 'shot-001' }).patch(
        { narrative: '新叙述' },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      expect(data?.success).toBe(true)
    })
  })

  // ═══════════════════════════════════════════════════
  //  资源 DELETE
  // ═══════════════════════════════════════════════════

  describe('DELETE /characters/:characterId', () => {
    it('登录后删除角色', async () => {
      mockGetCanvasCharacterForAccount.mockResolvedValue({ id: 'char-001' })
      const { data } = await client.api.canvas.characters({ characterId: 'char-001' }).delete(null, {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(data?.success).toBe(true)
      expect(mockDeleteCanvasCharacterById).toHaveBeenCalledWith('char-001')
    })
  })

  // ═══════════════════════════════════════════════════
  //  Fire-and-forget 端点
  // ═══════════════════════════════════════════════════

  describe('POST /projects/:projectId/analyze (fire-and-forget)', () => {
    it('立即返回 accepted + runId', async () => {
      mockGetCanvasProjectById.mockResolvedValue(makeProjectRow())
      const { data } = await client.api.canvas.projects({ projectId: 'proj-001' }).analyze.post(null, {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(data?.accepted).toBe(true)
      expect(data?.runId).toBeDefined()
    })
  })

  describe('POST /shots/:shotId/retry', () => {
    it('立即返回 accepted', async () => {
      mockGetCanvasShotForAccount.mockResolvedValue({ id: 'shot-001' })
      const { data } = await client.api.canvas.shots({ shotId: 'shot-001' }).retry.post(null, {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(data?.accepted).toBe(true)
    })
  })

  describe('POST /projects/:projectId/retry-failed-shots', () => {
    it('立即返回 accepted', async () => {
      mockGetCanvasProjectByIdForAccount.mockResolvedValue(makeProjectRow())
      const { data } = await client.api.canvas.projects({ projectId: 'proj-001' })['retry-failed-shots'].post(null, {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(data?.accepted).toBe(true)
    })
  })
})
