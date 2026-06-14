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

mock.module('@excuse/db', () => ({
  listGenerationRecords: mockListGenRecords,
  listCanvasAssetsForLibrary: mockListCanvasAssets,
  listUploadedFilesForAccount: mockListUploadedFiles,
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
  let token: string

  beforeAll(async () => {
    token = await getAuthToken()
  })

  beforeEach(() => {
    mockListGenRecords.mockClear()
    mockListCanvasAssets.mockClear()
    mockListUploadedFiles.mockClear()

    // 默认返回空，每个用例按需 mockResolvedValueOnce
    mockListGenRecords.mockResolvedValue([])
    mockListCanvasAssets.mockResolvedValue([])
    mockListUploadedFiles.mockResolvedValue([])

    const app = createAssetsRoutes(testConfig)
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
})
