import type { AssetLibraryItem } from '@excuse/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Assets from '../src/pages/Assets'

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('../src/api/client', () => ({
  deleteUploadedFile: vi.fn(),
  updateUploadedFile: vi.fn(),
  listCanvasProjects: vi.fn(),
}))

vi.mock('../src/api/asset-library', () => ({
  queryAssetLibrary: vi.fn(),
  hideAsset: vi.fn(),
  toggleAssetFavorite: vi.fn(),
  listAssetTags: vi.fn(),
  createAssetTag: vi.fn(),
  deleteAssetTag: vi.fn(),
  assignAssetTag: vi.fn(),
  unassignAssetTag: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

const { updateUploadedFile, listCanvasProjects } = await import('../src/api/client')
const {
  queryAssetLibrary,
  toggleAssetFavorite,
  listAssetTags,
  createAssetTag,
  deleteAssetTag,
  assignAssetTag,
  unassignAssetTag,
} = await import('../src/api/asset-library')
const { toast } = await import('sonner')

// ── Fixtures ─────────────────────────────────────────────────────────

function makeItem(overrides: Partial<AssetLibraryItem>): AssetLibraryItem {
  return {
    id: 'item-1',
    source: 'uploaded_file',
    kind: 'upload',
    status: 'succeeded',
    title: '我的上传.png',
    model: null,
    previewUrl: 'https://cdn.local/a.png',
    downloadUrl: 'https://cdn.local/a.png',
    projectId: null,
    targetEntityType: null,
    targetEntityId: null,
    prompt: null,
    costCents: null,
    createdAt: '2024-06-01T00:00:00.000Z',
    isFavorite: false,
    tagNames: [],
    ...overrides,
  }
}

function renderAssets(items: AssetLibraryItem[]) {
  vi.mocked(queryAssetLibrary).mockResolvedValue({
    success: true,
    items,
    total: items.length,
    hasMore: false,
  })
  vi.mocked(listCanvasProjects).mockResolvedValue({ success: true, items: [], total: 0 })
  vi.mocked(listAssetTags).mockResolvedValue([])
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <Assets />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(queryAssetLibrary).mockResolvedValue({ success: true, items: [], total: 0, hasMore: false })
  vi.mocked(listCanvasProjects).mockResolvedValue({ success: true, items: [], total: 0 })
  vi.mocked(listAssetTags).mockResolvedValue([])
})

afterEach(() => {
  cleanup()
})

// ── 测试 ──────────────────────────────────────────────────────────────

describe('assets PreviewModal 编辑入口', () => {
  it('uploaded_file 来源显示「编辑」按钮', async () => {
    const user = userEvent.setup()
    renderAssets([makeItem({ id: 'up-1', source: 'uploaded_file', kind: 'upload', title: '我的上传.png' })])

    // 等列表渲染完成，点击卡片打开 PreviewModal
    const card = await screen.findByText('我的上传.png')
    await user.click(card)

    expect(await screen.findByRole('button', { name: /编辑/ })).toBeInTheDocument()
  })

  it('generation_record 来源不显示「编辑」按钮', async () => {
    const user = userEvent.setup()
    renderAssets([makeItem({
      id: 'gen-1',
      source: 'generation_record',
      kind: 'image',
      title: '生成图片',
    })])

    const card = await screen.findByText('生成图片')
    await user.click(card)

    // 等待 PreviewModal 渲染完成（下载按钮作为已存在标志）
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /编辑/ })).not.toBeInTheDocument()
    })
  })

  it('点击「编辑」打开 Dialog，输入新文件名和用途后保存', async () => {
    const user = userEvent.setup()
    vi.mocked(updateUploadedFile).mockResolvedValue({
      success: true,
      data: {
        id: 'up-1',
        accountId: 'acc',
        fileName: '新名.png',
        fileSize: 1024,
        mimeType: 'image/png',
        storagePath: '/uploads/x.png',
        publicUrl: 'https://cdn.local/a.png',
        purpose: 'avatar',
        metadata: null,
        createdAt: '2024-06-01T00:00:00.000Z',
      },
    })

    renderAssets([makeItem({ id: 'up-1', source: 'uploaded_file', kind: 'upload', title: '原文件.png' })])

    // 打开 PreviewModal
    const card = await screen.findByText('原文件.png')
    await user.click(card)

    // 点击「编辑」打开 Dialog
    const editBtn = await screen.findByRole('button', { name: /编辑/ })
    await user.click(editBtn)

    // Dialog 打开后，文件名输入框应预填原文件名
    const fileNameInput = await screen.findByLabelText('文件名')
    expect(fileNameInput).toHaveValue('原文件.png')

    // 修改文件名 + 填写用途
    await user.clear(fileNameInput)
    await user.type(fileNameInput, '新名.png')
    const purposeInput = screen.getByLabelText('用途')
    await user.type(purposeInput, 'avatar')

    // 保存
    const dialog = fileNameInput.closest('[data-slot="dialog-content"]') ?? document.body
    const saveBtn = within(dialog as HTMLElement).getByRole('button', { name: '保存' })
    await user.click(saveBtn)

    await waitFor(() => {
      expect(updateUploadedFile).toHaveBeenCalledWith('up-1', { fileName: '新名.png', purpose: 'avatar' })
    })
    expect(toast.success).toHaveBeenCalledWith('已保存修改')
  })

  it('保存失败时 Dialog 保留可重试，并 toast 错误', async () => {
    const user = userEvent.setup()
    vi.mocked(updateUploadedFile).mockRejectedValue(new Error('网络错误'))

    renderAssets([makeItem({ id: 'up-2', source: 'uploaded_file', kind: 'upload', title: '失败文件.png' })])

    // 打开 PreviewModal
    const card = await screen.findByText('失败文件.png')
    await user.click(card)

    // 点击「编辑」打开 Dialog
    const editBtn = await screen.findByRole('button', { name: /编辑/ })
    await user.click(editBtn)

    const fileNameInput = await screen.findByLabelText('文件名')
    await user.clear(fileNameInput)
    await user.type(fileNameInput, '尝试重命名.png')

    const dialog = fileNameInput.closest('[data-slot="dialog-content"]') ?? document.body
    const saveBtn = within(dialog as HTMLElement).getByRole('button', { name: '保存' })
    await user.click(saveBtn)

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('网络错误')
    })

    // Dialog 仍然打开（保存按钮仍可点击重试）
    expect(screen.getByLabelText('文件名')).toBeInTheDocument()
    expect(updateUploadedFile).toHaveBeenCalledTimes(1)
  })
})

describe('assets 排序下拉', () => {
  it('默认显示「最新优先」（sort=created_desc）', async () => {
    renderAssets([])

    const sortSelect = await screen.findByLabelText('排序')
    expect(sortSelect).toHaveValue('created_desc')
  })

  it('切换到「标题 A→Z」后 queryAssetLibrary 收到 sort=title_asc', async () => {
    const user = userEvent.setup()
    renderAssets([])

    // 等初始查询完成
    await screen.findByLabelText('排序')

    // 初始默认 sort=created_desc
    expect(vi.mocked(queryAssetLibrary)).toHaveBeenLastCalledWith(expect.objectContaining({
      filters: expect.objectContaining({ sort: 'created_desc' }),
    }))

    // 切换到「标题 A→Z」
    const sortSelect = screen.getByLabelText('排序')
    await user.selectOptions(sortSelect, 'title_asc')

    await waitFor(() => {
      expect(vi.mocked(queryAssetLibrary)).toHaveBeenLastCalledWith(expect.objectContaining({
        filters: expect.objectContaining({ sort: 'title_asc' }),
      }))
    })
  })

  it('切换到「标题 Z→A」后 queryAssetLibrary 收到 sort=title_desc', async () => {
    const user = userEvent.setup()
    renderAssets([])

    await screen.findByLabelText('排序')

    const sortSelect = screen.getByLabelText('排序')
    await user.selectOptions(sortSelect, 'title_desc')

    await waitFor(() => {
      expect(vi.mocked(queryAssetLibrary)).toHaveBeenLastCalledWith(expect.objectContaining({
        filters: expect.objectContaining({ sort: 'title_desc' }),
      }))
    })
  })
})

describe('assets 收藏功能', () => {
  it('「仅看收藏」复选框默认未勾', async () => {
    renderAssets([])

    const favoriteCheckbox = await screen.findByLabelText('仅看收藏')
    expect(favoriteCheckbox).not.toBeChecked()
  })

  it('勾选「仅看收藏」后 filters.favorite=true 并刷新查询', async () => {
    const user = userEvent.setup()
    renderAssets([])

    const favoriteCheckbox = await screen.findByLabelText('仅看收藏')
    await user.click(favoriteCheckbox)

    await waitFor(() => {
      expect(vi.mocked(queryAssetLibrary)).toHaveBeenLastCalledWith(expect.objectContaining({
        filters: expect.objectContaining({ favorite: true }),
      }))
    })
  })

  it('卡片星标按钮在 isFavorite=true 时有黄色填充', async () => {
    renderAssets([makeItem({ id: 'fav-1', title: '已收藏.png', isFavorite: true })])

    const card = await screen.findByText('已收藏.png')
    const favBtn = card.parentElement!.parentElement!.querySelector('button[aria-label="取消收藏"]')!
    expect(favBtn).toBeTruthy()
    const svg = favBtn.querySelector('svg')!
    // fill-yellow-400 → fill class present
    expect(svg.className.baseVal ?? svg.className).toMatch(/fill-yellow-400/)
  })

  it('卡片星标按钮在 isFavorite=false 时无黄色填充', async () => {
    renderAssets([makeItem({ id: 'nofav-1', title: '未收藏.png', isFavorite: false })])

    const card = await screen.findByText('未收藏.png')
    const favBtn = card.parentElement!.parentElement!.querySelector('button[aria-label="收藏"]')!
    expect(favBtn).toBeTruthy()
    const svg = favBtn.querySelector('svg')!
    // 没有 fill-yellow-400
    expect(svg.className.baseVal ?? svg.className).not.toMatch(/fill-yellow-400/)
  })

  it('点击星标按钮（未收藏 → 收藏）调用 toggleAssetFavorite(source, id, true)', async () => {
    const user = userEvent.setup()
    vi.mocked(toggleAssetFavorite).mockResolvedValue(true)
    renderAssets([makeItem({ id: 'to-fav', title: '将收藏.png', isFavorite: false, source: 'generation_record' })])

    const card = await screen.findByText('将收藏.png')
    const favBtn = card.parentElement!.parentElement!.querySelector('button[aria-label="收藏"]') as HTMLButtonElement
    await user.click(favBtn)

    await waitFor(() => {
      expect(toggleAssetFavorite).toHaveBeenCalledWith('generation_record', 'to-fav', true)
    })
  })

  it('点击星标按钮（已收藏 → 取消）调用 toggleAssetFavorite(source, id, false)', async () => {
    const user = userEvent.setup()
    vi.mocked(toggleAssetFavorite).mockResolvedValue(false)
    renderAssets([makeItem({ id: 'to-unfav', title: '将取消.png', isFavorite: true, source: 'canvas_asset' })])

    const card = await screen.findByText('将取消.png')
    const favBtn = card.parentElement!.parentElement!.querySelector('button[aria-label="取消收藏"]') as HTMLButtonElement
    await user.click(favBtn)

    await waitFor(() => {
      expect(toggleAssetFavorite).toHaveBeenCalledWith('canvas_asset', 'to-unfav', false)
    })
  })
})

describe('assets 标签功能', () => {
  it('卡片显示 tagNames（前 3 个 Badge）', async () => {
    renderAssets([makeItem({
      id: 'tagged-1',
      title: '带标签.png',
      tagNames: ['高亮', '草稿'],
    })])

    await screen.findByText('带标签.png')
    expect(screen.getByText('高亮')).toBeInTheDocument()
    expect(screen.getByText('草稿')).toBeInTheDocument()
  })

  it('卡片超过 3 个标签 → 显示 +N', async () => {
    renderAssets([makeItem({
      id: 'many-tags',
      title: '多标签.png',
      tagNames: ['t1', 't2', 't3', 't4', 't5'],
    })])

    await screen.findByText('多标签.png')
    expect(screen.getByText('+2')).toBeInTheDocument()
  })

  it('卡片标签按钮 aria-label 为"加标签"', async () => {
    renderAssets([makeItem({ id: 'has-tagbtn', title: '加标签测试.png' })])

    await screen.findByText('加标签测试.png')
    expect(screen.getByLabelText('加标签')).toBeInTheDocument()
  })

  it('点击卡片标签按钮不会触发卡片 onClick（stopPropagation）', async () => {
    // 验证点击加标签按钮不会打开 PreviewModal（不出现编辑按钮等 modal 内容）
    const user = userEvent.setup()
    renderAssets([makeItem({
      id: 'no-preview', title: '不打开预览.png',
      source: 'uploaded_file',
      tagNames: [],
    })])

    const trigger = await screen.findByTestId('asset-tag-trigger-uploaded_file:no-preview')
    await user.click(trigger)

    // PreviewModal 不应该打开（不会渲染「下载」按钮）
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /下载/ })).not.toBeInTheDocument()
    })
  })

  it('标签管理按钮在页头', async () => {
    renderAssets([])
    expect(screen.getByText('标签管理')).toBeInTheDocument()
  })

  it('筛选区标签下拉按钮存在', async () => {
    renderAssets([])
    await screen.findByLabelText('排序')
    expect(screen.getByLabelText('标签筛选')).toBeInTheDocument()
  })

  it('空标签时筛选下拉显示"全部标签"', async () => {
    renderAssets([])
    await screen.findByLabelText('排序')
    expect(screen.getByText('全部标签')).toBeInTheDocument()
  })
})
