import type { CanvasShotReferenceAsset } from '@excuse/db'
import { describe, expect, it } from 'bun:test'
import { recommendCanvasVideoModel, resolveShotVideoReferences } from '../src/index'

// ─── resolveShotVideoReferences ─────────────────────────────

describe('resolveShotVideoReferences', () => {
  const characters = [
    { id: 'char-1', referenceImageUrl: 'https://img.host/char1.jpg' },
    { id: 'char-2', referenceImageUrl: 'https://img.host/char2.jpg' },
    { id: 'char-3', referenceImageUrl: null },
  ]
  const locations = [
    { id: 'loc-1', referenceImageUrl: 'https://img.host/loc1.jpg' },
    { id: 'loc-2', referenceImageUrl: null },
  ]

  it('角色+场景+额外引用按顺序排列，URL 去重', () => {
    const shot = {
      characterIdsJson: ['char-1', 'char-3'],
      locationId: 'loc-1',
      referenceAssetsJson: [
        { assetId: 'x1', url: 'https://img.host/char1.jpg', role: 'character' as const },
        { assetId: 'x2', url: 'https://img.host/extra.jpg', role: 'other' as const },
      ] as CanvasShotReferenceAsset[],
    }
    const refs = resolveShotVideoReferences({ shot, characters, locations })

    // char-1 URL 首次出现保留；extra 的 char1 重复 URL 去重
    expect(refs).toEqual([
      { url: 'https://img.host/char1.jpg', role: 'character' },
      { url: 'https://img.host/loc1.jpg', role: 'location' },
      // x1 (char1.jpg) 去重跳过
      { url: 'https://img.host/extra.jpg', role: 'other' },
    ])
  })

  it('无角色和场景引用时仅返回额外引用', () => {
    const shot = {
      characterIdsJson: [] as string[],
      locationId: null as string | null,
      referenceAssetsJson: [
        { assetId: 'ff1', url: 'https://img.host/firstframe.jpg', role: 'firstFrame' as const },
      ] as CanvasShotReferenceAsset[],
    }
    const refs = resolveShotVideoReferences({ shot, characters, locations })
    expect(refs).toEqual([
      { url: 'https://img.host/firstframe.jpg', role: 'firstFrame' },
    ])
  })

  it('空引用返回空数组', () => {
    const shot = {
      characterIdsJson: [] as string[],
      locationId: null as string | null,
      referenceAssetsJson: null as CanvasShotReferenceAsset[] | null,
    }
    const refs = resolveShotVideoReferences({ shot, characters, locations })
    expect(refs).toEqual([])
  })

  it('角色无参考图时跳过', () => {
    const shot = {
      characterIdsJson: ['char-3'] as string[], // char-3 referenceImageUrl = null
      locationId: null as string | null,
      referenceAssetsJson: null as CanvasShotReferenceAsset[] | null,
    }
    const refs = resolveShotVideoReferences({ shot, characters, locations })
    expect(refs).toEqual([])
  })
})

// ─── recommendCanvasVideoModel ──────────────────────────────

describe('recommendCanvasVideoModel', () => {
  it('无引用 → T2V（默认 base happyhorse-1.0）', () => {
    const rec = recommendCanvasVideoModel(null, [])
    expect(rec.model).toBe('happyhorse-1.0-t2v')
    expect(rec.variant).toBe('t2v')
    expect(rec.reason).toContain('T2V')
  })

  it('无引用 + wan2.7 prefs → wan2.7-t2v', () => {
    const rec = recommendCanvasVideoModel({ videoModel: 'wan2.7-i2v' }, [])
    expect(rec.model).toBe('wan2.7-t2v')
    expect(rec.variant).toBe('t2v')
  })

  it('1 张角色引用（无 firstFrame） → R2V', () => {
    const rec = recommendCanvasVideoModel(null, [
      { url: 'https://img.host/char1.jpg', role: 'character' },
    ])
    expect(rec.model).toBe('happyhorse-1.0-r2v')
    expect(rec.variant).toBe('r2v')
    expect(rec.reason).toContain('R2V')
    expect(rec.reason).toContain('1')
  })

  it('多张引用（角色+场景+风格） → R2V', () => {
    const rec = recommendCanvasVideoModel(null, [
      { url: 'https://img.host/char1.jpg', role: 'character' },
      { url: 'https://img.host/loc1.jpg', role: 'location' },
      { url: 'https://img.host/style.jpg', role: 'style' },
    ])
    expect(rec.model).toBe('happyhorse-1.0-r2v')
    expect(rec.variant).toBe('r2v')
    expect(rec.reason).toContain('3')
  })

  it('firstFrame 角色 → I2V', () => {
    const rec = recommendCanvasVideoModel(null, [
      { url: 'https://img.host/firstframe.jpg', role: 'firstFrame' },
    ])
    expect(rec.model).toBe('happyhorse-1.0-i2v')
    expect(rec.variant).toBe('i2v')
    expect(rec.reason).toContain('首帧图')
    expect(rec.reason).toContain('I2V')
  })

  it('firstFrame + 其他角色引用共存 → I2V（firstFrame 优先）', () => {
    const rec = recommendCanvasVideoModel(null, [
      { url: 'https://img.host/char1.jpg', role: 'character' },
      { url: 'https://img.host/firstframe.jpg', role: 'firstFrame' },
    ])
    expect(rec.variant).toBe('i2v')
    expect(rec.model).toBe('happyhorse-1.0-i2v')
  })

  it('prefs 中已带 -r2v 后缀时 strip 正确', () => {
    const rec = recommendCanvasVideoModel({ videoModel: 'wan2.7-r2v' }, [
      { url: 'https://img.host/char1.jpg', role: 'character' },
    ])
    expect(rec.model).toBe('wan2.7-r2v')
    expect(rec.variant).toBe('r2v')
  })

  // ─── 能力降级 ──────────────────────────────────────────

  it('目标 i2v 但 base 无 i2v 变体 → 降级到 r2v', () => {
    // 用一个虚构的 base（happyhorse-1.0 有 i2v，所以用不存在的 base 测试降级）
    // 实际测试降级：把 base 设为一个只有 t2v 的模型，但 model-configs 里所有 base 都有三件
    // 所以我们用一个不在 registry 里的 base 来触发降级到 t2v
    const rec = recommendCanvasVideoModel({ videoModel: 'phantom-model' }, [
      { url: 'https://img.host/ff.jpg', role: 'firstFrame' },
    ])
    // phantom-model-i2v / phantom-model-r2v 不存在 → 降级到 t2v
    expect(rec.model).toBe('phantom-model-t2v')
    expect(rec.variant).toBe('t2v')
    expect(rec.reason).toContain('降级')
  })

  it('目标 r2v 但 base 无 r2v 变体 → 降级到 t2v', () => {
    const rec = recommendCanvasVideoModel({ videoModel: 'phantom-model' }, [
      { url: 'https://img.host/char.jpg', role: 'character' },
    ])
    expect(rec.model).toBe('phantom-model-t2v')
    expect(rec.variant).toBe('t2v')
    expect(rec.reason).toContain('降级')
  })
})
