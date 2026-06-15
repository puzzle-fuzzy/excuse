import type { CanvasProjectRow } from '@excuse/db'
import type { ServerConfig } from '../src/config'
import { treaty } from '@elysia/eden'
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { extractEdenError, makeValidatedParams } from './helpers/test-factory'

/**
 * Canvas 路由扩展测试
 *
 * 补充 PATCH/DELETE projects、fire-and-forget 管线端点、
 * layout、model-preferences、shots delete/retry 的测试。
 */

// ─── Mock factories ────────────────────────────────────

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

function _makeProjectDetail(projectOverrides: Partial<CanvasProjectRow> = {}): MockCanvasProjectDetail {
  return {
    project: makeProjectRow(projectOverrides),
    characters: [],
    locations: [],
    shots: [],
    latestContinuity: null,
  }
}

// ─── Mocks ───────────────────────────────────────────────

const mockGetCanvasProjectById = mock<() => Promise<CanvasProjectRow | null>>(() => Promise.resolve(null))
const mockGetCanvasProjectDetail = mock<() => Promise<MockCanvasProjectDetail | null>>(() => Promise.resolve(null))
const mockUpdateCanvasProject = mock<(values?: Partial<CanvasProjectRow>) => Promise<CanvasProjectRow>>(() => Promise.resolve(makeProjectRow()))
const mockDeleteCanvasLocationById = mock(() => Promise.resolve(undefined))
const mockDeleteCanvasShotById = mock(() => Promise.resolve(undefined))
const mockGetCanvasProjectByIdForAccount = mock<() => Promise<CanvasProjectRow | null>>(() => Promise.resolve(makeProjectRow()))
const mockGetCanvasCharacterForAccount = mock(() => Promise.resolve({ id: 'char-001' }))
const mockGetCanvasLocationForAccount = mock(() => Promise.resolve({ id: 'loc-001' }))
const mockGetCanvasShotForAccount = mock(() => Promise.resolve({ id: 'shot-001', projectId: 'proj-001' }))
const mockUpdateCanvasCharacter = mock(() => Promise.resolve({ id: 'char-001', name: '新名', updatedAt: new Date() }))
const mockUpdateCanvasLocation = mock(() => Promise.resolve({ id: 'loc-001', updatedAt: new Date() }))
const mockUpdateCanvasShot = mock(() => Promise.resolve({ id: 'shot-001', updatedAt: new Date() }))
const mockListCanvasShotsByProject = mock(() => Promise.resolve([
  { id: 'shot-001', projectId: 'proj-001', referenceAssetsJson: [], characterIdsJson: [], shotIndex: 1 },
  { id: 'shot-002', projectId: 'proj-001', referenceAssetsJson: [], characterIdsJson: [], shotIndex: 2 },
  { id: 'shot-003', projectId: 'proj-001', referenceAssetsJson: [], characterIdsJson: [], shotIndex: 3 },
]))
const mockApplyShotReferenceAssets = mock(() => Promise.resolve([
  { shotId: 'shot-002', beforeCount: 0, afterCount: 1, addedCount: 1, truncatedCount: 0 },
  { shotId: 'shot-003', beforeCount: 0, afterCount: 1, addedCount: 1, truncatedCount: 0 },
]))

// ── 参考资产归属校验（v0.3）：account-scoped 查询 mock ──
// 默认返回 null（未找到 / 无权限），各用例按需 override
interface UploadedFileFixture { id: string, mimeType: string | null, publicUrl: string | null }
interface CanvasAssetFixture { id: string, status: string, category: string, publicUrl: string, outputJson: unknown }
interface GenerationRecordFixture { id: string, status: string, category: string, outputResult: unknown }

const mockGetCanvasAssetByIdForAccount = mock<() => Promise<CanvasAssetFixture | null>>(() => Promise.resolve(null))
const mockGetGenerationRecordByIdForAccount = mock<() => Promise<GenerationRecordFixture | null>>(() => Promise.resolve(null))
const mockGetUploadedFileByIdForAccount = mock<() => Promise<UploadedFileFixture | null>>(() => Promise.resolve(null))

mock.module('@excuse/db', () => ({
  createCanvasProject: async () => makeProjectRow(),
  getCanvasProjectById: mockGetCanvasProjectById,
  getCanvasProjectDetail: mockGetCanvasProjectDetail,
  listCanvasProjectsByAccount: async () => [],
  softDeleteCanvasProject: async () => {},
  updateCanvasProject: mockUpdateCanvasProject,
  createCanvasCharacter: async () => ({ id: 'char-001' }),
  getCanvasCharacterById: async () => null,
  updateCanvasCharacter: mockUpdateCanvasCharacter,
  deleteCanvasCharacterById: async () => {},
  deleteCanvasCharactersByProject: async () => {},
  createCanvasLocation: async () => ({ id: 'loc-001' }),
  getCanvasLocationById: async () => null,
  updateCanvasLocation: mockUpdateCanvasLocation,
  deleteCanvasLocationById: mockDeleteCanvasLocationById,
  deleteCanvasLocationsByProject: async () => {},
  createCanvasShot: async () => ({ id: 'shot-001' }),
  batchCreateCanvasShots: async () => [],
  getCanvasShotById: async () => null,
  listCanvasShotsByProject: mockListCanvasShotsByProject,
  updateCanvasShot: mockUpdateCanvasShot,
  deleteCanvasShotsByProject: async () => {},
  deleteCanvasShotById: mockDeleteCanvasShotById,
  getCanvasProjectByIdForAccount: mockGetCanvasProjectByIdForAccount,
  getCanvasCharacterForAccount: mockGetCanvasCharacterForAccount,
  getCanvasLocationForAccount: mockGetCanvasLocationForAccount,
  getCanvasShotForAccount: mockGetCanvasShotForAccount,
  getCanvasAssetByIdForAccount: mockGetCanvasAssetByIdForAccount,
  getGenerationRecordByIdForAccount: mockGetGenerationRecordByIdForAccount,
  getUploadedFileByIdForAccount: mockGetUploadedFileByIdForAccount,
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
  listProjects: async () => [],
  createProject: async (accountId: string, input: { title?: string, storyText: string }) =>
    makeProjectRow({ accountId, title: input.title ?? null, storyText: input.storyText }),
  getProjectDetail: mockGetCanvasProjectDetail,
  softDeleteProject: async () => undefined,
  updateProjectProperties: async (_projectId: string, input: Partial<Pick<CanvasProjectRow, 'title' | 'storyText'>>) =>
    mockUpdateCanvasProject(input),
  updateCharacterData: mockUpdateCanvasCharacter,
  updateLocationData: mockUpdateCanvasLocation,
  updateShotData: mockUpdateCanvasShot,
  deleteCharacter: async () => undefined,
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
  applyShotReferenceAssets: mockApplyShotReferenceAssets,
}))

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
  jwtSecret: 'test-canvas-ext-secret',
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

// ─── 测试 ────────────────────────────────────────────────

describe('canvas 路由 — 扩展', () => {
  let client: ReturnType<typeof treaty>
  let token: string

  beforeAll(async () => {
    token = await getAuthToken()
  })

  beforeEach(() => {
    for (const m of [
      mockGetCanvasProjectById,
      mockGetCanvasProjectDetail,
      mockUpdateCanvasProject,
      mockDeleteCanvasLocationById,
      mockDeleteCanvasShotById,
      mockUpdateCanvasCharacter,
      mockUpdateCanvasLocation,
      mockUpdateCanvasShot,
      mockGetCanvasProjectByIdForAccount,
      mockGetCanvasCharacterForAccount,
      mockGetCanvasLocationForAccount,
      mockGetCanvasShotForAccount,
      mockGetCanvasAssetByIdForAccount,
      mockGetGenerationRecordByIdForAccount,
      mockGetUploadedFileByIdForAccount,
      mockListCanvasShotsByProject,
      mockApplyShotReferenceAssets,
    ]) {
      m.mockClear()
    }

    const app = createCanvasRoutes(testConfig)
    client = treaty(app)
  })

  // ═══════════════════════════════════════════════════
  //  PATCH /projects/:projectId
  // ═══════════════════════════════════════════════════

  describe('PATCH /projects/:projectId', () => {
    it('未登录时返回错误', async () => {
      const res = await client.api.canvas.projects({ projectId: 'proj-001' }).patch({
        title: '新标题',
      })
      const err = extractEdenError(res)
      expect(err).toBeTruthy()
    })

    it('更新项目标题', async () => {
      mockGetCanvasProjectByIdForAccount.mockResolvedValue(makeProjectRow())
      mockGetCanvasProjectById.mockResolvedValue(makeProjectRow())
      mockUpdateCanvasProject.mockResolvedValue(makeProjectRow({ title: '新标题' }))
      const { data } = await client.api.canvas.projects({ projectId: 'proj-001' }).patch(
        { title: '新标题' },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      expect(data?.success).toBe(true)
    })

    it('更新故事文本', async () => {
      mockGetCanvasProjectByIdForAccount.mockResolvedValue(makeProjectRow())
      mockGetCanvasProjectById.mockResolvedValue(makeProjectRow())
      mockUpdateCanvasProject.mockResolvedValue(makeProjectRow({ storyText: '更新后的超过十个字的故事' }))
      const { data } = await client.api.canvas.projects({ projectId: 'proj-001' }).patch(
        { storyText: '更新后的超过十个字的故事' },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      expect(data?.success).toBe(true)
    })

    it('不提供任何字段时返回错误', async () => {
      mockGetCanvasProjectByIdForAccount.mockResolvedValue(makeProjectRow())
      const res = await client.api.canvas.projects({ projectId: 'proj-001' }).patch(
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      )
      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.error).toContain('至少')
    })
  })

  // ═══════════════════════════════════════════════════
  //  Fire-and-forget 管线端点
  // ═══════════════════════════════════════════════════

  const fireAndForgetEndpoints = [
    { name: 'characters', path: 'characters' },
    { name: 'locations', path: 'locations' },
    { name: 'character-refs', path: 'character-refs' },
    { name: 'location-refs', path: 'location-refs' },
    { name: 'storyboard', path: 'storyboard' },
    { name: 'continuity', path: 'continuity' },
    { name: 'rebuild-prompts', path: 'rebuild-prompts' },
    { name: 'generate-videos', path: 'generate-videos' },
  ] as const

  for (const endpoint of fireAndForgetEndpoints) {
    describe(`POST /projects/:projectId/${endpoint.path}`, () => {
      it(`${endpoint.name} 立即返回 accepted + runId`, async () => {
        mockGetCanvasProjectByIdForAccount.mockResolvedValue(makeProjectRow())
        const { data } = await client.api.canvas.projects({ projectId: 'proj-001' })[endpoint.path].post(null, {
          headers: { Authorization: `Bearer ${token}` },
        })
        expect(data?.accepted).toBe(true)
        expect(data?.runId).toBeDefined()
      })
    })
  }

  // ═══════════════════════════════════════════════════
  //  POST /projects/:projectId/layout
  // ═══════════════════════════════════════════════════

  describe('POST /projects/:projectId/layout', () => {
    it('保存画布布局', async () => {
      mockGetCanvasProjectByIdForAccount.mockResolvedValue(makeProjectRow())
      mockGetCanvasProjectById.mockResolvedValue(makeProjectRow())
      mockUpdateCanvasProject.mockResolvedValue(makeProjectRow())
      const { data } = await client.api.canvas.projects({ projectId: 'proj-001' }).layout.post(
        {
          nodes: [{ id: 'n1', type: 'shot', position: { x: 100, y: 200 } }],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      expect(data?.success).toBe(true)
    })
  })

  // ═══════════════════════════════════════════════════
  //  PATCH /projects/:projectId/model-preferences
  // ═══════════════════════════════════════════════════

  describe('PATCH /projects/:projectId/model-preferences', () => {
    it('更新模型偏好', async () => {
      mockGetCanvasProjectByIdForAccount.mockResolvedValue(makeProjectRow())
      mockUpdateCanvasProject.mockResolvedValue(makeProjectRow())
      const { data } = await client.api.canvas.projects({ projectId: 'proj-001' })['model-preferences'].patch(
        { textModel: 'qwen-max', videoModel: 'wan2.1-t2v' },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      expect(data?.success).toBe(true)
    })
  })

  // ═══════════════════════════════════════════════════
  //  DELETE /locations/:locationId
  // ═══════════════════════════════════════════════════

  describe('DELETE /locations/:locationId', () => {
    it('未登录时返回错误', async () => {
      const res = await client.api.canvas.locations({ locationId: 'loc-001' }).delete()
      const err = extractEdenError(res)
      expect(err).toBeTruthy()
    })

    it('登录后删除场景', async () => {
      mockGetCanvasLocationForAccount.mockResolvedValue({ id: 'loc-001' })
      const { data } = await client.api.canvas.locations({ locationId: 'loc-001' }).delete(null, {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(data?.success).toBe(true)
      expect(mockDeleteCanvasLocationById).toHaveBeenCalledWith('loc-001')
    })
  })

  // ═══════════════════════════════════════════════════
  //  DELETE /shots/:shotId
  // ═══════════════════════════════════════════════════

  describe('DELETE /shots/:shotId', () => {
    it('未登录时返回错误', async () => {
      const res = await client.api.canvas.shots({ shotId: 'shot-001' }).delete()
      const err = extractEdenError(res)
      expect(err).toBeTruthy()
    })

    it('登录后删除镜头', async () => {
      mockGetCanvasShotForAccount.mockResolvedValue({ id: 'shot-001', projectId: 'proj-001' })
      const { data } = await client.api.canvas.shots({ shotId: 'shot-001' }).delete(null, {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(data?.success).toBe(true)
      expect(mockDeleteCanvasShotById).toHaveBeenCalledWith('shot-001')
    })
  })

  // ═══════════════════════════════════════════════════
  //  PATCH /shots/:shotId — referenceAssetsJson
  // ═══════════════════════════════════════════════════

  describe('PATCH /shots/:shotId — 参考资产', () => {
    it('未登录时返回错误', async () => {
      const res = await client.api.canvas.shots({ shotId: 'shot-001' }).patch(
        { referenceAssetsJson: [{ assetId: 'a1', url: 'https://img.png', role: 'style' }] },
      )
      const err = extractEdenError(res)
      expect(err).toBeTruthy()
    })

    it('登录后更新参考资产列表（manual URL 归一化后保存）', async () => {
      mockGetCanvasShotForAccount.mockResolvedValue({ id: 'shot-001', projectId: 'proj-001' })
      const { data } = await client.api.canvas.shots({ shotId: 'shot-001' }).patch(
        {
          referenceAssetsJson: [
            { assetId: 'a1', url: 'https://img1.png', role: 'style', label: '风格参考' },
            { assetId: 'a2', url: 'https://img2.png', role: 'character' },
          ],
        },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      expect(data?.success).toBe(true)
      // source 缺省归一化为 manual，空 label 不输出键
      expect(mockUpdateCanvasShot).toHaveBeenCalledWith('shot-001', {
        referenceAssetsJson: [
          { assetId: 'a1', url: 'https://img1.png', role: 'style', label: '风格参考', source: 'manual' },
          { assetId: 'a2', url: 'https://img2.png', role: 'character', source: 'manual' },
        ],
      })
    })

    it('参考资产超过 8 个时被 schema 拒绝', async () => {
      mockGetCanvasShotForAccount.mockResolvedValue({ id: 'shot-001', projectId: 'proj-001' })
      const nineAssets = Array.from({ length: 9 }, (_, i) => ({ assetId: `a${i}`, url: `https://img${i}.png`, role: 'other' as const }))
      const res = await client.api.canvas.shots({ shotId: 'shot-001' }).patch(
        { referenceAssetsJson: nineAssets },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      const err = extractEdenError(res)
      expect(err).toBeTruthy()
    })

    it('无效 role 值时被 schema 拒绝', async () => {
      mockGetCanvasShotForAccount.mockResolvedValue({ id: 'shot-001', projectId: 'proj-001' })
      const res = await client.api.canvas.shots({ shotId: 'shot-001' }).patch(
        { referenceAssetsJson: [{ assetId: 'a1', url: 'https://img.png', role: 'invalid_role' }] },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      const err = extractEdenError(res)
      expect(err).toBeTruthy()
    })
  })

  // ═══════════════════════════════════════════════════
  //  PATCH /shots/:shotId — 参考资产归属校验（v0.3）
  // ═══════════════════════════════════════════════════

  describe('PATCH /shots/:shotId — 参考资产归属校验', () => {
    type RefRole = 'character' | 'location' | 'style' | 'firstFrame' | 'other'
    type RefSource = 'asset_library' | 'uploaded_file' | 'manual'
    interface RefAsset {
      assetId: string
      url: string
      role: RefRole
      label?: string
      source?: RefSource
    }

    // mockUpdateCanvasShot 的工厂箭头无参 → .mock.calls 类型为 [][]，需断言调用参数时强转
    function lastPatchArg(): Record<string, unknown> {
      const calls = mockUpdateCanvasShot.mock.calls as unknown[][]
      const lastCall = calls[calls.length - 1] ?? []
      return lastCall[1] as Record<string, unknown>
    }

    async function patchReferenceAssets(referenceAssetsJson: RefAsset[]) {
      return client.api.canvas.shots({ shotId: 'shot-001' }).patch(
        { referenceAssetsJson },
        { headers: { Authorization: `Bearer ${token}` } },
      )
    }

    beforeEach(() => {
      // 镜头归属通过；三个归属查询默认 null（未找到 / 无权限）
      mockGetCanvasShotForAccount.mockResolvedValue({ id: 'shot-001', projectId: 'proj-001' })
      mockGetCanvasAssetByIdForAccount.mockResolvedValue(null)
      mockGetGenerationRecordByIdForAccount.mockResolvedValue(null)
      mockGetUploadedFileByIdForAccount.mockResolvedValue(null)
    })

    it('当前用户的上传图片文件可作为 uploaded_file 保存', async () => {
      mockGetUploadedFileByIdForAccount.mockResolvedValue({
        id: 'uf-1',
        mimeType: 'image/png',
        publicUrl: 'https://cdn.local/upload.png',
      })
      const { data } = await patchReferenceAssets([
        { assetId: 'uf-1', url: 'https://cdn.local/upload.png', role: 'other', source: 'uploaded_file' },
      ])
      expect(data?.success).toBe(true)
      expect(mockUpdateCanvasShot).toHaveBeenCalledWith('shot-001', {
        referenceAssetsJson: [{ assetId: 'uf-1', url: 'https://cdn.local/upload.png', role: 'other', source: 'uploaded_file' }],
      })
    })

    it('其他用户的上传文件被拒绝（403）', async () => {
      // getUploadedFileByIdForAccount 默认 null（账号隔离查不到）
      const res = await patchReferenceAssets([
        { assetId: 'uf-other', url: 'https://cdn.local/x.png', role: 'other', source: 'uploaded_file' },
      ])
      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.error).toContain('不存在或无权限')
      expect(mockUpdateCanvasShot).not.toHaveBeenCalled()
    })

    it('上传文件 URL 与记录不匹配被拒绝（403）', async () => {
      mockGetUploadedFileByIdForAccount.mockResolvedValue({
        id: 'uf-1',
        mimeType: 'image/png',
        publicUrl: 'https://cdn.local/real.png',
      })
      const res = await patchReferenceAssets([
        { assetId: 'uf-1', url: 'https://cdn.local/fake.png', role: 'other', source: 'uploaded_file' },
      ])
      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.error).toContain('不匹配')
    })

    it('当前用户的 Canvas 图片资产可作为 asset_library 保存', async () => {
      mockGetCanvasAssetByIdForAccount.mockResolvedValue({
        id: 'ca-1',
        status: 'succeeded',
        category: 'characterPortrait',
        publicUrl: 'https://cdn.local/canvas.png',
        outputJson: null,
      })
      const { data } = await patchReferenceAssets([
        { assetId: 'ca-1', url: 'https://cdn.local/canvas.png', role: 'character', source: 'asset_library' },
      ])
      expect(data?.success).toBe(true)
      expect(mockUpdateCanvasShot).toHaveBeenCalledWith('shot-001', {
        referenceAssetsJson: [{ assetId: 'ca-1', url: 'https://cdn.local/canvas.png', role: 'character', source: 'asset_library' }],
      })
    })

    it('其他用户的 Canvas 资产被拒绝（canvas + gen 查询都 miss → 403）', async () => {
      // 两个查询默认 null
      const res = await patchReferenceAssets([
        { assetId: 'ca-other', url: 'https://cdn.local/y.png', role: 'other', source: 'asset_library' },
      ])
      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.error).toContain('不存在或无权限')
      expect(mockUpdateCanvasShot).not.toHaveBeenCalled()
    })

    it('当前用户的成功图片生成记录可作为 asset_library 保存', async () => {
      mockGetGenerationRecordByIdForAccount.mockResolvedValue({
        id: 'gr-1',
        status: 'succeeded',
        category: 'image',
        outputResult: { type: 'image', savedUrls: ['https://cdn.local/gen.png'], urls: [] },
      })
      const { data } = await patchReferenceAssets([
        { assetId: 'gr-1', url: 'https://cdn.local/gen.png', role: 'other', source: 'asset_library' },
      ])
      expect(data?.success).toBe(true)
      expect(mockUpdateCanvasShot).toHaveBeenCalledWith('shot-001', {
        referenceAssetsJson: [{ assetId: 'gr-1', url: 'https://cdn.local/gen.png', role: 'other', source: 'asset_library' }],
      })
    })

    it('失败状态的生成记录被拒绝', async () => {
      mockGetGenerationRecordByIdForAccount.mockResolvedValue({
        id: 'gr-2',
        status: 'failed',
        category: 'image',
        outputResult: { type: 'image', savedUrls: ['https://cdn.local/gen.png'], urls: [] },
      })
      const res = await patchReferenceAssets([
        { assetId: 'gr-2', url: 'https://cdn.local/gen.png', role: 'other', source: 'asset_library' },
      ])
      const err = extractEdenError(res)
      expect(err).toBeTruthy()
    })

    it('非图片类生成记录被拒绝', async () => {
      mockGetGenerationRecordByIdForAccount.mockResolvedValue({
        id: 'gr-3',
        status: 'succeeded',
        category: 'video',
        outputResult: { type: 'video', savedUrls: [], originalUrl: 'https://cdn.local/v.mp4' },
      })
      const res = await patchReferenceAssets([
        { assetId: 'gr-3', url: 'https://cdn.local/v.mp4', role: 'other', source: 'asset_library' },
      ])
      const err = extractEdenError(res)
      expect(err).toBeTruthy()
    })

    it('manual https URL 可保存', async () => {
      const { data } = await patchReferenceAssets([
        { assetId: 'm-1', url: 'https://cdn.local/manual.png', role: 'style', source: 'manual' },
      ])
      expect(data?.success).toBe(true)
      expect(mockUpdateCanvasShot).toHaveBeenCalledWith('shot-001', {
        referenceAssetsJson: [{ assetId: 'm-1', url: 'https://cdn.local/manual.png', role: 'style', source: 'manual' }],
      })
    })

    it('manual javascript:/file:/空 URL 被拒绝', async () => {
      for (const badUrl of ['javascript:alert(1)', 'file:///etc/passwd', '']) {
        const res = await patchReferenceAssets([
          { assetId: `m-${badUrl.length}`, url: badUrl, role: 'other', source: 'manual' },
        ])
        const err = extractEdenError(res)
        expect(err).toBeTruthy()
        expect(err!.error).toContain('URL 不合法')
      }
    })

    it('重复 assetId/url 被服务端去重', async () => {
      // a1/a2 不同 assetId 同 url → url 去重；a3 唯一
      await patchReferenceAssets([
        { assetId: 'a1', url: 'https://cdn.local/dup.png', role: 'other' },
        { assetId: 'a2', url: 'https://cdn.local/dup.png', role: 'other' },
        { assetId: 'a3', url: 'https://cdn.local/uniq.png', role: 'other' },
      ])
      const patch = lastPatchArg()
      const saved = patch.referenceAssetsJson as Array<{ assetId: string }>
      expect(saved).toHaveLength(2)
      expect(saved.map(a => a.assetId)).toEqual(['a1', 'a3'])
    })

    it('未传 referenceAssetsJson 时不影响已有参考资产', async () => {
      const { data } = await client.api.canvas.shots({ shotId: 'shot-001' }).patch(
        { duration: 8 },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      expect(data?.success).toBe(true)
      // undefined → Drizzle .set() 跳过该列，保留原值（不清空）
      expect(lastPatchArg().referenceAssetsJson).toBeUndefined()
    })

    it('传 referenceAssetsJson: [] 清空参考资产', async () => {
      const { data } = await patchReferenceAssets([])
      expect(data?.success).toBe(true)
      expect(lastPatchArg().referenceAssetsJson).toEqual([])
    })
  })

  // ═══════════════════════════════════════════════════
  //  POST /shots/:shotId/retry
  // ═══════════════════════════════════════════════════

  describe('POST /shots/:shotId/retry', () => {
    it('未登录时返回错误', async () => {
      const res = await client.api.canvas.shots({ shotId: 'shot-001' }).retry.post()
      const err = extractEdenError(res)
      expect(err).toBeTruthy()
    })

    it('登录后立即返回成功（fire-and-forget）', async () => {
      mockGetCanvasShotForAccount.mockResolvedValue({ id: 'shot-001', projectId: 'proj-001' })
      const { data } = await client.api.canvas.shots({ shotId: 'shot-001' }).retry.post(null, {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(data?.accepted).toBe(true)
    })
  })

  // ═══════════════════════════════════════════════════
  //  POST /projects/:projectId/shots/reference-assets/apply
  // ═══════════════════════════════════════════════════

  describe('POST /projects/:projectId/shots/reference-assets/apply', () => {
    it('未登录时返回错误', async () => {
      const { data, error } = await client.api.canvas.projects({ projectId: 'proj-001' }).shots['reference-assets']['apply'].post({ // eslint-disable-line dot-notation
        targetShotIds: ['shot-002'],
        referenceAssetsJson: [{ assetId: 'r1', url: 'https://x/r1.png', role: 'character' }],
        mode: 'append',
      })
      const err = extractEdenError({ data, error })
      expect(err).toBeTruthy()
    })

    it('项目不属于当前用户时拒绝', async () => {
      mockGetCanvasProjectByIdForAccount.mockResolvedValue(null)
      const { data, error } = await client.api.canvas.projects({ projectId: 'proj-001' }).shots['reference-assets']['apply'].post({ // eslint-disable-line dot-notation
        targetShotIds: ['shot-002'],
        referenceAssetsJson: [{ assetId: 'r1', url: 'https://x/r1.png', role: 'character' }],
        mode: 'append',
      }, { headers: { Authorization: `Bearer ${token}` } })
      const err = extractEdenError({ data, error })
      expect(err).toBeTruthy()
    })

    it('targetShotIds 不属于该项目时拒绝', async () => {
      mockGetCanvasProjectByIdForAccount.mockResolvedValue(makeProjectRow())
      mockListCanvasShotsByProject.mockResolvedValue([
        { id: 'shot-001', projectId: 'proj-001', referenceAssetsJson: [], characterIdsJson: [], shotIndex: 1 },
      ])
      const { data, error } = await client.api.canvas.projects({ projectId: 'proj-001' }).shots['reference-assets']['apply'].post({ // eslint-disable-line dot-notation
        targetShotIds: ['shot-999'], // 不存在的 shot
        referenceAssetsJson: [{ assetId: 'r1', url: 'https://x/r1.png', role: 'character' }],
        mode: 'append',
      }, { headers: { Authorization: `Bearer ${token}` } })
      const err = extractEdenError({ data, error })
      expect(err).toBeTruthy()
    })

    it('当前用户可以批量应用到同项目多个镜头', async () => {
      mockGetCanvasProjectByIdForAccount.mockResolvedValue(makeProjectRow())
      mockListCanvasShotsByProject.mockResolvedValue([
        { id: 'shot-001', projectId: 'proj-001', referenceAssetsJson: [], characterIdsJson: [], shotIndex: 1 },
        { id: 'shot-002', projectId: 'proj-001', referenceAssetsJson: [], characterIdsJson: [], shotIndex: 2 },
        { id: 'shot-003', projectId: 'proj-001', referenceAssetsJson: [], characterIdsJson: [], shotIndex: 3 },
      ])
      // validateShotReferenceAssetsForAccount mock — 默认 pass through
      mockGetCanvasAssetByIdForAccount.mockResolvedValue(null)
      mockGetGenerationRecordByIdForAccount.mockResolvedValue(null)
      mockGetUploadedFileByIdForAccount.mockResolvedValue(null)

      const { data } = await client.api.canvas.projects({ projectId: 'proj-001' }).shots['reference-assets']['apply'].post({ // eslint-disable-line dot-notation
        targetShotIds: ['shot-002', 'shot-003'],
        referenceAssetsJson: [{ assetId: 'r1', url: 'https://x/r1.png', role: 'character', source: 'manual' }],
        mode: 'append',
      }, { headers: { Authorization: `Bearer ${token}` } })
      expect(data?.success).toBe(true)
      expect(data?.applied).toHaveLength(2)
    })
  })
})
