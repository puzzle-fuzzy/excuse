import type { ModelConfig } from '@excuse/shared'
import { describe, expect, it } from 'bun:test'
import { mergeWithDefaults, validateAndMerge, validateModelParameters } from '../src/model-validator'

// ── 测试用的模型配置 ──────────────────────────────────

const TEXT_MODEL: ModelConfig = {
  id: 'test-text',
  name: 'Test Text',
  category: 'text',
  type: 'generation',
  description: 'Test',
  endpoint: 'https://test.local',
  async: false,
  pricing: { inputPriceCents: 100, outputPriceCents: 200, unit: 'token' },
  requestType: 'chat',
  inputMapping: {},
  parameters: [
    { name: 'prompt', type: 'text', required: true, description: '输入文本' },
    { name: 'temperature', type: 'number', defaultValue: 0.7, min: 0, max: 2, description: '温度' },
    { name: 'seed', type: 'number', min: 0, max: 2147483647, description: '种子' },
    { name: 'top_p', type: 'number', defaultValue: 0.9, min: 0, max: 1, description: '核采样' },
  ],
}

const IMAGE_MODEL: ModelConfig = {
  id: 'test-image',
  name: 'Test Image',
  category: 'image',
  type: 'generation',
  description: 'Test',
  endpoint: 'https://test.local',
  async: false,
  pricing: { inputPriceCents: 25, unit: 'image' },
  requestType: 'image',
  inputMapping: {},
  parameters: [
    { name: 'prompt', type: 'text', required: true, description: '提示词' },
    { name: 'size', type: 'select', defaultValue: '2048*2048', description: '尺寸', options: [
      { label: '2048x2048', value: '2048*2048' },
      { label: '1536x2688', value: '1536*2688' },
    ] },
    { name: 'n', type: 'number', defaultValue: 1, min: 1, max: 6, description: '数量' },
    { name: 'watermark', type: 'boolean', defaultValue: false, description: '水印' },
    { name: 'negative_prompt', type: 'text', description: '反向提示词' },
  ],
}

const VIDEO_MODEL: ModelConfig = {
  id: 'test-video-i2v',
  name: 'Test Video i2v',
  category: 'video',
  type: 'generation',
  description: 'Test',
  endpoint: 'https://test.local',
  async: true,
  pricing: { inputPriceCents: 50, inputPrice1080Cents: 100, unit: 'video' },
  requestType: 'video-media',
  inputMapping: {},
  parameters: [
    { name: 'prompt', type: 'text', description: '提示词' },
    { name: 'first_frame_url', type: 'text', required: true, mediaUpload: { accept: 'image/*' }, description: '首帧' },
    { name: 'resolution', type: 'select', defaultValue: '1080P', description: '分辨率', options: [
      { label: '720P', value: '720P' },
      { label: '1080P', value: '1080P' },
    ] },
    { name: 'duration', type: 'number', defaultValue: 5, min: 2, max: 15, description: '时长' },
    { name: 'seed', type: 'number', min: 0, max: 2147483647, description: '种子' },
  ],
}

// ── validateModelParameters ──────────────────────────────

describe('validateModelParameters', () => {
  describe('文本模型', () => {
    it('合法参数通过校验', () => {
      const result = validateModelParameters(TEXT_MODEL, {
        prompt: '你好',
        temperature: 0.5,
      })
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('必填参数缺失时报错', () => {
      const result = validateModelParameters(TEXT_MODEL, {})
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors.some(e => e.field === 'prompt')).toBe(true)
      expect(result.errors.some(e => e.message.includes('必填'))).toBe(true)
    })

    it('必填参数为空字符串时报错', () => {
      const result = validateModelParameters(TEXT_MODEL, { prompt: '' })
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.field === 'prompt')).toBe(true)
    })

    it('数值参数类型错误时报错', () => {
      const result = validateModelParameters(TEXT_MODEL, {
        prompt: '你好',
        temperature: 'hot', // 应为 number
      })
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.field === 'temperature')).toBe(true)
    })

    it('数值参数低于最小值时报错', () => {
      const result = validateModelParameters(TEXT_MODEL, {
        prompt: '你好',
        temperature: -0.1, // min=0
      })
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.field === 'temperature' && e.message.includes('最小值'))).toBe(true)
    })

    it('数值参数超过最大值时报错', () => {
      const result = validateModelParameters(TEXT_MODEL, {
        prompt: '你好',
        temperature: 3, // max=2
      })
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.field === 'temperature' && e.message.includes('最大值'))).toBe(true)
    })

    it('未知参数报错', () => {
      const result = validateModelParameters(TEXT_MODEL, {
        prompt: '你好',
        unknown_param: 'value',
      })
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.field === 'unknown_param')).toBe(true)
      expect(result.errors.some(e => e.message.includes('未知参数'))).toBe(true)
    })

    it('NaN 数值报错', () => {
      const result = validateModelParameters(TEXT_MODEL, {
        prompt: '你好',
        seed: Number.NaN,
      })
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.field === 'seed')).toBe(true)
    })

    it('可选参数未提供时不报错', () => {
      const result = validateModelParameters(TEXT_MODEL, {
        prompt: '你好',
        // temperature, seed, top_p 未提供 → 用 defaultValue，不报错
      })
      expect(result.valid).toBe(true)
    })
  })

  describe('图像模型', () => {
    it('select 参数不在 options 内时报错', () => {
      const result = validateModelParameters(IMAGE_MODEL, {
        prompt: '风景',
        size: '999*999', // 不在 options 中
      })
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.field === 'size')).toBe(true)
      expect(result.errors.some(e => e.message.includes('可选范围'))).toBe(true)
    })

    it('select 参数在 options 内时通过', () => {
      const result = validateModelParameters(IMAGE_MODEL, {
        prompt: '风景',
        size: '2048*2048',
      })
      expect(result.valid).toBe(true)
    })

    it('boolean 参数类型错误时报错', () => {
      const result = validateModelParameters(IMAGE_MODEL, {
        prompt: '风景',
        watermark: 'yes', // 应为 boolean
      })
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.field === 'watermark' && e.message.includes('布尔值'))).toBe(true)
    })

    it('n 超出范围时报错', () => {
      const result = validateModelParameters(IMAGE_MODEL, {
        prompt: '风景',
        n: 10, // max=6
      })
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.field === 'n' && e.message.includes('最大值'))).toBe(true)
    })
  })

  describe('视频模型', () => {
    it('i2v 模型缺少 first_frame_url 报错', () => {
      const result = validateModelParameters(VIDEO_MODEL, {
        prompt: '一段视频',
        // first_frame_url 缺失
      })
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.field === 'first_frame_url')).toBe(true)
    })

    it('duration 超出范围时报错', () => {
      const result = validateModelParameters(VIDEO_MODEL, {
        prompt: '一段视频',
        first_frame_url: 'https://example.com/img.png',
        duration: 1, // min=2
      })
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.field === 'duration')).toBe(true)
    })
  })

  describe('多个错误同时返回', () => {
    it('多个校验失败时返回所有错误', () => {
      const result = validateModelParameters(TEXT_MODEL, {
        // prompt 缺失 + temperature 越界 + 未知参数
        temperature: 5,
        unknown_param: true,
      })
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThanOrEqual(3)
      // prompt 缺失
      expect(result.errors.some(e => e.field === 'prompt')).toBe(true)
      // temperature 越界
      expect(result.errors.some(e => e.field === 'temperature')).toBe(true)
      // unknown_param 未知
      expect(result.errors.some(e => e.field === 'unknown_param')).toBe(true)
    })

    it('多个未知参数时都返回错误，不只报第一个', () => {
      const result = validateModelParameters(TEXT_MODEL, {
        prompt: '你好',
        foo: 1,
        bar: 2,
      })
      expect(result.valid).toBe(false)
      expect(result.errors.filter(e => e.message.includes('未知参数')).length).toBe(2)
      expect(result.errors.some(e => e.field === 'foo')).toBe(true)
      expect(result.errors.some(e => e.field === 'bar')).toBe(true)
    })
  })

  describe('类型错误边界', () => {
    it('select 参数非 string 时报错', () => {
      const result = validateModelParameters(IMAGE_MODEL, {
        prompt: '风景',
        size: 42,
      })
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.field === 'size' && e.message.includes('字符串'))).toBe(true)
    })

    it('text 参数非 string 时报错', () => {
      const result = validateModelParameters(TEXT_MODEL, {
        prompt: 123,
      })
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.field === 'prompt' && e.message.includes('字符串'))).toBe(true)
    })

    it('null 可选参数不触发类型错误', () => {
      const result = validateModelParameters(TEXT_MODEL, {
        prompt: '你好',
        temperature: null,
      })
      expect(result.valid).toBe(true)
    })
  })
})

// ── mergeWithDefaults ──────────────────────────────────

describe('mergeWithDefaults', () => {
  it('用户参数覆盖默认值', () => {
    const merged = mergeWithDefaults(TEXT_MODEL, { prompt: '你好', temperature: 0.3 })
    expect(merged.prompt).toBe('你好')
    expect(merged.temperature).toBe(0.3)
    // top_p 未提供 → defaultValue
    expect(merged.top_p).toBe(0.9)
  })

  it('完全未提供参数时全部使用默认值', () => {
    const merged = mergeWithDefaults(TEXT_MODEL, { prompt: '你好' })
    expect(merged.temperature).toBe(0.7)
    expect(merged.top_p).toBe(0.9)
  })

  it('不补填 required 参数缺失（应由 validateModelParameters 拦截）', () => {
    const merged = mergeWithDefaults(TEXT_MODEL, {})
    // prompt 没有 defaultValue 且未提供 → merged 中不含 prompt
    expect(merged.prompt).toBeUndefined()
  })

  it('select defaultValue 被正确使用', () => {
    const merged = mergeWithDefaults(IMAGE_MODEL, { prompt: '风景' })
    expect(merged.size).toBe('2048*2048')
    expect(merged.n).toBe(1)
    expect(merged.watermark).toBe(false)
  })
})

// ── validateAndMerge ─────────────────────────────────────

describe('validateAndMerge', () => {
  it('ok 分支：返回 params，补齐 optional defaultValue', () => {
    const result = validateAndMerge(TEXT_MODEL, { prompt: '你好' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.params.prompt).toBe('你好')
      expect(result.params.temperature).toBe(0.7) // defaultValue
      expect(result.params.top_p).toBe(0.9) // defaultValue
    }
  })

  it('ok 分支：不覆盖用户显式传入值', () => {
    const result = validateAndMerge(TEXT_MODEL, {
      prompt: '你好',
      temperature: 0.3,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.params.temperature).toBe(0.3) // 用户值，不是 defaultValue 0.7
      expect(result.params.top_p).toBe(0.9) // 未提供 → defaultValue
    }
  })

  it('error 分支：返回 errors，不返回 params', () => {
    const result = validateAndMerge(TEXT_MODEL, {})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors.some(e => e.field === 'prompt')).toBe(true)
    }
  })

  it('error 分支：errors 为字段级错误', () => {
    const result = validateAndMerge(TEXT_MODEL, {
      temperature: 'hot',
      unknown_param: 1,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      // prompt 缺失、temperature 类型错误、unknown_param 未知
      expect(result.errors.length).toBeGreaterThanOrEqual(3)
      expect(result.errors.some(e => e.field === 'prompt')).toBe(true)
      expect(result.errors.some(e => e.field === 'temperature')).toBe(true)
      expect(result.errors.some(e => e.field === 'unknown_param')).toBe(true)
    }
  })
})
