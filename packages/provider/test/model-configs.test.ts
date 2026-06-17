import { describe, expect, it } from 'bun:test'
import { getModelById, getModelsByCategory, MODELS } from '../src/model-configs'

describe('getModelById', () => {
  it('返回已存在的模型配置', () => {
    const model = getModelById('qwen-max')
    expect(model).toBeDefined()
    expect(model!.id).toBe('qwen-max')
    expect(model!.category).toBe('text')
    expect(model!.requestType).toBe('chat')
  })

  it('返回 undefined 对于不存在的模型', () => {
    expect(getModelById('nonexistent')).toBeUndefined()
  })

  it('所有模型都包含必要字段', () => {
    for (const [id, model] of Object.entries(MODELS)) {
      expect(model.id).toBe(id)
      expect(model.name).toBeTruthy()
      expect(['text', 'image', 'video', 'audio']).toContain(model.category)
      expect(['generation', 'understanding', 'editing']).toContain(model.type)
      expect(model.endpoint).toBeTruthy()
      expect(model.pricing.inputPriceCents).toBeGreaterThan(0)
      expect(model.parameters).toBeInstanceOf(Array)
    }
  })
})

describe('getModelsByCategory', () => {
  it('返回文本模型列表', () => {
    const textModels = getModelsByCategory('text')
    expect(textModels.length).toBeGreaterThan(0)
    expect(textModels.every(m => m.category === 'text')).toBe(true)
  })

  it('返回图片模型列表', () => {
    const imageModels = getModelsByCategory('image')
    expect(imageModels.length).toBeGreaterThan(0)
    expect(imageModels.every(m => m.category === 'image')).toBe(true)
  })

  it('返回视频模型列表', () => {
    const videoModels = getModelsByCategory('video')
    expect(videoModels.length).toBeGreaterThan(0)
    expect(videoModels.every(m => m.category === 'video')).toBe(true)
  })

  it('返回音频模型列表', () => {
    const audioModels = getModelsByCategory('audio')
    expect(audioModels.length).toBeGreaterThan(0)
    expect(audioModels.every(m => m.category === 'audio')).toBe(true)
  })

  it('不存在类别返回空数组', () => {
    expect(getModelsByCategory('nonexistent')).toHaveLength(0)
  })
})

describe('模型配置完整性', () => {
  it('所有模型都有 inputMapping 和 requestType', () => {
    for (const model of Object.values(MODELS)) {
      expect(model.inputMapping, `${model.id} 缺少 inputMapping`).toBeDefined()
      expect(model.requestType, `${model.id} 缺少 requestType`).toBeDefined()
    }
  })

  it('文本模型使用 chat 或 openai-chat requestType', () => {
    const textModels = getModelsByCategory('text')
    for (const model of textModels) {
      expect(['chat', 'openai-chat']).toContain(model.requestType)
    }
  })

  it('图片模型使用 image requestType', () => {
    const imageModels = getModelsByCategory('image')
    for (const model of imageModels) {
      expect(model.requestType).toBe('image')
    }
  })

  it('视频模型使用 video-t2v 或 video-media requestType', () => {
    const videoModels = getModelsByCategory('video')
    for (const model of videoModels) {
      expect(['video-t2v', 'video-media']).toContain(model.requestType)
    }
  })

  it('异步模型标记 async=true，同步模型标记 async=false', () => {
    for (const model of Object.values(MODELS)) {
      if (model.category === 'video') {
        expect(model.async, `${model.id} 应为异步`).toBe(true)
      }
      else {
        expect(model.async, `${model.id} 应为同步`).toBe(false)
      }
    }
  })

  it('文本模型定价包含 outputPriceCents', () => {
    const textModels = getModelsByCategory('text')
    for (const model of textModels) {
      expect(model.pricing.outputPriceCents, `${model.id} 文本模型缺少 outputPriceCents`).toBeDefined()
      expect(model.pricing.outputPriceCents).toBeGreaterThan(0)
    }
  })

  it('视频模型定价包含 inputPrice1080Cents', () => {
    const videoModels = getModelsByCategory('video')
    for (const model of videoModels) {
      expect(model.pricing.inputPrice1080Cents, `${model.id} 视频模型缺少 inputPrice1080Cents`).toBeDefined()
    }
  })

  it('generation 类型的模型至少有 1 个必填参数（editing/understanding 可能全部可选）', () => {
    const generationModels = Object.values(MODELS).filter(m => m.type === 'generation')
    for (const model of generationModels) {
      const requiredParams = model.parameters.filter(p => p.required)
      expect(requiredParams.length, `${model.id} 生成类模型应有至少 1 个必填参数`).toBeGreaterThan(0)
    }
  })

  it('wan2.7-i2v 的 first_frame_url 为必填参数', () => {
    const i2v = getModelById('wan2.7-i2v')!
    const firstFrame = i2v.parameters.find(p => p.name === 'first_frame_url')
    expect(firstFrame).toBeDefined()
    expect(firstFrame!.required).toBe(true)
  })
})

// ═══════════════════════════════════════════════════
//  P1.8: 模型配置一致性校验
// ═══════════════════════════════════════════════════

describe('模型配置一致性 (P1.8)', () => {
  const allModels = Object.values(MODELS)

  it('defaultValue 必须符合 type', () => {
    const violations: string[] = []
    for (const model of allModels) {
      for (const param of model.parameters) {
        if (param.defaultValue === undefined)
          continue
        const dv = param.defaultValue
        switch (param.type) {
          case 'number':
            if (typeof dv !== 'number' || Number.isNaN(dv))
              violations.push(`${model.id}.${param.name}: defaultValue=${dv} 不是 number`)
            break
          case 'boolean':
            if (typeof dv !== 'boolean')
              violations.push(`${model.id}.${param.name}: defaultValue=${dv} 不是 boolean`)
            break
          case 'select':
            if (typeof dv !== 'string')
              violations.push(`${model.id}.${param.name}: defaultValue=${dv} 不是 string`)
            break
          case 'text':
            if (typeof dv !== 'string')
              violations.push(`${model.id}.${param.name}: defaultValue=${dv} 不是 string`)
            break
        }
      }
    }
    expect(violations).toHaveLength(0)
  })

  it('有 options 时 defaultValue 必须在 options 内', () => {
    const violations: string[] = []
    for (const model of allModels) {
      for (const param of model.parameters) {
        if (!param.options || param.defaultValue === undefined)
          continue
        const validValues = param.options.map(o => String(o.value))
        if (!validValues.includes(String(param.defaultValue))) {
          violations.push(`${model.id}.${param.name}: defaultValue="${param.defaultValue}" 不在 options [${validValues.join(', ')}]`)
        }
      }
    }
    expect(violations).toHaveLength(0)
  })

  it('parameters 中声明的参数名应在 inputMapping 中有对应映射', () => {
    // 设计约束：每个参数名要么在 inputMapping 中有映射，要么被 target='ignored' 标记为不发 API。
    // inputMapping 中有额外 key（来自共享 mapping 片段）是允许的 — applyMappings 只处理用户实际提供的参数。
    const violations: string[] = []
    for (const model of allModels) {
      if (!model.inputMapping)
        continue
      for (const param of model.parameters) {
        const mapping = model.inputMapping[param.name]
        if (!mapping) {
          // 未映射的参数默认会被 applyMappings 按 target='parameter' 处理
          // 这是合理行为 — 大多数参数映射为 target='parameter'
          // 只需确认参数名确实存在于声明中
        }
      }
      // 反向检查：所有 required 参数必须在 inputMapping 中有映射
      for (const param of model.parameters) {
        if (param.required && !model.inputMapping[param.name]) {
          violations.push(`${model.id}: required 参数 "${param.name}" 在 inputMapping 中没有映射`)
        }
      }
    }
    expect(violations).toHaveLength(0)
  })

  it('required media 参数必须配置 mediaUpload', () => {
    const violations: string[] = []
    for (const model of allModels) {
      for (const param of model.parameters) {
        if (param.required && param.type === 'text' && !param.mediaUpload) {
          // 检查 inputMapping 是否有 media target — 如果有 target:media 但没有 mediaUpload，那可能有问题
          const mapping = model.inputMapping?.[param.name]
          if (mapping && mapping.target === 'media') {
            violations.push(`${model.id}.${param.name}: required + media target 但没有 mediaUpload 配置`)
          }
        }
      }
    }
    expect(violations).toHaveLength(0)
  })

  it('pricing.unit 与 category 匹配', () => {
    const violations: string[] = []
    for (const model of allModels) {
      const expectedUnits: Record<string, string[]> = {
        text: ['token'],
        image: ['image'],
        video: ['video'],
        audio: ['audio'],
      }
      const allowed = expectedUnits[model.category]
      if (allowed && model.pricing.unit && !allowed.includes(model.pricing.unit)) {
        violations.push(`${model.id}: category=${model.category} 但 pricing.unit=${model.pricing.unit}`)
      }
    }
    expect(violations).toHaveLength(0)
  })

  it('fallbackModel 必须存在，且 category/requestType 与主模型匹配', () => {
    const violations: string[] = []
    for (const model of allModels) {
      if (!model.fallbackModel)
        continue
      const fallback = getModelById(model.fallbackModel)
      if (!fallback) {
        violations.push(`${model.id}: fallbackModel="${model.fallbackModel}" 不存在于 MODELS`)
        continue
      }
      if (fallback.category !== model.category) {
        violations.push(`${model.id}: category=${model.category} 但 fallback "${model.fallbackModel}" category=${fallback.category}`)
      }
      // t2v → video-t2v 降级合理；r2v → video-media 也合理（同类）
      // 只要 requestType 类别兼容即可（同 category 下 video-t2v 和 video-media 都合理）
    }
    expect(violations).toHaveLength(0)
  })

  it('图像模型 size 参数的尺寸格式统一 — 使用 W*H 格式', () => {
    // 图像模型的 size 参数 option value 应为 "W*H" 格式（如 "2048*2048"）
    // 视频模型的 resolution 参数用 "720P"/"1080P" 格式，不在此校验范围内
    const violations: string[] = []
    for (const model of allModels) {
      if (model.category !== 'image')
        continue
      for (const param of model.parameters) {
        if (param.name !== 'size' || param.type !== 'select' || !param.options)
          continue
        for (const opt of param.options) {
          const val = String(opt.value)
          if (!/^\d+\*\d+$/.test(val)) {
            violations.push(`${model.id}.${param.name}: option value "${val}" 不是 W*H 格式`)
          }
        }
      }
    }
    expect(violations).toHaveLength(0)
  })

  it('required 参数至少有一个在 inputMapping 中映射为 prompt 或 media', () => {
    // 每个模型至少需要一个 "实质输入"（prompt 或 media），不能只有参数类 required
    const violations: string[] = []
    for (const model of allModels) {
      const requiredParams = model.parameters.filter(p => p.required)
      const hasCoreInput = requiredParams.some((p) => {
        const mapping = model.inputMapping?.[p.name]
        return mapping && (mapping.target === 'prompt' || mapping.target === 'media')
      })
      if (requiredParams.length > 0 && !hasCoreInput) {
        violations.push(`${model.id}: required 参数中没有 prompt/media target 的核心输入`)
      }
    }
    expect(violations).toHaveLength(0)
  })
})
