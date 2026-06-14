import type { AssetLibraryItem, CanvasShotReferenceAsset, ProjectDTO } from '@excuse/shared'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCallback, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchAssetLibrary } from '../src/api/client'
import { ShotReferenceAssets } from '../src/components/canvas/ShotReferenceAssets'

vi.mock('../src/api/client', () => ({
  fetchAssetLibrary: vi.fn(),
}))

// ── 构造测试数据 ──────────────────────────────────────────────────

function makeShot(referenceAssets: CanvasShotReferenceAsset[] = []): ProjectDTO['shots'][number] {
  return { referenceAssets } as ProjectDTO['shots'][number]
}

function makeAssetItem(overrides: Partial<AssetLibraryItem>): AssetLibraryItem {
  return {
    id: 'item-1',
    source: 'generation_record',
    kind: 'image',
    status: 'succeeded',
    title: 'image-asset',
    model: 'qwen-max',
    previewUrl: 'https://cdn.local/a.png',
    downloadUrl: 'https://cdn.local/a.png',
    projectId: null,
    targetEntityType: null,
    targetEntityId: null,
    prompt: 'a cat',
    costCents: 10,
    createdAt: '2024-06-01T00:00:00.000Z',
    ...overrides,
  }
}

const ASSET_ITEMS: AssetLibraryItem[] = [
  makeAssetItem({ id: 'gen-img', kind: 'image', title: '普通图片', previewUrl: 'https://cdn.local/gen.png', downloadUrl: 'https://cdn.local/gen.png' }),
  makeAssetItem({ id: 'char-img', kind: 'character', title: '角色资产', previewUrl: 'https://cdn.local/char.png', downloadUrl: 'https://cdn.local/char.png' }),
  makeAssetItem({ id: 'loc-img', kind: 'location', title: '场景资产', previewUrl: 'https://cdn.local/loc.png', downloadUrl: 'https://cdn.local/loc.png' }),
  makeAssetItem({ id: 'upload-img', kind: 'upload', source: 'uploaded_file', title: '上传图片', previewUrl: 'https://cdn.local/upload.png', downloadUrl: 'https://cdn.local/upload.png' }),
  makeAssetItem({ id: 'video', kind: 'video', title: '视频资产', previewUrl: 'https://cdn.local/video.mp4', downloadUrl: 'https://cdn.local/video.mp4' }),
  makeAssetItem({ id: 'text', kind: 'text', title: '文本资产' }),
]

/** 在候选行内定位"添加"按钮（标题 <p> 向上两层到行容器，行容器含按钮） */
function findAddButtonFor(title: string): HTMLElement {
  const titleEl = screen.getByText(title)
  const rowEl = titleEl.parentElement?.parentElement
  return within(rowEl!).getByRole('button', { name: '添加' })
}

// ── 有状态 Harness：onSave 后把更新后的 referenceAssets 回传，模拟真实刷新 ──
const onSaveCalls: CanvasShotReferenceAsset[][] = []

function StatefulShotReferenceAssets({ initialAssets }: { initialAssets?: CanvasShotReferenceAsset[] }) {
  const [assets, setAssets] = useState<CanvasShotReferenceAsset[]>(initialAssets ?? [])
  const onSave = useCallback(async (next: CanvasShotReferenceAsset[]) => {
    onSaveCalls.push(next)
    setAssets(next)
  }, [])
  return <ShotReferenceAssets shot={makeShot(assets)} projectId="p1" onSave={onSave} />
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  onSaveCalls.length = 0
})

describe('shotReferenceAssets 资产库选择器', () => {
  it('点击"从资产库选择"调用 fetchAssetLibrary（succeeded + 当前项目 + limit 80）', async () => {
    vi.mocked(fetchAssetLibrary).mockResolvedValue({ success: true, items: [], total: 0 })
    const user = userEvent.setup()
    render(<ShotReferenceAssets shot={makeShot()} projectId="p1" onSave={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: '从资产库选择' }))

    await waitFor(() => {
      expect(fetchAssetLibrary).toHaveBeenCalled()
    })
    expect(fetchAssetLibrary).toHaveBeenCalledWith(expect.objectContaining({
      status: 'succeeded',
      projectId: 'p1',
      limit: 80,
    }))
  })

  it('只展示可选图片资产，视频/文本被过滤', async () => {
    vi.mocked(fetchAssetLibrary).mockResolvedValue({ success: true, items: ASSET_ITEMS, total: ASSET_ITEMS.length })
    const user = userEvent.setup()
    render(<ShotReferenceAssets shot={makeShot()} projectId="p1" onSave={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: '从资产库选择' }))

    await waitFor(() => {
      expect(screen.getByText('普通图片')).toBeInTheDocument()
    })
    expect(screen.getByText('角色资产')).toBeInTheDocument()
    expect(screen.getByText('场景资产')).toBeInTheDocument()
    expect(screen.getByText('上传图片')).toBeInTheDocument()
    // 视频/文本不应出现在选择器中（isReferenceAssetCandidate 过滤）
    expect(screen.queryByText('视频资产')).not.toBeInTheDocument()
    expect(screen.queryByText('文本资产')).not.toBeInTheDocument()
  })

  it('点击添加调用 onSave 保存正确资产，且已添加资产不可重复添加', async () => {
    vi.mocked(fetchAssetLibrary).mockResolvedValue({ success: true, items: ASSET_ITEMS, total: ASSET_ITEMS.length })
    const user = userEvent.setup()
    render(<StatefulShotReferenceAssets />)

    await user.click(screen.getByRole('button', { name: '从资产库选择' }))

    // 初始列表为空，此时 '普通图片' 只在候选列表中出现一次
    await screen.findByText('普通图片')
    await user.click(findAddButtonFor('普通图片'))

    await waitFor(() => {
      expect(onSaveCalls).toHaveLength(1)
    })
    const saved = onSaveCalls[0]!
    expect(saved).toHaveLength(1)
    expect(saved[0]!.assetId).toBe('gen-img')
    expect(saved[0]!.url).toBe('https://cdn.local/gen.png')
    expect(saved[0]!.role).toBe('other')
    expect(saved[0]!.source).toBe('asset_library')

    // 回传后该候选变为"已添加"且禁用
    expect(screen.getByRole('button', { name: '已添加' })).toBeDisabled()
    expect(onSaveCalls).toHaveLength(1)
  })

  it('角色资产推断 role=character', async () => {
    vi.mocked(fetchAssetLibrary).mockResolvedValue({ success: true, items: ASSET_ITEMS, total: ASSET_ITEMS.length })
    const user = userEvent.setup()
    render(<StatefulShotReferenceAssets />)

    await user.click(screen.getByRole('button', { name: '从资产库选择' }))
    await screen.findByText('角色资产')
    await user.click(findAddButtonFor('角色资产'))

    await waitFor(() => {
      expect(onSaveCalls).toHaveLength(1)
    })
    expect(onSaveCalls[0]![0]!.role).toBe('character')
  })
})
