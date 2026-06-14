import type { CanvasAssetRow, GenerationRecordRow, UploadedFileRow } from '@excuse/db'
import type { AssetLibraryItem } from '@excuse/shared'
import { treaty } from '@elysia/eden'
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'

/**
 * 统一资产中心路由测试 — GET /api/assets
 *
 * Mock @excuse/db 的三个 list 函数，验证：
 *   - 认证守卫（401）
 *   - accountId 隔离（mock 收到当前 userId）
 *   - source/kind/status/projectId 过滤
 *   - 三种来源合并、canvas_assets.previewUrl 使用 publicUrl
 */

import { createAssetsRoutes } from '../src/routes/assets'
import { extractEdenError, makeRecord, makeTestConfig, makeUploadedFile, signTestToken } from './helpers/test-factory'

// ─── Mocks ───────────────────────────────────────────────

const mockListGenRecords = mock<(filter: Record<string, unknown>) => Promise<GenerationRecordRow[]>>(() => Promise.resolve([]))
const mockListCanvasAssets = mock<(accountId: string, filter: Record<string, unknown>) => Promise<CanvasAssetRow[]>>(() => Promise.resolve([]))
const mockListUploadedFiles = mock<(accountId: string, filter: Record<string, unknown>) => Promise<UploadedFileRow[]>>(() => Promise.resolve([]))
const mockGetGenerationRecordByIdForAccount = mock<() => Promise<GenerationRecordRow | null>>(() => Promise.resolve(null))
const mockGetCanvasAssetByIdForAccount = mock<() => Promise<CanvasAssetRow | null>>(() => Promise.resolve(null))
const mockHideGenerationRecord = mock<() => Promise<{ id: string, hiddenAt: Date } | null>>(() => Promise.resolve({ id: 'rec-1', hiddenAt: new Date() }))
const mockHideCanvasAsset = mock<() => Promise<{ id: string, hiddenAt: Date } | null>>(() => Promise.resolve({ id: 'asset-1', hiddenAt: new Date() }))
const mockListAssetFavoriteKeys = mock<(accountId: string) => Promise<Array<{ source: 'generation_record' | 'canvas_asset' | 'uploaded_file', assetId: string }>>>(() => Promise.resolve([]))
const mockAddAssetFavorite = mock<() => Promise<{ id: 'fav-1', accountId: 'acc-001', source: 'generation_record', assetId: 'rec-1', createdAt: Date }>>(() => Promise.resolve({ id: 'fav-1', accountId: 'acc-001', source: 'generation_record', assetId: 'rec-1', createdAt: new Date() }))
const mockRemoveAssetFavorite = mock<() => Promise<void>>(() => Promise.resolve())
const mockListAssetTags = mock<(accountId: string) => Promise<Array<{ id: string, accountId: string, name: string, createdAt: Date }>>>(() => Promise.resolve([]))
const mockFindAssetTagById = mock<() => Promise<{ id: string, accountId: string, name: string, createdAt: Date } | null>>(() => Promise.resolve(null))
const mockListAssetTagKeys = mock<(accountId: string) => Promise<Array<{ tagId: string, source: 'generation_record' | 'canvas_asset' | 'uploaded_file', assetId: string }>>>(() => Promise.resolve([]))
const mockAssignAssetTag = mock<() => Promise<void>>(() => Promise.resolve())
const mockUnassignAssetTag = mock<() => Promise<void>>(() => Promise.resolve())

mock.module('@excuse/db', () => ({
  listGenerationRecords: mockListGenRecords,
  listCanvasAssetsForLibrary: mockListCanvasAssets,
  listUploadedFilesForAccount: mockListUploadedFiles,
  getGenerationRecordByIdForAccount: mockGetGenerationRecordByIdForAccount,
  getCanvasAssetByIdForAccount: mockGetCanvasAssetByIdForAccount,
  hideGenerationRecord: mockHideGenerationRecord,
  hideCanvasAsset: mockHideCanvasAsset,
  listAssetFavoriteKeys: mockListAssetFavoriteKeys,
  addAssetFavorite: mockAddAssetFavorite,
  removeAssetFavorite: mockRemoveAssetFavorite,
  listAssetTags: mockListAssetTags,
  findAssetTagById: mockFindAssetTagById,
  listAssetTagKeys: mockListAssetTagKeys,
  assignAssetTag: mockAssignAssetTag,
  unassignAssetTag: mockUnassignAssetTag,
}))

mock.module('../src/services/audit', () => ({
  audit: () => {},
}))

// ─── 测试配置 ────────────────────────────────────────────

const testConfig = makeTestConfig({ jwtSecret: 'test-assets-secret' })

async function getAuthToken(): Promise<string> {
  return signTestToken(testConfig.jwtSecret, 'acc-001')
}

// ─── Fixture 构造器 ──────────────────────────────────────

function makeCanvasAsset(overrides: Partial<CanvasAssetRow>): CanvasAssetRow {
  return {
    id: 'asset-001',
    accountId: 'acc-001',
    projectId: 'proj-001',
    category: 'characterPortrait',
    targetEntityType: 'character',
    targetEntityId: 'char-001',
    status: 'succeeded',
    model: 'wanx2.1-imgen3',
    pipelineRunId: null,
    taskId: null,
    inputJson: { prompt: '英雄肖像' },
    outputJson: null,
    publicUrl: 'https://cdn.local/portrait.png',
    storagePath: 'canvas/portrait.png',
    providerUrl: 'https://temp-dashscope.local/x.png',
    cost: null,
    totalPriceCents: 50,
    errorMessage: null,
    isActive: true,
    locked: false,
    createdAt: new Date('2024-06-01T10:00:00Z'),
    updatedAt: new Date('2024-06-01T10:00:00Z'),
    ...overrides,
  } as CanvasAssetRow
}

const AUTH = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } })

// ─── 测试 ────────────────────────────────────────────────

describe('assets routes', () => {
  let client: ReturnType<typeof treaty>
  let app: ReturnType<typeof createAssetsRoutes>
  let token: string

  beforeAll(async () => {
    token = await getAuthToken()
  })

  beforeEach(() => {
    mockListGenRecords.mockClear()
    mockListCanvasAssets.mockClear()
    mockListUploadedFiles.mockClear()
    mockGetGenerationRecordByIdForAccount.mockClear()
    mockGetCanvasAssetByIdForAccount.mockClear()
    mockHideGenerationRecord.mockClear()
    mockHideCanvasAsset.mockClear()
    mockListAssetFavoriteKeys.mockClear()
    mockAddAssetFavorite.mockClear()
    mockRemoveAssetFavorite.mockClear()
    mockListAssetTags.mockClear()
    mockFindAssetTagById.mockClear()
    mockListAssetTagKeys.mockClear()
    mockAssignAssetTag.mockClear()
    mockUnassignAssetTag.mockClear()

    // 默认返回空，每个用例按需 mockResolvedValueOnce
    mockListGenRecords.mockResolvedValue([])
    mockListCanvasAssets.mockResolvedValue([])
    mockListUploadedFiles.mockResolvedValue([])
    mockListAssetTags.mockResolvedValue([])
    mockListAssetTagKeys.mockResolvedValue([])
    mockListAssetFavoriteKeys.mockResolvedValue([])

    app = createAssetsRoutes(testConfig)
    client = treaty(app)
  })

  it('未登录时返回 401', async () => {
    const res = await client.api.assets.get()
    const err = extractEdenError(res)
    expect(err).toBeTruthy()
    expect(err!.status).toBe(401)
    expect(mockListGenRecords).not.toHaveBeenCalled()
    expect(mockListCanvasAssets).not.toHaveBeenCalled()
  })

  it('默认合并普通生成记录 + Canvas 资产 + 上传文件', async () => {
    mockListGenRecords.mockResolvedValueOnce([
      makeRecord({ id: 'rec-1', accountId: 'acc-001', category: 'image', status: 'succeeded', totalPriceCents: 10 }),
    ])
    mockListCanvasAssets.mockResolvedValueOnce([makeCanvasAsset({ id: 'asset-1' })])
    mockListUploadedFiles.mockResolvedValueOnce([makeUploadedFile({ id: 'file-1', accountId: 'acc-001' })])

    const { data, error } = await client.api.assets.get({
      query: { limit: 50 },
      ...AUTH(token),
    })

    expect(error).toBeNull()
    expect(data?.success).toBe(true)
    const items = (data as { items: AssetLibraryItem[] }).items
    expect(items).toHaveLength(3)
    const sources = items.map(i => i.source).sort()
    expect(sources).toEqual(['canvas_asset', 'generation_record', 'uploaded_file'])
  })

  it('所有查询按 accountId 隔离（传入当前 userId）', async () => {
    await client.api.assets.get({ ...AUTH(token) })

    expect(mockListGenRecords).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'acc-001' }))
    expect(mockListCanvasAssets).toHaveBeenCalledWith('acc-001', expect.anything())
    expect(mockListUploadedFiles).toHaveBeenCalledWith('acc-001', expect.anything())
  })

  it('source=canvas_asset 只查询并返回 Canvas 资产', async () => {
    mockListCanvasAssets.mockResolvedValueOnce([makeCanvasAsset({ id: 'asset-x' })])

    const { data, error } = await client.api.assets.get({
      query: { source: 'canvas_asset' },
      ...AUTH(token),
    })

    expect(error).toBeNull()
    const items = (data as { items: AssetLibraryItem[] }).items
    expect(items).toHaveLength(1)
    expect(items[0]!.source).toBe('canvas_asset')
    expect(mockListGenRecords).not.toHaveBeenCalled()
    expect(mockListUploadedFiles).not.toHaveBeenCalled()
    expect(mockListCanvasAssets).toHaveBeenCalledTimes(1)
  })

  it('Canvas 资产 previewUrl 使用稳定 publicUrl，不使用 provider 临时 URL', async () => {
    mockListCanvasAssets.mockResolvedValueOnce([makeCanvasAsset({ id: 'asset-img' })])

    const { data } = await client.api.assets.get({
      query: { source: 'canvas_asset' },
      ...AUTH(token),
    })

    const item = (data as { items: AssetLibraryItem[] }).items[0]!
    expect(item.previewUrl).toBe('https://cdn.local/portrait.png')
    expect(item.downloadUrl).toBe('https://cdn.local/portrait.png')
    expect(item.previewUrl).not.toContain('temp-dashscope')
  })

  it('Canvas characterPortrait 映射为 kind=character', async () => {
    mockListCanvasAssets.mockResolvedValueOnce([makeCanvasAsset({ id: 'asset-c', category: 'characterPortrait' })])

    const { data } = await client.api.assets.get({
      query: { source: 'canvas_asset' },
      ...AUTH(token),
    })

    const item = (data as { items: AssetLibraryItem[] }).items[0]!
    expect(item.kind).toBe('character')
    expect(item.projectId).toBe('proj-001')
    expect(item.targetEntityType).toBe('character')
    expect(item.prompt).toBe('英雄肖像')
    expect(item.costCents).toBe(50)
  })

  it('projectId 过滤透传到查询', async () => {
    mockListCanvasAssets.mockResolvedValueOnce([makeCanvasAsset({ id: 'asset-p', projectId: 'proj-999' })])

    const { data } = await client.api.assets.get({
      query: { projectId: 'proj-999' },
      ...AUTH(token),
    })

    expect(mockListGenRecords).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'proj-999' }))
    expect(mockListCanvasAssets).toHaveBeenCalledWith('acc-001', expect.objectContaining({ projectId: 'proj-999' }))
    const item = (data as { items: AssetLibraryItem[] }).items[0]!
    expect(item.projectId).toBe('proj-999')
  })

  it('kind=character 只查询 Canvas 资产（且传入 character 类别预筛）', async () => {
    mockListCanvasAssets.mockResolvedValueOnce([makeCanvasAsset({ id: 'a1', category: 'characterPortrait' })])

    await client.api.assets.get({
      query: { kind: 'character' },
      ...AUTH(token),
    })

    expect(mockListGenRecords).not.toHaveBeenCalled()
    expect(mockListUploadedFiles).not.toHaveBeenCalled()
    expect(mockListCanvasAssets).toHaveBeenCalledWith(
      'acc-001',
      expect.objectContaining({ categories: ['characterPortrait', 'characterTurnaround'] }),
    )
  })

  it('status=succeeded 映射到各来源状态集合', async () => {
    await client.api.assets.get({
      query: { status: 'succeeded' },
      ...AUTH(token),
    })

    expect(mockListGenRecords).toHaveBeenCalledWith(expect.objectContaining({ statuses: ['succeeded'] }))
    expect(mockListCanvasAssets).toHaveBeenCalledWith('acc-001', expect.objectContaining({ statuses: ['succeeded'] }))
    // 上传文件始终 succeeded，status=succeeded 时仍查询
    expect(mockListUploadedFiles).toHaveBeenCalledTimes(1)
  })

  it('status=running 时跳过上传文件（上传无 running 状态）', async () => {
    await client.api.assets.get({
      query: { status: 'running' },
      ...AUTH(token),
    })

    expect(mockListUploadedFiles).not.toHaveBeenCalled()
    expect(mockListGenRecords).toHaveBeenCalledWith(
      expect.objectContaining({ statuses: ['submitting', 'processing', 'saving_output'] }),
    )
    expect(mockListCanvasAssets).toHaveBeenCalledWith('acc-001', expect.objectContaining({ statuses: ['running'] }))
  })

  it('合并后按 createdAt 倒序排序', async () => {
    mockListGenRecords.mockResolvedValueOnce([
      makeRecord({ id: 'old', accountId: 'acc-001', createdAt: new Date('2024-01-01T00:00:00Z') }),
    ])
    mockListCanvasAssets.mockResolvedValueOnce([makeCanvasAsset({ id: 'new', createdAt: new Date('2024-12-01T00:00:00Z') })])

    const { data } = await client.api.assets.get({ ...AUTH(token) })

    const items = (data as { items: AssetLibraryItem[] }).items
    expect(items[0]!.id).toBe('new')
    expect(items[1]!.id).toBe('old')
  })

  // ─── sort 排序 ──────────────────────────────────────────

  describe('GET /api/assets sort', () => {
    // 跨三种来源的固定 fixture：标题混合中英文，创建时间不同。
    // - Apple（gen，最早）
    // - 香蕉（canvas，中段）
    // - Cherry（upload，最新）
    //
    // 期望：
    //   created_desc → Cherry, 香蕉, Apple（newest first）
    //   created_asc  → Apple, 香蕉, Cherry（oldest first）
    //   title_asc    → 香蕉, Apple, Cherry（按本机 ICU localeCompare('zh-CN') 实际顺序：
    //                  CJK 在 Latin 之前，Latin 内部按字典序）
    //   title_desc   → Cherry, Apple, 香蕉（title_asc 的逆序）
    function seedSortFixture() {
      mockListGenRecords.mockResolvedValueOnce([
        makeRecord({ id: 'a', accountId: 'acc-001', model: 'Apple', createdAt: new Date('2024-06-01T00:00:00Z') }),
      ])
      mockListCanvasAssets.mockResolvedValueOnce([
        makeCanvasAsset({ id: 'b', model: '香蕉', createdAt: new Date('2024-06-05T00:00:00Z') }),
      ])
      mockListUploadedFiles.mockResolvedValueOnce([
        makeUploadedFile({ id: 'c', accountId: 'acc-001', fileName: 'Cherry', createdAt: new Date('2024-06-10T00:00:00Z') }),
      ])
    }

    async function fetchItems(querySort?: string) {
      const { data, error } = await client.api.assets.get({
        query: querySort ? { sort: querySort } : {},
        ...AUTH(token),
      })
      expect(error).toBeNull()
      return (data as { items: AssetLibraryItem[] }).items
    }

    it('默认（不传 sort）等价于 created_desc', async () => {
      seedSortFixture()
      const items = await fetchItems()
      expect(items.map(i => i.id)).toEqual(['c', 'b', 'a'])
    })

    it('sort=created_desc 显式传也支持', async () => {
      seedSortFixture()
      const items = await fetchItems('created_desc')
      expect(items.map(i => i.id)).toEqual(['c', 'b', 'a'])
    })

    it('sort=created_asc 最早创建在前', async () => {
      seedSortFixture()
      const items = await fetchItems('created_asc')
      expect(items.map(i => i.id)).toEqual(['a', 'b', 'c'])
    })

    it('sort=title_asc 标题升序（localeCompare zh-CN：CJK 在 Latin 之前）', async () => {
      seedSortFixture()
      const items = await fetchItems('title_asc')
      expect(items.map(i => i.id)).toEqual(['b', 'a', 'c'])
    })

    it('sort=title_desc 标题降序（title_asc 的逆序）', async () => {
      seedSortFixture()
      const items = await fetchItems('title_desc')
      expect(items.map(i => i.id)).toEqual(['c', 'a', 'b'])
    })

    it('sort=invalid_value 静默回落到 created_desc（不返回 400）', async () => {
      seedSortFixture()
      const items = await fetchItems('totally-invalid')
      expect(items.map(i => i.id)).toEqual(['c', 'b', 'a'])
    })
  })

  it('model 过滤透传到 generation/canvas 查询，且跳过 uploaded_files（无 model 列）', async () => {
    await client.api.assets.get({
      query: { model: 'wanx2.1-imgen3' },
      ...AUTH(token),
    })

    expect(mockListGenRecords).toHaveBeenCalledWith(expect.objectContaining({ model: 'wanx2.1-imgen3' }))
    expect(mockListCanvasAssets).toHaveBeenCalledWith('acc-001', expect.objectContaining({ model: 'wanx2.1-imgen3' }))
    expect(mockListUploadedFiles).not.toHaveBeenCalled()
  })

  it('createdFrom/createdTo 透传到三种来源查询（解析为 Date）', async () => {
    await client.api.assets.get({
      query: { createdFrom: '2026-06-01', createdTo: '2026-06-14' },
      ...AUTH(token),
    })

    const from = new Date('2026-06-01')
    const to = new Date('2026-06-14')
    expect(mockListGenRecords).toHaveBeenCalledWith(expect.objectContaining({ createdFrom: from, createdTo: to }))
    expect(mockListCanvasAssets).toHaveBeenCalledWith('acc-001', expect.objectContaining({ createdFrom: from, createdTo: to }))
    expect(mockListUploadedFiles).toHaveBeenCalledWith('acc-001', expect.objectContaining({ createdFrom: from, createdTo: to }))
  })

  it('非法 createdFrom 被忽略（不进入查询条件）', async () => {
    await client.api.assets.get({
      query: { createdFrom: 'not-a-date' },
      ...AUTH(token),
    })

    expect(mockListGenRecords).toHaveBeenCalledWith(expect.not.objectContaining({ createdFrom: expect.any(Date) }))
  })

  it('limit 超过上限被 clamp 到 200', async () => {
    await client.api.assets.get({
      query: { limit: 9999 },
      ...AUTH(token),
    })

    expect(mockListGenRecords).toHaveBeenCalledWith(expect.objectContaining({ limit: 200 }))
    expect(mockListCanvasAssets).toHaveBeenCalledWith('acc-001', expect.objectContaining({ limit: 200 }))
    expect(mockListUploadedFiles).toHaveBeenCalledWith('acc-001', expect.objectContaining({ limit: 200 }))
  })

  it('offset 负数被 clamp 到 0', async () => {
    await client.api.assets.get({
      query: { offset: -50 },
      ...AUTH(token),
    })

    expect(mockListGenRecords).toHaveBeenCalledWith(expect.objectContaining({ offset: 0 }))
  })

  it('source=uploaded_file&status=running 返回空且不查询任何来源（上传无 running 状态）', async () => {
    const { data, error } = await client.api.assets.get({
      query: { source: 'uploaded_file', status: 'running' },
      ...AUTH(token),
    })

    expect(error).toBeNull()
    expect((data as { items: AssetLibraryItem[] }).items).toHaveLength(0)
    expect(mockListGenRecords).not.toHaveBeenCalled()
    expect(mockListCanvasAssets).not.toHaveBeenCalled()
    expect(mockListUploadedFiles).not.toHaveBeenCalled()
  })

  it('返回条数 >= limit 时 hasMore=true（轻量分页）', async () => {
    mockListGenRecords.mockResolvedValueOnce([
      makeRecord({ id: 'r1', accountId: 'acc-001' }),
      makeRecord({ id: 'r2', accountId: 'acc-001' }),
    ])

    const { data } = await client.api.assets.get({
      query: { limit: 2 },
      ...AUTH(token),
    })

    expect((data as { hasMore: boolean }).hasMore).toBe(true)
  })

  it('返回条数 < limit 时 hasMore=false', async () => {
    mockListGenRecords.mockResolvedValueOnce([
      makeRecord({ id: 'r1', accountId: 'acc-001' }),
    ])

    const { data } = await client.api.assets.get({
      query: { limit: 10 },
      ...AUTH(token),
    })

    expect((data as { hasMore: boolean }).hasMore).toBe(false)
  })

  // ─── search 关键词搜索 ──────────────────────────────────

  it('search 传给 generation/canvas/upload 三来源查询', async () => {
    await client.api.assets.get({
      query: { search: 'cat' },
      ...AUTH(token),
    })

    expect(mockListGenRecords).toHaveBeenCalledWith(expect.objectContaining({ search: 'cat' }))
    expect(mockListCanvasAssets).toHaveBeenCalledWith('acc-001', expect.objectContaining({ search: 'cat' }))
    expect(mockListUploadedFiles).toHaveBeenCalledWith('acc-001', expect.objectContaining({ search: 'cat' }))
  })

  it('source=uploaded_file&search=xxx 只查 uploaded_files，search 传入', async () => {
    mockListUploadedFiles.mockResolvedValueOnce([makeUploadedFile({ id: 'f1', accountId: 'acc-001' })])

    const { data } = await client.api.assets.get({
      query: { source: 'uploaded_file', search: 'photo' },
      ...AUTH(token),
    })

    expect(mockListGenRecords).not.toHaveBeenCalled()
    expect(mockListCanvasAssets).not.toHaveBeenCalled()
    expect(mockListUploadedFiles).toHaveBeenCalledWith('acc-001', expect.objectContaining({ search: 'photo' }))
    expect((data as { items: AssetLibraryItem[] }).items).toHaveLength(1)
  })

  it('model 非空 + search 非空：gen/canvas 都传 search，uploads 跳过', async () => {
    await client.api.assets.get({
      query: { model: 'wanx2.1', search: 'portrait' },
      ...AUTH(token),
    })

    expect(mockListGenRecords).toHaveBeenCalledWith(expect.objectContaining({ model: 'wanx2.1', search: 'portrait' }))
    expect(mockListCanvasAssets).toHaveBeenCalledWith('acc-001', expect.objectContaining({ model: 'wanx2.1', search: 'portrait' }))
    // model 非空 → uploads 被跳过（无 model 列）
    expect(mockListUploadedFiles).not.toHaveBeenCalled()
  })

  it('search 超长被 trim + clamp 到 120 字符', async () => {
    const longSearch = 'a'.repeat(200)
    await client.api.assets.get({
      query: { search: longSearch },
      ...AUTH(token),
    })

    expect(mockListGenRecords).toHaveBeenCalledWith(expect.objectContaining({ search: 'a'.repeat(120) }))
  })

  it('search 空字符串不传入查询条件（等同未传）', async () => {
    await client.api.assets.get({
      query: { search: '' },
      ...AUTH(token),
    })

    expect(mockListGenRecords).toHaveBeenCalledWith(expect.not.objectContaining({ search: expect.anything() }))
    expect(mockListCanvasAssets).toHaveBeenCalledWith('acc-001', expect.not.objectContaining({ search: expect.anything() }))
    expect(mockListUploadedFiles).toHaveBeenCalledWith('acc-001', expect.not.objectContaining({ search: expect.anything() }))
  })

  it('search + projectId 同时存在时两者都下推', async () => {
    await client.api.assets.get({
      query: { search: 'hero', projectId: 'proj-999' },
      ...AUTH(token),
    })

    expect(mockListGenRecords).toHaveBeenCalledWith(expect.objectContaining({ search: 'hero', projectId: 'proj-999' }))
    expect(mockListCanvasAssets).toHaveBeenCalledWith('acc-001', expect.objectContaining({ search: 'hero', projectId: 'proj-999' }))
    expect(mockListUploadedFiles).toHaveBeenCalledWith('acc-001', expect.objectContaining({ search: 'hero' }))
  })

  // ─── 隐藏资产（POST /api/assets/:source/:id/hide）───────────────────────────
  // Eden treaty 无法正确解析 /api/assets/:source/:id/hide（与 GET /api/assets 冲突），
  // 所以用 app.handle(new Request(...)) 直接测试。

  describe('隐藏 generation_record', () => {
    it('成功隐藏后返回 { success: true }', async () => {
      mockGetGenerationRecordByIdForAccount.mockResolvedValueOnce(
        makeRecord({ id: 'rec-1', accountId: 'acc-001', status: 'succeeded' }),
      )
      mockHideGenerationRecord.mockResolvedValueOnce({ id: 'rec-1', hiddenAt: new Date() })

      const res = await app.handle(new Request('http://localhost/api/assets/generation_record/rec-1/hide', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }))
      const body = await res.json()
      expect(res.status).toBe(200)
      expect(body.success).toBe(true)
      expect(mockHideGenerationRecord).toHaveBeenCalledWith('rec-1')
    })

    it('其他用户的 generation_record 不能隐藏（404）', async () => {
      mockGetGenerationRecordByIdForAccount.mockResolvedValueOnce(null)

      const res = await app.handle(new Request('http://localhost/api/assets/generation_record/rec-other/hide', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }))
      expect(res.status).toBe(404)
      expect(mockHideGenerationRecord).not.toHaveBeenCalled()
    })
  })

  describe('隐藏 canvas_asset', () => {
    it('成功隐藏 succeeded 资产后返回 { success: true }', async () => {
      mockGetCanvasAssetByIdForAccount.mockResolvedValueOnce(
        makeCanvasAsset({ id: 'asset-1', accountId: 'acc-001', status: 'succeeded' }),
      )
      mockHideCanvasAsset.mockResolvedValueOnce({ id: 'asset-1', hiddenAt: new Date() })

      const res = await app.handle(new Request('http://localhost/api/assets/canvas_asset/asset-1/hide', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }))
      const body = await res.json()
      expect(res.status).toBe(200)
      expect(body.success).toBe(true)
      expect(mockHideCanvasAsset).toHaveBeenCalledWith('asset-1')
    })

    it('其他用户的 canvas_asset 不能隐藏（404）', async () => {
      mockGetCanvasAssetByIdForAccount.mockResolvedValueOnce(null)

      const res = await app.handle(new Request('http://localhost/api/assets/canvas_asset/asset-other/hide', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }))
      expect(res.status).toBe(404)
      expect(mockHideCanvasAsset).not.toHaveBeenCalled()
    })

    it('queued 的 canvas_asset 隐藏返回 409', async () => {
      mockGetCanvasAssetByIdForAccount.mockResolvedValueOnce(
        makeCanvasAsset({ id: 'asset-q', accountId: 'acc-001', status: 'queued' }),
      )

      const res = await app.handle(new Request('http://localhost/api/assets/canvas_asset/asset-q/hide', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }))
      expect(res.status).toBe(409)
      expect(mockHideCanvasAsset).not.toHaveBeenCalled()
    })

    it('running 的 canvas_asset 隐藏返回 409', async () => {
      mockGetCanvasAssetByIdForAccount.mockResolvedValueOnce(
        makeCanvasAsset({ id: 'asset-r', accountId: 'acc-001', status: 'running' }),
      )

      const res = await app.handle(new Request('http://localhost/api/assets/canvas_asset/asset-r/hide', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }))
      expect(res.status).toBe(409)
      expect(mockHideCanvasAsset).not.toHaveBeenCalled()
    })
  })

  describe('隐藏参数校验', () => {
    it('source=uploaded_file 不支持隐藏（参数校验失败）', async () => {
      const res = await app.handle(new Request('http://localhost/api/assets/uploaded_file/file-1/hide', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }))
      // Elysia validates params against t.Union([t.Literal(...)]), rejects 'uploaded_file'
      expect(res.status).toBe(422)
    })
  })

  // ─── 收藏（GET /api/assets?favorite + POST/DELETE /api/assets/:source/:id/favorite）

  describe('GET /api/assets favorite 过滤与 isFavorite 注入', () => {
    it('favorite=true 时只返回当前用户已收藏的资产，isFavorite 全为 true', async () => {
      mockListGenRecords.mockResolvedValueOnce([
        makeRecord({ id: 'rec-fav', accountId: 'acc-001' }),
        makeRecord({ id: 'rec-other', accountId: 'acc-001' }),
      ])
      mockListAssetFavoriteKeys.mockResolvedValueOnce([
        { source: 'generation_record', assetId: 'rec-fav' },
      ])

      const { data, error } = await client.api.assets.get({
        query: { favorite: true },
        ...AUTH(token),
      })

      expect(error).toBeNull()
      const items = (data as { items: AssetLibraryItem[] }).items
      expect(items).toHaveLength(1)
      expect(items[0]!.id).toBe('rec-fav')
      expect(items[0]!.isFavorite).toBe(true)
    })

    it('不传 favorite 时返回全部资产，isFavorite 字段反映实际状态', async () => {
      mockListGenRecords.mockResolvedValueOnce([
        makeRecord({ id: 'rec-fav', accountId: 'acc-001' }),
        makeRecord({ id: 'rec-other', accountId: 'acc-001' }),
      ])
      mockListAssetFavoriteKeys.mockResolvedValueOnce([
        { source: 'generation_record', assetId: 'rec-fav' },
      ])

      const { data, error } = await client.api.assets.get({ ...AUTH(token) })

      expect(error).toBeNull()
      const items = (data as { items: AssetLibraryItem[] }).items
      expect(items).toHaveLength(2)
      const fav = items.find(i => i.id === 'rec-fav')
      const other = items.find(i => i.id === 'rec-other')
      expect(fav?.isFavorite).toBe(true)
      expect(other?.isFavorite).toBe(false)
    })

    it('跨用户隔离：当前用户的 favoriteSet 不包含其他用户的收藏', async () => {
      mockListGenRecords.mockResolvedValueOnce([
        makeRecord({ id: 'rec-1', accountId: 'acc-001' }),
      ])
      // mockListAssetFavoriteKeys 应始终按 userId 查询 — 此处返回空集
      mockListAssetFavoriteKeys.mockResolvedValueOnce([])

      const { data } = await client.api.assets.get({ ...AUTH(token) })

      const items = (data as { items: AssetLibraryItem[] }).items
      expect(items[0]!.isFavorite).toBe(false)
      // 确认 listAssetFavoriteKeys 以当前 userId 调用
      expect(mockListAssetFavoriteKeys).toHaveBeenCalledWith('acc-001')
    })

    it('listAssetFavoriteKeys 与三个来源查询并行调用（同时下推）', async () => {
      await client.api.assets.get({ ...AUTH(token) })

      // favoriteKeys 应该只调用一次，不分多次
      expect(mockListAssetFavoriteKeys).toHaveBeenCalledTimes(1)
      expect(mockListAssetFavoriteKeys).toHaveBeenCalledWith('acc-001')
    })
  })

  describe('POST /api/assets/:source/:id/favorite', () => {
    it('POST generation_record 收藏 → 200，data.isFavorite=true', async () => {
      const res = await app.handle(new Request('http://localhost/api/assets/generation_record/rec-1/favorite', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }))
      const body = await res.json()
      expect(res.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.isFavorite).toBe(true)
      expect(mockAddAssetFavorite).toHaveBeenCalledWith({ accountId: 'acc-001', source: 'generation_record', assetId: 'rec-1' })
    })

    it('POST canvas_asset 收藏 → 200', async () => {
      const res = await app.handle(new Request('http://localhost/api/assets/canvas_asset/asset-1/favorite', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }))
      expect(res.status).toBe(200)
      expect(mockAddAssetFavorite).toHaveBeenCalledWith({ accountId: 'acc-001', source: 'canvas_asset', assetId: 'asset-1' })
    })

    it('POST uploaded_file 收藏 → 200', async () => {
      const res = await app.handle(new Request('http://localhost/api/assets/uploaded_file/file-1/favorite', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }))
      expect(res.status).toBe(200)
      expect(mockAddAssetFavorite).toHaveBeenCalledWith({ accountId: 'acc-001', source: 'uploaded_file', assetId: 'file-1' })
    })

    it('POST 幂等：再次调用仍返回 200，isFavorite=true', async () => {
      const res1 = await app.handle(new Request('http://localhost/api/assets/generation_record/rec-1/favorite', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }))
      const res2 = await app.handle(new Request('http://localhost/api/assets/generation_record/rec-1/favorite', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }))
      expect(res1.status).toBe(200)
      expect(res2.status).toBe(200)
      const body2 = await res2.json()
      expect(body2.data.isFavorite).toBe(true)
    })

    it('POST 非法 source（如 invalid_source）→ 422 参数校验失败', async () => {
      const res = await app.handle(new Request('http://localhost/api/assets/invalid_source/x/favorite', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }))
      expect(res.status).toBe(422)
      expect(mockAddAssetFavorite).not.toHaveBeenCalled()
    })
  })

  describe('DELETE /api/assets/:source/:id/favorite', () => {
    it('DELETE generation_record 取消收藏 → 200，data.isFavorite=false', async () => {
      const res = await app.handle(new Request('http://localhost/api/assets/generation_record/rec-1/favorite', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }))
      const body = await res.json()
      expect(res.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.isFavorite).toBe(false)
      expect(mockRemoveAssetFavorite).toHaveBeenCalledWith({ accountId: 'acc-001', source: 'generation_record', assetId: 'rec-1' })
    })

    it('DELETE 幂等：取消不存在的收藏仍返回 200', async () => {
      const res = await app.handle(new Request('http://localhost/api/assets/generation_record/non-existent/favorite', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.isFavorite).toBe(false)
    })

    it('DELETE 非法 source → 422', async () => {
      const res = await app.handle(new Request('http://localhost/api/assets/invalid_source/x/favorite', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }))
      expect(res.status).toBe(422)
      expect(mockRemoveAssetFavorite).not.toHaveBeenCalled()
    })
  })

  // ─── 标签过滤 + tagNames 注入 + assign/unassign ─────────────────────────────

  describe('GET /api/assets tagIds filter + tagNames 注入', () => {
    it('tagIds 过滤（OR 关系）：只返回打了指定 tagId 之一的资产', async () => {
      mockListGenRecords.mockResolvedValueOnce([
        makeRecord({ id: 'rec-tagged', accountId: 'acc-001' }),
        makeRecord({ id: 'rec-untagged', accountId: 'acc-001' }),
      ])
      mockListAssetTags.mockResolvedValueOnce([
        { id: 'tag-1', accountId: 'acc-001', name: '高亮', createdAt: new Date() },
        { id: 'tag-2', accountId: 'acc-001', name: '草稿', createdAt: new Date() },
      ])
      mockListAssetTagKeys.mockResolvedValueOnce([
        { tagId: 'tag-1', source: 'generation_record', assetId: 'rec-tagged' },
      ])

      const { data, error } = await client.api.assets.get({
        query: { tagIds: 'tag-1,tag-2' },
        ...AUTH(token),
      })

      expect(error).toBeNull()
      const items = (data as { items: AssetLibraryItem[] }).items
      expect(items).toHaveLength(1)
      expect(items[0]!.id).toBe('rec-tagged')
      expect(items[0]!.tagNames).toEqual(['高亮'])
    })

    it('不传 tagIds 时返回全部资产，tagNames 反映实际打的标签', async () => {
      mockListGenRecords.mockResolvedValueOnce([
        makeRecord({ id: 'rec-t1', accountId: 'acc-001' }),
        makeRecord({ id: 'rec-none', accountId: 'acc-001' }),
      ])
      mockListAssetTags.mockResolvedValueOnce([
        { id: 'tag-1', accountId: 'acc-001', name: '高亮', createdAt: new Date() },
        { id: 'tag-2', accountId: 'acc-001', name: '草稿', createdAt: new Date() },
      ])
      mockListAssetTagKeys.mockResolvedValueOnce([
        { tagId: 'tag-1', source: 'generation_record', assetId: 'rec-t1' },
        { tagId: 'tag-2', source: 'generation_record', assetId: 'rec-t1' },
      ])

      const { data } = await client.api.assets.get({ ...AUTH(token) })

      const items = (data as { items: AssetLibraryItem[] }).items
      expect(items).toHaveLength(2)
      const t1 = items.find(i => i.id === 'rec-t1')!
      const none = items.find(i => i.id === 'rec-none')!
      // tagNames 按服务端 tagNameMap 解析；顺序由 assignmentKeys 顺序决定
      expect(t1.tagNames.sort()).toEqual(['草稿', '高亮'])
      expect(none.tagNames).toEqual([])
    })

    it('跨用户隔离：当前用户看不到其他用户的标签 / 打标', async () => {
      mockListGenRecords.mockResolvedValueOnce([
        makeRecord({ id: 'rec-1', accountId: 'acc-001' }),
      ])
      // mockListAssetTags / mockListAssetTagKeys 应始终按 userId 查询 — 这里返回空
      mockListAssetTags.mockResolvedValueOnce([])
      mockListAssetTagKeys.mockResolvedValueOnce([])

      const { data } = await client.api.assets.get({ ...AUTH(token) })

      const items = (data as { items: AssetLibraryItem[] }).items
      expect(items[0]!.tagNames).toEqual([])
      expect(mockListAssetTags).toHaveBeenCalledWith('acc-001')
      expect(mockListAssetTagKeys).toHaveBeenCalledWith('acc-001')
    })

    it('tagNames 默认为空数组（route 始终注入）', async () => {
      mockListGenRecords.mockResolvedValueOnce([
        makeRecord({ id: 'rec-1', accountId: 'acc-001' }),
      ])

      const { data } = await client.api.assets.get({ ...AUTH(token) })

      const items = (data as { items: AssetLibraryItem[] }).items
      expect(items[0]!.tagNames).toEqual([])
    })
  })

  describe('POST /api/assets/:source/:id/tags/:tagId', () => {
    it('POST assign（tagId 属于当前用户）→ 200', async () => {
      mockFindAssetTagById.mockResolvedValueOnce({
        id: 'tag-1',
        accountId: 'acc-001',
        name: '高亮',
        createdAt: new Date(),
      })

      const res = await app.handle(new Request('http://localhost/api/assets/generation_record/rec-1/tags/tag-1', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }))
      const body = await res.json()
      expect(res.status).toBe(200)
      expect(body.success).toBe(true)
      expect(mockAssignAssetTag).toHaveBeenCalledWith({
        accountId: 'acc-001',
        tagId: 'tag-1',
        source: 'generation_record',
        assetId: 'rec-1',
      })
    })

    it('POST assign 不存在的 tagId → 404', async () => {
      mockFindAssetTagById.mockResolvedValueOnce(null)

      const res = await app.handle(new Request('http://localhost/api/assets/generation_record/rec-1/tags/missing', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }))
      expect(res.status).toBe(404)
      expect(mockAssignAssetTag).not.toHaveBeenCalled()
    })

    it('POST assign 非法 source → 422', async () => {
      const res = await app.handle(new Request('http://localhost/api/assets/invalid_source/x/tags/tag-1', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }))
      expect(res.status).toBe(422)
      expect(mockAssignAssetTag).not.toHaveBeenCalled()
    })
  })

  describe('DELETE /api/assets/:source/:id/tags/:tagId', () => {
    it('DELETE unassign → 200', async () => {
      const res = await app.handle(new Request('http://localhost/api/assets/generation_record/rec-1/tags/tag-1', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }))
      const body = await res.json()
      expect(res.status).toBe(200)
      expect(body.success).toBe(true)
      expect(mockUnassignAssetTag).toHaveBeenCalledWith({
        accountId: 'acc-001',
        tagId: 'tag-1',
        source: 'generation_record',
        assetId: 'rec-1',
      })
    })

    it('DELETE 幂等：未打标的组合也返回 200', async () => {
      const res = await app.handle(new Request('http://localhost/api/assets/canvas_asset/asset-1/tags/non-existent', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }))
      expect(res.status).toBe(200)
    })

    it('DELETE 非法 source → 422', async () => {
      const res = await app.handle(new Request('http://localhost/api/assets/invalid_source/x/tags/tag-1', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }))
      expect(res.status).toBe(422)
      expect(mockUnassignAssetTag).not.toHaveBeenCalled()
    })
  })
})
