import type { AssetLibraryItem } from '@excuse/shared'
import { describe, expect, it } from 'vitest'
import {
  buildAssetLibraryStats,
  filterAssetLibraryItems,
  getAssetLibraryPreviewKind,
  getCanvasProjectUrl,
  getCanvasSourceLabel,
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
    const canvas = filterAssetLibraryItems(items, { source: 'canvas_asset', kind: 'all', status: 'all', model: '', createdFrom: '', createdTo: '' })
    expect(canvas.map(i => i.id).sort()).toEqual(['char', 'shot'])
  })

  it('status 过滤生效（running 匹配 processing/running）', () => {
    const running = filterAssetLibraryItems(items, { source: 'all', kind: 'all', status: 'running', model: '', createdFrom: '', createdTo: '' })
    expect(running.map(i => i.id)).toEqual(['shot'])
  })

  it('kind 过滤生效', () => {
    const chars = filterAssetLibraryItems(items, { source: 'all', kind: 'character', status: 'all', model: '', createdFrom: '', createdTo: '' })
    expect(chars.map(i => i.id)).toEqual(['char'])
  })

  it('组合过滤', () => {
    const result = filterAssetLibraryItems(items, { source: 'canvas_asset', kind: 'shot', status: 'running', model: '', createdFrom: '', createdTo: '' })
    expect(result.map(i => i.id)).toEqual(['shot'])
  })

  it('all 过滤返回全部', () => {
    const result = filterAssetLibraryItems(items, { source: 'all', kind: 'all', status: 'all', model: '', createdFrom: '', createdTo: '' })
    expect(result).toHaveLength(5)
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

describe('getCanvasSourceLabel', () => {
  it('targetEntityType=character 返回角色标签', () => {
    expect(getCanvasSourceLabel(makeItem({ projectId: 'proj-1', targetEntityType: 'character' }))).toBe('打开角色所在项目')
  })

  it('targetEntityType=location 返回场景标签', () => {
    expect(getCanvasSourceLabel(makeItem({ projectId: 'proj-1', targetEntityType: 'location' }))).toBe('打开场景所在项目')
  })

  it('targetEntityType=shot 返回镜头标签', () => {
    expect(getCanvasSourceLabel(makeItem({ projectId: 'proj-1', targetEntityType: 'shot' }))).toBe('打开镜头所在项目')
  })

  it('其他 targetEntityType 返回通用项目标签', () => {
    expect(getCanvasSourceLabel(makeItem({ projectId: 'proj-1', targetEntityType: null }))).toBe('打开项目')
    expect(getCanvasSourceLabel(makeItem({ projectId: 'proj-1', targetEntityType: 'project' }))).toBe('打开项目')
  })

  it('无 projectId 返回空字符串（不显示按钮）', () => {
    expect(getCanvasSourceLabel(makeItem({ projectId: null }))).toBe('')
  })
})
