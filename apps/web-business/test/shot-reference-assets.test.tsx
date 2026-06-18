import type { AssetLibraryItem, CanvasShotReferenceAsset, ProjectDTO } from '@excuse/shared'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCallback, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyShotReferenceAssets, fetchAssetLibrary } from '../src/api/client'
import { ShotReferenceAssets } from '../src/components/canvas/ShotReferenceAssets'

vi.mock('../src/api/client', () => ({
  applyShotReferenceAssets: vi.fn(),
  fetchAssetLibrary: vi.fn(),
}))

// ── 构造测试数据 ──────────────────────────────────────────────────

function makeShot(referenceAssets: CanvasShotReferenceAsset[] = []): ProjectDTO['shots'][number] {
  return { referenceAssets } as ProjectDTO['shots'][number]
}

/** 构造可批量应用的镜头（带 id + shotIndex） */
function makeBatchableShot(
  id: string,
  shotIndex: number,
  referenceAssets: CanvasShotReferenceAsset[] = [],
): ProjectDTO['shots'][number] {
  return {
    id,
    shotIndex,
    referenceAssets,
  } as ProjectDTO['shots'][number]
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

  it('搜索词经 debounce 后再以最新值请求资产库', async () => {
    vi.mocked(fetchAssetLibrary).mockResolvedValue({ success: true, items: [], total: 0 })
    const user = userEvent.setup()
    render(<ShotReferenceAssets shot={makeShot()} projectId="p1" onSave={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: '从资产库选择' }))
    await waitFor(() => expect(fetchAssetLibrary).toHaveBeenCalled())
    vi.mocked(fetchAssetLibrary).mockClear()

    await user.type(screen.getByPlaceholderText('搜索资产、Prompt、文件名...'), 'cat')

    // debounce 未到期前不应触发请求
    expect(fetchAssetLibrary).not.toHaveBeenCalled()

    await waitFor(() => {
      expect(fetchAssetLibrary).toHaveBeenCalledWith(expect.objectContaining({
        search: 'cat',
      }))
    })
  })

  it('弹窗未打开时不请求资产库', async () => {
    vi.mocked(fetchAssetLibrary).mockResolvedValue({ success: true, items: [], total: 0 })
    render(<ShotReferenceAssets shot={makeShot()} projectId="p1" onSave={vi.fn()} />)

    // 弹窗未打开时，渲染后短暂等待仍不应触发资产请求
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(fetchAssetLibrary).not.toHaveBeenCalled()
  })

  it('手动输入重复 URL 时不调用 onSave', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(
      <ShotReferenceAssets
        shot={makeShot([
          { assetId: 'existing', url: 'https://cdn.local/existing.png', role: 'other', source: 'manual' },
        ])}
        projectId="p1"
        onSave={onSave}
      />,
    )

    await user.type(screen.getByPlaceholderText('输入参考图 URL'), 'https://cdn.local/existing.png')
    await user.click(screen.getByRole('button', { name: '添加' }))

    await waitFor(() => {
      expect(onSave).not.toHaveBeenCalled()
    })
  })
})

describe('视频变体推荐提示', () => {
  it('无参考资产 → T2V 提示', () => {
    render(<ShotReferenceAssets shot={makeShot()} projectId="p1" onSave={vi.fn()} />)
    expect(screen.getByText(/当前推荐.*T2V/)).toBeInTheDocument()
    expect(screen.getByText(/文生视频/)).toBeInTheDocument()
  })

  it('角色参考资产 → R2V 提示', () => {
    const assets: CanvasShotReferenceAsset[] = [
      { assetId: 'c1', url: 'https://cdn.local/char.png', role: 'character', source: 'asset_library' },
    ]
    render(<ShotReferenceAssets shot={makeShot(assets)} projectId="p1" onSave={vi.fn()} />)
    expect(screen.getByText(/当前推荐.*R2V/)).toBeInTheDocument()
    expect(screen.getByText(/参考生视频/)).toBeInTheDocument()
  })

  it('firstFrame 参考 → I2V 提示', () => {
    const assets: CanvasShotReferenceAsset[] = [
      { assetId: 'ff1', url: 'https://cdn.local/frame.png', role: 'firstFrame', source: 'asset_library' },
    ]
    render(<ShotReferenceAssets shot={makeShot(assets)} projectId="p1" onSave={vi.fn()} />)
    expect(screen.getByText(/当前推荐.*I2V/)).toBeInTheDocument()
    expect(screen.getByText(/图生视频/)).toBeInTheDocument()
  })
})

describe('批量应用参考资产（P1-2 v0.5）', () => {
  it('当前镜头有参考资产且存在其他镜头时显示「应用到...」', () => {
    const currentShot = makeBatchableShot('shot-1', 1, [
      { assetId: 'r1', url: 'https://cdn.local/r1.png', role: 'character', source: 'asset_library' },
    ])
    const otherShot = makeBatchableShot('shot-2', 2, [])
    render(
      <ShotReferenceAssets
        shot={currentShot}
        projectId="p1"
        allShots={[currentShot, otherShot]}
        onSave={vi.fn()}
        onUpdate={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: '应用到...' })).toBeEnabled()
  })

  it('选择目标镜头并提交后调用 applyShotReferenceAssets 并触发 onUpdate', async () => {
    vi.mocked(applyShotReferenceAssets).mockResolvedValue({
      success: true,
      applied: [
        { shotId: 'shot-2', beforeCount: 0, afterCount: 1, addedCount: 1, truncatedCount: 0 },
      ],
    })

    const currentShot = makeBatchableShot('shot-1', 1, [
      { assetId: 'r1', url: 'https://cdn.local/r1.png', role: 'character', source: 'asset_library' },
    ])
    const otherShot = makeBatchableShot('shot-2', 2, [])

    const onUpdate = vi.fn()
    const user = userEvent.setup()
    render(
      <ShotReferenceAssets
        shot={currentShot}
        projectId="p1"
        allShots={[currentShot, otherShot]}
        onSave={vi.fn()}
        onUpdate={onUpdate}
      />,
    )

    // 打开批量应用弹窗
    await user.click(screen.getByRole('button', { name: '应用到...' }))

    // 选择目标镜头 shot-2
    const checkbox = screen.getByRole('checkbox')
    await user.click(checkbox)

    // 提交
    const submitButton = screen.getByRole('button', { name: /应用到 1 个镜头/ })
    await user.click(submitButton)

    await waitFor(() => {
      expect(applyShotReferenceAssets).toHaveBeenCalledTimes(1)
    })
    expect(applyShotReferenceAssets).toHaveBeenCalledWith('p1', expect.objectContaining({
      sourceShotId: 'shot-1',
      targetShotIds: ['shot-2'],
      mode: 'append',
    }))
    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledTimes(1)
    })
  })

  it('批量应用预览显示新增和去重数量', async () => {
    const currentShot = makeBatchableShot('shot-1', 1, [
      { assetId: 'r1', url: 'https://cdn.local/r1.png', role: 'character', source: 'asset_library' },
      { assetId: 'r2', url: 'https://cdn.local/r2.png', role: 'style', source: 'asset_library' },
    ])
    const otherShot = makeBatchableShot('shot-2', 2, [
      { assetId: 'r1', url: 'https://cdn.local/r1.png', role: 'character', source: 'asset_library' },
    ])
    const user = userEvent.setup()

    render(
      <ShotReferenceAssets
        shot={currentShot}
        projectId="p1"
        allShots={[currentShot, otherShot]}
        onSave={vi.fn()}
        onUpdate={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: '应用到...' }))
    await user.click(screen.getByRole('checkbox'))

    expect(screen.getByText(/1 → 2/)).toBeInTheDocument()
    expect(screen.getByText(/新增 1/)).toBeInTheDocument()
    expect(screen.getByText(/去重 1/)).toBeInTheDocument()
  })

  it('批量应用成功后展示「撤销上次应用」入口', async () => {
    vi.mocked(applyShotReferenceAssets).mockResolvedValue({
      success: true,
      applied: [
        { shotId: 'shot-2', beforeCount: 0, afterCount: 1, addedCount: 1, truncatedCount: 0 },
      ],
    })

    const currentShot = makeBatchableShot('shot-1', 1, [
      { assetId: 'r1', url: 'https://cdn.local/r1.png', role: 'character', source: 'asset_library' },
    ])
    const otherShot = makeBatchableShot('shot-2', 2, [])

    const user = userEvent.setup()
    render(
      <ShotReferenceAssets
        shot={currentShot}
        projectId="p1"
        allShots={[currentShot, otherShot]}
        onSave={vi.fn()}
        onUpdate={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: '撤销上次应用' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '应用到...' }))
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /应用到 1 个镜头/ }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '撤销上次应用' })).toBeInTheDocument()
    })
  })

  it('点击撤销按受影响镜头逐个调用 applyShotReferenceAssets（replace 模式 + 原始参考资产）', async () => {
    vi.mocked(applyShotReferenceAssets).mockResolvedValue({
      success: true,
      applied: [
        { shotId: 'shot-2', beforeCount: 0, afterCount: 1, addedCount: 1, truncatedCount: 0 },
      ],
    })

    const currentShot = makeBatchableShot('shot-1', 1, [
      { assetId: 'r1', url: 'https://cdn.local/r1.png', role: 'character', source: 'asset_library' },
    ])
    // shot-2 初始已有 1 个参考资产（撤销时应恢复成这条记录）
    const shot2BeforeAssets: CanvasShotReferenceAsset[] = [
      { assetId: 'before-1', url: 'https://cdn.local/before.png', role: 'location', source: 'asset_library' },
    ]
    const otherShot = makeBatchableShot('shot-2', 2, shot2BeforeAssets)

    const onUpdate = vi.fn()
    const user = userEvent.setup()
    render(
      <ShotReferenceAssets
        shot={currentShot}
        projectId="p1"
        allShots={[currentShot, otherShot]}
        onSave={vi.fn()}
        onUpdate={onUpdate}
      />,
    )

    await user.click(screen.getByRole('button', { name: '应用到...' }))
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /应用到 1 个镜头/ }))

    await screen.findByRole('button', { name: '撤销上次应用' })
    vi.mocked(applyShotReferenceAssets).mockClear()

    await user.click(screen.getByRole('button', { name: '撤销上次应用' }))

    await waitFor(() => {
      expect(applyShotReferenceAssets).toHaveBeenCalledTimes(1)
    })
    expect(applyShotReferenceAssets).toHaveBeenCalledWith('p1', expect.objectContaining({
      targetShotIds: ['shot-2'],
      referenceAssetsJson: shot2BeforeAssets,
      mode: 'replace',
    }))

    // 批量应用已触发一次 onUpdate，撤销成功应再触发一次
    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledTimes(2)
    })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '撤销上次应用' })).not.toBeInTheDocument()
    })
  })

  it('撤销只针对服务端实际应用的镜头，未被应用的镜头不会进入撤销', async () => {
    // 选了两个镜头，但服务端只实际应用了 shot-2（模拟服务端跳过 shot-3）
    vi.mocked(applyShotReferenceAssets).mockResolvedValue({
      success: true,
      applied: [
        { shotId: 'shot-2', beforeCount: 0, afterCount: 1, addedCount: 1, truncatedCount: 0 },
      ],
    })

    const currentShot = makeBatchableShot('shot-1', 1, [
      { assetId: 'r1', url: 'https://cdn.local/r1.png', role: 'character', source: 'asset_library' },
    ])
    const shot2BeforeAssets: CanvasShotReferenceAsset[] = [
      { assetId: 'before-2', url: 'https://cdn.local/before-2.png', role: 'location', source: 'asset_library' },
    ]
    const otherShot2 = makeBatchableShot('shot-2', 2, shot2BeforeAssets)
    const otherShot3 = makeBatchableShot('shot-3', 3, [])

    const user = userEvent.setup()
    render(
      <ShotReferenceAssets
        shot={currentShot}
        projectId="p1"
        allShots={[currentShot, otherShot2, otherShot3]}
        onSave={vi.fn()}
        onUpdate={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: '应用到...' }))
    // 全选两个目标镜头
    await user.click(screen.getByRole('button', { name: '全选' }))
    await user.click(screen.getByRole('button', { name: /应用到 2 个镜头/ }))

    await screen.findByRole('button', { name: '撤销上次应用' })
    vi.mocked(applyShotReferenceAssets).mockClear()

    await user.click(screen.getByRole('button', { name: '撤销上次应用' }))

    await waitFor(() => {
      expect(applyShotReferenceAssets).toHaveBeenCalledTimes(1)
    })
    // 不应出现 shot-3 的撤销调用
    expect(applyShotReferenceAssets).toHaveBeenCalledWith('p1', expect.objectContaining({
      targetShotIds: ['shot-2'],
      mode: 'replace',
    }))
    for (const call of vi.mocked(applyShotReferenceAssets).mock.calls) {
      expect(call[1]?.targetShotIds).not.toContain('shot-3')
    }
  })

  it('撤销失败时保留撤销入口，方便用户重试', async () => {
    // 第一次：批量应用成功；之后：撤销被拒绝
    vi.mocked(applyShotReferenceAssets)
      .mockResolvedValueOnce({
        success: true,
        applied: [
          { shotId: 'shot-2', beforeCount: 0, afterCount: 1, addedCount: 1, truncatedCount: 0 },
        ],
      })
      .mockRejectedValueOnce(new Error('network'))

    const currentShot = makeBatchableShot('shot-1', 1, [
      { assetId: 'r1', url: 'https://cdn.local/r1.png', role: 'character', source: 'asset_library' },
    ])
    const otherShot = makeBatchableShot('shot-2', 2, [])

    const onUpdate = vi.fn()
    const user = userEvent.setup()
    render(
      <ShotReferenceAssets
        shot={currentShot}
        projectId="p1"
        allShots={[currentShot, otherShot]}
        onSave={vi.fn()}
        onUpdate={onUpdate}
      />,
    )

    await user.click(screen.getByRole('button', { name: '应用到...' }))
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /应用到 1 个镜头/ }))

    await screen.findByRole('button', { name: '撤销上次应用' })
    await user.click(screen.getByRole('button', { name: '撤销上次应用' }))

    await waitFor(() => {
      expect(applyShotReferenceAssets).toHaveBeenCalledTimes(2)
    })
    // 撤销失败不应清空 lastApplyUndo，按钮仍在；onUpdate 也不应被调用
    expect(screen.getByRole('button', { name: '撤销上次应用' })).toBeInTheDocument()
    expect(onUpdate).toHaveBeenCalledTimes(1) // 仅批量应用触发了一次
  })
})
