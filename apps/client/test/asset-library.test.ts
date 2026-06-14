import type { AssetLibraryItem } from '@excuse/shared'
import type { FocusProjectLike } from '../src/lib/asset-library'
import { describe, expect, it } from 'vitest'
import {
  assetToShotReferenceAsset,
  buildAssetLibraryStats,
  canDeleteAsset,
  filterAssetLibraryItems,
  findProjectLabel,
  formatProjectOptionLabel,
  getAssetLibraryPreviewKind,
  getCanvasAssetUrl,
  getCanvasFocusParam,
  getCanvasProjectUrl,
  getCanvasSourceLabel,
  inferReferenceRole,
  isReferenceAssetAdded,
  isReferenceAssetCandidate,
  mergeShotReferenceAssets,
  parseFocusParam,
  resolveFocusNodeWithProject,
} from '../src/lib/asset-library'

/** 构造测试用 AssetLibraryItem */
function makeItem(overrides: Partial<AssetLibraryItem>): AssetLibraryItem {
  return {
    id: 'item-1',
    source: 'generation_record',
    kind: 'image',
    status: 'succeeded',
    title: 'test',
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

/** 构造测试用 FocusProjectLike */
function makeProject(overrides: Partial<FocusProjectLike> = {}): FocusProjectLike {
  return {
    characters: [{ id: 'char-1' }, { id: 'char-2' }],
    locations: [{ id: 'loc-1' }],
    shots: [{ id: 'shot-1' }, { id: 'shot-2' }],
    analysis: { summary: 'test' },
    continuityIssues: [{ severity: 'error', code: 'MISSING_SCENE', message: 'test' }],
    ...overrides,
  }
}

describe('buildAssetLibraryStats', () => {
  it('canvas 角色图计入角色类统计', () => {
    const items = [
      makeItem({ id: 'gen-img', source: 'generation_record', kind: 'image' }),
      makeItem({ id: 'char-1', source: 'canvas_asset', kind: 'character', projectId: 'proj-1' }),
      makeItem({ id: 'char-2', source: 'canvas_asset', kind: 'character', projectId: 'proj-1' }),
    ]
    const stats = buildAssetLibraryStats(items)
    expect(stats.total).toBe(3)
    expect(stats.byKind.character).toBe(2)
    expect(stats.byKind.image).toBe(1)
    expect(stats.bySource.canvas_asset).toBe(2)
    expect(stats.bySource.generation_record).toBe(1)
  })

  it('按状态汇总 succeeded/failed/running', () => {
    const items = [
      makeItem({ id: 'a', status: 'succeeded' }),
      makeItem({ id: 'b', status: 'processing' }), // running
      makeItem({ id: 'c', status: 'running' }), // canvas running
      makeItem({ id: 'd', status: 'failed' }),
      makeItem({ id: 'e', status: 'cancelled' }),
    ]
    const stats = buildAssetLibraryStats(items)
    expect(stats.succeeded).toBe(1)
    expect(stats.running).toBe(2)
    expect(stats.failed).toBe(1)
  })

  it('空列表返回零统计', () => {
    const stats = buildAssetLibraryStats([])
    expect(stats.total).toBe(0)
    expect(stats.succeeded).toBe(0)
    expect(stats.byKind.image).toBe(0)
  })
})

describe('filterAssetLibraryItems', () => {
  const items = [
    makeItem({ id: 'gen', source: 'generation_record', kind: 'image', status: 'succeeded' }),
    makeItem({ id: 'char', source: 'canvas_asset', kind: 'character', status: 'succeeded' }),
    makeItem({ id: 'shot', source: 'canvas_asset', kind: 'shot', status: 'running' }),
    makeItem({ id: 'upload', source: 'uploaded_file', kind: 'upload', status: 'succeeded' }),
    makeItem({ id: 'fail', source: 'generation_record', kind: 'video', status: 'failed' }),
  ]

  it('source 过滤生效', () => {
    const canvas = filterAssetLibraryItems(items, { source: 'canvas_asset', kind: 'all', status: 'all', search: '', model: '', createdFrom: '', createdTo: '' })
    expect(canvas.map(i => i.id).sort()).toEqual(['char', 'shot'])
  })

  it('status 过滤生效（running 匹配 processing/running）', () => {
    const running = filterAssetLibraryItems(items, { source: 'all', kind: 'all', status: 'running', search: '', model: '', createdFrom: '', createdTo: '' })
    expect(running.map(i => i.id)).toEqual(['shot'])
  })

  it('kind 过滤生效', () => {
    const chars = filterAssetLibraryItems(items, { source: 'all', kind: 'character', status: 'all', search: '', model: '', createdFrom: '', createdTo: '' })
    expect(chars.map(i => i.id)).toEqual(['char'])
  })

  it('组合过滤', () => {
    const result = filterAssetLibraryItems(items, { source: 'canvas_asset', kind: 'shot', status: 'running', search: '', model: '', createdFrom: '', createdTo: '' })
    expect(result.map(i => i.id)).toEqual(['shot'])
  })

  it('all 过滤返回全部', () => {
    const result = filterAssetLibraryItems(items, { source: 'all', kind: 'all', status: 'all', search: '', model: '', createdFrom: '', createdTo: '' })
    expect(result).toHaveLength(5)
  })

  it('search 过滤：匹配 title/prompt/model', () => {
    const searched = filterAssetLibraryItems(items, { source: 'all', kind: 'all', status: 'all', search: 'cat', model: '', createdFrom: '', createdTo: '' })
    // makeItem defaults: title='test', prompt='a cat', model='qwen-max'
    // 'cat' matches prompt 'a cat'
    expect(searched).toHaveLength(5) // all items have prompt='a cat' from makeItem
  })

  it('search 过滤：精确匹配 model', () => {
    const searched = filterAssetLibraryItems(
      [makeItem({ id: 'gen1', model: 'wanx2.1' }), makeItem({ id: 'gen2', model: 'qwen-max' })],
      { source: 'all', kind: 'all', status: 'all', search: 'wanx', model: '', createdFrom: '', createdTo: '' },
    )
    expect(searched.map(i => i.id)).toEqual(['gen1'])
  })

  it('search 过滤：空字符串不过滤', () => {
    const searched = filterAssetLibraryItems(items, { source: 'all', kind: 'all', status: 'all', search: '', model: '', createdFrom: '', createdTo: '' })
    expect(searched).toHaveLength(5)
  })
})

describe('getAssetLibraryPreviewKind', () => {
  it('character/location/image 渲染为图片', () => {
    expect(getAssetLibraryPreviewKind(makeItem({ kind: 'character' }))).toBe('image')
    expect(getAssetLibraryPreviewKind(makeItem({ kind: 'location' }))).toBe('image')
    expect(getAssetLibraryPreviewKind(makeItem({ kind: 'image' }))).toBe('image')
  })

  it('shot/video 渲染为视频', () => {
    expect(getAssetLibraryPreviewKind(makeItem({ kind: 'shot' }))).toBe('video')
    expect(getAssetLibraryPreviewKind(makeItem({ kind: 'video' }))).toBe('video')
  })

  it('upload 按 URL 扩展名判断图片/视频/文件', () => {
    expect(getAssetLibraryPreviewKind(makeItem({ kind: 'upload', previewUrl: 'https://x/a.png' }))).toBe('image')
    expect(getAssetLibraryPreviewKind(makeItem({ kind: 'upload', previewUrl: 'https://x/a.mp4' }))).toBe('video')
    expect(getAssetLibraryPreviewKind(makeItem({ kind: 'upload', previewUrl: 'https://x/a.pdf' }))).toBe('file')
  })

  it('text/project 渲染为文本图标', () => {
    expect(getAssetLibraryPreviewKind(makeItem({ kind: 'text' }))).toBe('text')
    expect(getAssetLibraryPreviewKind(makeItem({ kind: 'project' }))).toBe('text')
  })
})

describe('getCanvasProjectUrl', () => {
  it('有 projectId 的资产生成 Canvas 跳转目标', () => {
    expect(getCanvasProjectUrl(makeItem({ projectId: 'proj-123' }))).toBe('/canvas/proj-123')
  })

  it('无 projectId 返回 null', () => {
    expect(getCanvasProjectUrl(makeItem({ projectId: null }))).toBeNull()
  })
})

describe('getCanvasFocusParam', () => {
  it('character + targetEntityId → char:<id>', () => {
    expect(getCanvasFocusParam(makeItem({ projectId: 'p1', targetEntityType: 'character', targetEntityId: 'c1' }))).toBe('char:c1')
  })

  it('location + targetEntityId → loc:<id>', () => {
    expect(getCanvasFocusParam(makeItem({ projectId: 'p1', targetEntityType: 'location', targetEntityId: 'l1' }))).toBe('loc:l1')
  })

  it('shot + targetEntityId → shot:<id>', () => {
    expect(getCanvasFocusParam(makeItem({ projectId: 'p1', targetEntityType: 'shot', targetEntityId: 's1' }))).toBe('shot:s1')
  })

  it('project 类型不加 focus（避免误导）', () => {
    expect(getCanvasFocusParam(makeItem({ projectId: 'p1', targetEntityType: 'project', targetEntityId: 'p1' }))).toBeNull()
  })

  it('无 targetEntityId 不生成 focus', () => {
    expect(getCanvasFocusParam(makeItem({ projectId: 'p1', targetEntityType: 'character', targetEntityId: null }))).toBeNull()
  })

  it('无 projectId 返回 null', () => {
    expect(getCanvasFocusParam(makeItem({ projectId: null }))).toBeNull()
  })
})

describe('getCanvasAssetUrl', () => {
  it('character asset 生成 /canvas/:projectId?focus=char:<id>', () => {
    expect(getCanvasAssetUrl(makeItem({ projectId: 'p1', targetEntityType: 'character', targetEntityId: 'c1' }))).toBe('/canvas/p1?focus=char:c1')
  })

  it('location asset 生成 /canvas/:projectId?focus=loc:<id>', () => {
    expect(getCanvasAssetUrl(makeItem({ projectId: 'p1', targetEntityType: 'location', targetEntityId: 'l1' }))).toBe('/canvas/p1?focus=loc:l1')
  })

  it('shot asset 生成 /canvas/:projectId?focus=shot:<id>', () => {
    expect(getCanvasAssetUrl(makeItem({ projectId: 'p1', targetEntityType: 'shot', targetEntityId: 's1' }))).toBe('/canvas/p1?focus=shot:s1')
  })

  it('project asset 不强行生成错误 focus', () => {
    expect(getCanvasAssetUrl(makeItem({ projectId: 'p1', targetEntityType: 'project' }))).toBe('/canvas/p1')
  })

  it('无 projectId 返回 null', () => {
    expect(getCanvasAssetUrl(makeItem({ projectId: null }))).toBeNull()
  })

  it('非 canvas asset 有 projectId 但无 targetEntityType → 跳转项目首页', () => {
    expect(getCanvasAssetUrl(makeItem({ projectId: 'p1', source: 'generation_record' }))).toBe('/canvas/p1')
  })
})

describe('getCanvasSourceLabel', () => {
  it('有 focus 的 character → "定位角色节点"', () => {
    expect(getCanvasSourceLabel(makeItem({ projectId: 'p1', targetEntityType: 'character', targetEntityId: 'c1' }))).toBe('定位角色节点')
  })

  it('有 focus 的 location → "定位场景节点"', () => {
    expect(getCanvasSourceLabel(makeItem({ projectId: 'p1', targetEntityType: 'location', targetEntityId: 'l1' }))).toBe('定位场景节点')
  })

  it('有 focus 的 shot → "定位镜头节点"', () => {
    expect(getCanvasSourceLabel(makeItem({ projectId: 'p1', targetEntityType: 'shot', targetEntityId: 's1' }))).toBe('定位镜头节点')
  })

  it('无 focus 的 character（无 targetEntityId）→ "打开角色所在项目"', () => {
    expect(getCanvasSourceLabel(makeItem({ projectId: 'p1', targetEntityType: 'character', targetEntityId: null }))).toBe('打开角色所在项目')
  })

  it('其他 targetEntityType 返回通用项目标签', () => {
    expect(getCanvasSourceLabel(makeItem({ projectId: 'p1', targetEntityType: null }))).toBe('打开项目')
    expect(getCanvasSourceLabel(makeItem({ projectId: 'p1', targetEntityType: 'project' }))).toBe('打开项目')
  })

  it('无 projectId 返回空字符串（不显示按钮）', () => {
    expect(getCanvasSourceLabel(makeItem({ projectId: null }))).toBe('')
  })
})

describe('parseFocusParam', () => {
  it('story → { id: "story", type: "storyInput" }', () => {
    expect(parseFocusParam('story')).toEqual({ id: 'story', type: 'storyInput' })
  })

  it('analysis → { id: "analysis", type: "analysis" }', () => {
    expect(parseFocusParam('analysis')).toEqual({ id: 'analysis', type: 'analysis' })
  })

  it('continuity → { id: "continuity", type: "continuityCheck" }', () => {
    expect(parseFocusParam('continuity')).toEqual({ id: 'continuity', type: 'continuityCheck' })
  })

  it('char:<id> → { id: "char-<id>", type: "character" }', () => {
    expect(parseFocusParam('char:abc123')).toEqual({ id: 'char-abc123', type: 'character' })
  })

  it('loc:<id> → { id: "loc-<id>", type: "location" }', () => {
    expect(parseFocusParam('loc:xyz')).toEqual({ id: 'loc-xyz', type: 'location' })
  })

  it('shot:<id> → { id: "shot-<id>", type: "shot" }', () => {
    expect(parseFocusParam('shot:42')).toEqual({ id: 'shot-42', type: 'shot' })
  })

  it('无效 focus → null', () => {
    expect(parseFocusParam('invalid')).toBeNull()
    expect(parseFocusParam('foo:bar')).toBeNull()
    expect(parseFocusParam('char:')).toBeNull() // 空 entityId
    expect(parseFocusParam('')).toBeNull()
  })

  it('null → null', () => {
    expect(parseFocusParam(null)).toBeNull()
  })
})

describe('resolveFocusNodeWithProject', () => {
  const project = makeProject()

  it('char:<id> 在 characters 中存在 → 解析成功', () => {
    expect(resolveFocusNodeWithProject('char:char-1', project)).toEqual({ id: 'char-char-1', type: 'character' })
  })

  it('char:<id> 在 characters 中不存在 → null', () => {
    expect(resolveFocusNodeWithProject('char:not-exist', project)).toBeNull()
  })

  it('loc:<id> 在 locations 中存在 → 解析成功', () => {
    expect(resolveFocusNodeWithProject('loc:loc-1', project)).toEqual({ id: 'loc-loc-1', type: 'location' })
  })

  it('loc:<id> 不存在 → null', () => {
    expect(resolveFocusNodeWithProject('loc:not-exist', project)).toBeNull()
  })

  it('shot:<id> 在 shots 中存在 → 解析成功', () => {
    expect(resolveFocusNodeWithProject('shot:shot-1', project)).toEqual({ id: 'shot-shot-1', type: 'shot' })
  })

  it('shot:<id> 不存在 → null', () => {
    expect(resolveFocusNodeWithProject('shot:not-exist', project)).toBeNull()
  })

  it('analysis 在 project.analysis 存在时 → 解析成功', () => {
    expect(resolveFocusNodeWithProject('analysis', project)).toEqual({ id: 'analysis', type: 'analysis' })
  })

  it('analysis 在 project.analysis=null 时 → null', () => {
    const noAnalysis = makeProject({ analysis: null })
    expect(resolveFocusNodeWithProject('analysis', noAnalysis)).toBeNull()
  })

  it('continuity 在 continuityIssues 非空时 → 解析成功', () => {
    expect(resolveFocusNodeWithProject('continuity', project)).toEqual({ id: 'continuity', type: 'continuityCheck' })
  })

  it('continuity 在 continuityIssues=[] 时 → null', () => {
    const noContinuity = makeProject({ continuityIssues: [] })
    expect(resolveFocusNodeWithProject('continuity', noContinuity)).toBeNull()
  })

  it('story → 总是成功', () => {
    expect(resolveFocusNodeWithProject('story', project)).toEqual({ id: 'story', type: 'storyInput' })
  })

  it('无效 focus → null', () => {
    expect(resolveFocusNodeWithProject('invalid', project)).toBeNull()
  })

  it('null focus → null', () => {
    expect(resolveFocusNodeWithProject(null, project)).toBeNull()
  })
})

describe('canDeleteAsset', () => {
  it('source=uploaded_file → 可删除', () => {
    expect(canDeleteAsset(makeItem({ source: 'uploaded_file', kind: 'upload' }))).toBe(true)
  })

  it('source=generation_record → 不可删除', () => {
    expect(canDeleteAsset(makeItem({ source: 'generation_record' }))).toBe(false)
  })

  it('source=canvas_asset → 不可删除', () => {
    expect(canDeleteAsset(makeItem({ source: 'canvas_asset' }))).toBe(false)
  })
})

describe('formatProjectOptionLabel', () => {
  it('有标题的项目显示标题', () => {
    expect(formatProjectOptionLabel({ id: 'proj-123abc', title: '我的故事' })).toBe('我的故事')
  })

  it('无标题的项目显示未命名 + id 前8位', () => {
    expect(formatProjectOptionLabel({ id: 'proj-123abcdef', title: null })).toBe('未命名项目 (proj-123)')
  })

  it('空字符串标题视为无标题', () => {
    expect(formatProjectOptionLabel({ id: 'proj-abc', title: '' })).toBe('未命名项目 (proj-abc)')
  })
})

describe('findProjectLabel', () => {
  const projects = [
    { id: 'proj-1', title: '英雄之旅' },
    { id: 'proj-2', title: null },
    { id: 'proj-3', title: '第三章' },
  ]

  it('找到项目时显示格式化标签', () => {
    expect(findProjectLabel(projects, 'proj-1')).toBe('英雄之旅')
  })

  it('找到无标题项目时显示未命名标签', () => {
    expect(findProjectLabel(projects, 'proj-2')).toBe('未命名项目 (proj-2)')
  })

  it('未找到项目时显示 id 前8位', () => {
    expect(findProjectLabel(projects, 'proj-999xyz')).toBe('proj-999')
  })

  it('projectId null 返回空字符串', () => {
    expect(findProjectLabel(projects, null)).toBe('')
  })
})

// ── 镜头参考资产选择纯函数（P1-2 v0.2）──────────────────────────────────────

describe('isReferenceAssetCandidate', () => {
  it('接受 image 资产', () => {
    expect(isReferenceAssetCandidate(makeItem({ kind: 'image' }))).toBe(true)
  })

  it('接受 character / location 资产', () => {
    expect(isReferenceAssetCandidate(makeItem({ kind: 'character' }))).toBe(true)
    expect(isReferenceAssetCandidate(makeItem({ kind: 'location' }))).toBe(true)
  })

  it('接受 upload 且实际是图片的资产', () => {
    expect(isReferenceAssetCandidate(makeItem({ kind: 'upload', previewUrl: 'https://x/a.png', downloadUrl: 'https://x/a.png' }))).toBe(true)
  })

  it('拒绝 upload 但实际是视频的资产', () => {
    expect(isReferenceAssetCandidate(makeItem({ kind: 'upload', previewUrl: 'https://x/a.mp4', downloadUrl: 'https://x/a.mp4' }))).toBe(false)
  })

  it('拒绝 video / shot 资产', () => {
    expect(isReferenceAssetCandidate(makeItem({ kind: 'video' }))).toBe(false)
    expect(isReferenceAssetCandidate(makeItem({ kind: 'shot' }))).toBe(false)
  })

  it('拒绝 text / subtitle / project 资产', () => {
    expect(isReferenceAssetCandidate(makeItem({ kind: 'text' }))).toBe(false)
    expect(isReferenceAssetCandidate(makeItem({ kind: 'subtitle' }))).toBe(false)
    expect(isReferenceAssetCandidate(makeItem({ kind: 'project' }))).toBe(false)
  })

  it('拒绝无 URL 的资产', () => {
    expect(isReferenceAssetCandidate(makeItem({ kind: 'image', previewUrl: null, downloadUrl: null }))).toBe(false)
  })
})

describe('inferReferenceRole', () => {
  it('character → character', () => {
    expect(inferReferenceRole(makeItem({ kind: 'character' }))).toBe('character')
  })

  it('location → location', () => {
    expect(inferReferenceRole(makeItem({ kind: 'location' }))).toBe('location')
  })

  it('其他图片 → other', () => {
    expect(inferReferenceRole(makeItem({ kind: 'image' }))).toBe('other')
    expect(inferReferenceRole(makeItem({ kind: 'upload', previewUrl: 'https://x/a.png' }))).toBe('other')
  })
})

describe('assetToShotReferenceAsset', () => {
  it('生成正确的 assetId/url/role/label/source（生成记录）', () => {
    const ref = assetToShotReferenceAsset(makeItem({
      id: 'gen-1',
      kind: 'image',
      source: 'generation_record',
      title: '我的图片',
      downloadUrl: 'https://cdn.local/a.png',
      previewUrl: 'https://cdn.local/preview.png',
    }))
    expect(ref).toEqual({
      assetId: 'gen-1',
      url: 'https://cdn.local/a.png', // 优先 downloadUrl
      role: 'other',
      label: '我的图片',
      source: 'asset_library',
    })
  })

  it('character 资产 role=character，无 downloadUrl 时用 previewUrl', () => {
    const ref = assetToShotReferenceAsset(makeItem({
      id: 'char-1',
      kind: 'character',
      source: 'canvas_asset',
      downloadUrl: null,
      previewUrl: 'https://cdn.local/char.png',
    }))
    expect(ref?.role).toBe('character')
    expect(ref?.url).toBe('https://cdn.local/char.png')
    expect(ref?.source).toBe('asset_library')
  })

  it('uploaded_file 来源 → source=uploaded_file', () => {
    const ref = assetToShotReferenceAsset(makeItem({
      id: 'up-1',
      kind: 'upload',
      source: 'uploaded_file',
      previewUrl: 'https://cdn.local/up.png',
      downloadUrl: 'https://cdn.local/up.png',
    }))
    expect(ref?.source).toBe('uploaded_file')
  })

  it('非候选资产返回 null', () => {
    expect(assetToShotReferenceAsset(makeItem({ kind: 'video' }))).toBeNull()
    expect(assetToShotReferenceAsset(makeItem({ kind: 'image', previewUrl: null, downloadUrl: null }))).toBeNull()
  })
})

describe('mergeShotReferenceAssets', () => {
  const a1 = { assetId: 'a1', url: 'https://x/1.png', role: 'character' as const }
  const a2 = { assetId: 'a2', url: 'https://x/2.png', role: 'location' as const }

  it('新资产追加到末尾，保留已有顺序', () => {
    const merged = mergeShotReferenceAssets([a1], [a2])
    expect(merged.map(m => m.assetId)).toEqual(['a1', 'a2'])
  })

  it('按 assetId 去重', () => {
    const dupByAssetId = { assetId: 'a1', url: 'https://x/other.png', role: 'other' as const }
    const merged = mergeShotReferenceAssets([a1], [dupByAssetId])
    expect(merged).toHaveLength(1)
  })

  it('按 url 去重（即使 assetId 不同）', () => {
    const dupByUrl = { assetId: 'a3', url: 'https://x/1.png', role: 'other' as const }
    const merged = mergeShotReferenceAssets([a1], [dupByUrl])
    expect(merged).toHaveLength(1)
  })

  it('incoming 内部自身去重', () => {
    const dup = { assetId: 'a2', url: 'https://x/2.png', role: 'other' as const }
    const merged = mergeShotReferenceAssets([], [a2, dup])
    expect(merged).toHaveLength(1)
  })

  it('默认最多 8 个，超出截断', () => {
    const current = Array.from({ length: 7 }, (_, i) => ({ assetId: `c${i}`, url: `https://x/c${i}.png`, role: 'other' as const }))
    const incoming = Array.from({ length: 5 }, (_, i) => ({ assetId: `n${i}`, url: `https://x/n${i}.png`, role: 'other' as const }))
    const merged = mergeShotReferenceAssets(current, incoming)
    expect(merged).toHaveLength(8)
    // 已有 7 个保留，新资产只追加 1 个
    expect(merged[7]?.assetId).toBe('n0')
  })

  it('自定义 max 生效', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ assetId: `m${i}`, url: `https://x/m${i}.png`, role: 'other' as const }))
    expect(mergeShotReferenceAssets([], items, 3)).toHaveLength(3)
  })

  it('空输入返回空数组', () => {
    expect(mergeShotReferenceAssets([], [])).toEqual([])
  })
})

describe('isReferenceAssetAdded', () => {
  const existing = [
    { assetId: 'a1', url: 'https://x/1.png', role: 'character' as const },
  ]

  it('同 assetId 视为已添加', () => {
    expect(isReferenceAssetAdded(existing, makeItem({ id: 'a1' }))).toBe(true)
  })

  it('同 url 视为已添加', () => {
    expect(isReferenceAssetAdded(existing, makeItem({ id: 'a9', downloadUrl: 'https://x/1.png', previewUrl: 'https://x/1.png' }))).toBe(true)
  })

  it('完全不同的资产未添加', () => {
    expect(isReferenceAssetAdded(existing, makeItem({ id: 'a2', downloadUrl: 'https://x/2.png' }))).toBe(false)
  })
})
