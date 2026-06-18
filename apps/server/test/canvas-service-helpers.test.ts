import { describe, expect, it } from 'bun:test'
import { assertNotGenerating, DEFAULT_IMAGE_MODEL, DEFAULT_TEXT_MODEL, getImageModel, getTextModel, getVideoModel } from '../src/modules/canvas/service-helpers'
import { ConflictError } from '../src/utils/app-errors'

// ── getTextModel ───────────────────────────────────────

describe('getTextModel', () => {
  it('优先返回用户偏好的模型', () => {
    expect(getTextModel({ textModel: 'custom-model' })).toBe('custom-model')
  })

  it('prefs 为空对象时回退到默认模型', () => {
    expect(getTextModel({})).toBe(DEFAULT_TEXT_MODEL)
  })

  it('prefs 为 null 时回退到默认模型', () => {
    expect(getTextModel(null)).toBe(DEFAULT_TEXT_MODEL)
  })

  it('prefs 为 undefined 时回退到默认模型', () => {
    expect(getTextModel(undefined)).toBe(DEFAULT_TEXT_MODEL)
  })

  it('textModel 为空字符串时回退到默认模型（|| 语义）', () => {
    expect(getTextModel({ textModel: '' })).toBe(DEFAULT_TEXT_MODEL)
  })
})

// ── getImageModel ──────────────────────────────────────

describe('getImageModel', () => {
  it('优先返回用户偏好的模型', () => {
    expect(getImageModel({ imageModel: 'custom-image-model' })).toBe('custom-image-model')
  })

  it('prefs 为空对象时回退到默认模型', () => {
    expect(getImageModel({})).toBe(DEFAULT_IMAGE_MODEL)
  })

  it('prefs 为 null 时回退到默认模型', () => {
    expect(getImageModel(null)).toBe(DEFAULT_IMAGE_MODEL)
  })

  it('imageModel 为空字符串时回退到默认模型', () => {
    expect(getImageModel({ imageModel: '' })).toBe(DEFAULT_IMAGE_MODEL)
  })
})

// ── getVideoModel ──────────────────────────────────────

describe('getVideoModel', () => {
  it('delegates 到 getCanvasVideoModel', () => {
    // Bun 的 mock 是在模块层面操作的；这里我们只验证它返回一个 string 且不为空
    const model = getVideoModel({ videoModel: 'qwen-video-max' }, [])
    expect(typeof model).toBe('string')
    expect(model.length).toBeGreaterThan(0)
  })

  it('传入空 prefs 时也返回有效模型名', () => {
    const model = getVideoModel({}, [])
    expect(typeof model).toBe('string')
    expect(model.length).toBeGreaterThan(0)
  })

  it('传入 null prefs 时也返回有效模型名', () => {
    const model = getVideoModel(null, [])
    expect(typeof model).toBe('string')
    expect(model.length).toBeGreaterThan(0)
  })

  it('传入 referenceUrls 时传递给 getCanvasVideoModel（不抛异常）', () => {
    expect(() => getVideoModel(null, ['https://example.com/ref.png'])).not.toThrow()
  })
})

// ── assertNotGenerating ────────────────────────────────

describe('assertNotGenerating', () => {
  it('status 为 "generating" 时抛出异常', () => {
    expect(() => assertNotGenerating('generating')).toThrow('项目正在生成中，请等待完成后再操作')
  })

  it('status 为 "generating" 时抛 ConflictError（statusCode=409）', () => {
    try {
      assertNotGenerating('generating')
      expect.unreachable('应抛 ConflictError')
    }
    catch (err) {
      expect(err).toBeInstanceOf(ConflictError)
      expect((err as ConflictError).statusCode).toBe(409)
      expect((err as Error).message).toBe('项目正在生成中，请等待完成后再操作')
    }
  })

  it('status 为 null 时通过', () => {
    expect(() => assertNotGenerating(null)).not.toThrow()
  })

  it('status 为 undefined 时通过', () => {
    expect(() => assertNotGenerating(undefined)).not.toThrow()
  })

  it('status 为非 generating 字符串时通过', () => {
    expect(() => assertNotGenerating('draft')).not.toThrow()
    expect(() => assertNotGenerating('completed')).not.toThrow()
    expect(() => assertNotGenerating('analyzed')).not.toThrow()
  })

  it('status 为空字符串时通过', () => {
    expect(() => assertNotGenerating('')).not.toThrow()
  })
})
