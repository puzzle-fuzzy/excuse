import { describe, expect, it } from 'bun:test'
import {
  CanvasSchemaError,
  validateCharacterProfile,
  validateLocationProfile,
  validateNovelAnalysis,
  validateShotDrafts,
} from '../src'

describe('validateNovelAnalysis', () => {
  it('正常格式的分析直接通过', () => {
    const input = {
      summary: '一个故事',
      mainConflict: '主角对抗反派',
      timeline: ['开端', '高潮'],
      characterNames: ['小明', '小红'],
      sceneNames: ['王城', '森林'],
    }
    expect(validateNovelAnalysis(input)).toEqual(input)
  })

  it('根节点非对象时抛出异常', () => {
    expect(() => validateNovelAnalysis('nope')).toThrow(CanvasSchemaError)
    expect(() => validateNovelAnalysis(null)).toThrow(CanvasSchemaError)
  })

  it('必填字符串字段缺失或类型错误时抛出异常', () => {
    expect(() => validateNovelAnalysis({ mainConflict: 'x' })).toThrow(CanvasSchemaError)
    expect(() => validateNovelAnalysis({ summary: 42, mainConflict: 'x' })).toThrow(CanvasSchemaError)
  })

  it('缺失的数组字段默认为空数组', () => {
    const result = validateNovelAnalysis({ summary: 's', mainConflict: 'c' })
    expect(result.timeline).toEqual([])
    expect(result.characterNames).toEqual([])
    expect(result.sceneNames).toEqual([])
  })
})

describe('validateCharacterProfile', () => {
  const valid = {
    name: '小明',
    role: '主角',
    age: '20',
    gender: '男',
    bodyShape: '瘦',
    height: '175',
    face: { shape: '圆', eyes: '大', eyebrows: '粗', nose: '挺', mouth: '小', skin: '白' },
    hair: { color: '黑', style: '短', length: '短' },
    costume: { mainColor: '蓝', style: '便装', material: '棉', details: ['腰带'] },
    accessories: ['剑'],
    identityPrompt: '一个少年',
    negativePrompt: '畸形',
  }

  it('正常格式的角色档案直接通过', () => {
    expect(validateCharacterProfile(valid)).toEqual(valid)
  })

  it('根节点非对象时抛出异常', () => {
    expect(() => validateCharacterProfile([])).toThrow(CanvasSchemaError)
  })

  it('name 或 identityPrompt 缺失时抛出异常', () => {
    expect(() => validateCharacterProfile({ ...valid, name: undefined })).toThrow(CanvasSchemaError)
    expect(() => validateCharacterProfile({ ...valid, identityPrompt: 1 })).toThrow(CanvasSchemaError)
  })

  it('缺失的嵌套对象和可选字段使用默认值', () => {
    const result = validateCharacterProfile({ name: '小明', identityPrompt: '少年' })
    expect(result.role).toBe('')
    expect(result.face).toEqual({ shape: '', eyes: '', eyebrows: '', nose: '', mouth: '', skin: '' })
    expect(result.hair).toEqual({ color: '', style: '', length: '' })
    expect(result.costume).toEqual({ mainColor: '', style: '', material: '', details: [] })
    expect(result.accessories).toEqual([])
    expect(result.negativePrompt).toBe('')
  })

  it('过滤数组中的非字符串元素', () => {
    const result = validateCharacterProfile({ ...valid, accessories: ['剑', 9, null] })
    expect(result.accessories).toEqual(['剑'])
  })
})

describe('validateLocationProfile', () => {
  const valid = {
    name: '王城',
    type: 'exterior',
    location: '城门口',
    era: '古代',
    atmosphere: '庄严',
    visualRules: { colorPalette: ['灰'], lighting: '强', architecture: '中式', floor: '石', backgroundElements: ['旗'] },
    cameraRules: { axisDirection: '左', allowedAngles: ['平'], forbiddenAngles: ['俯'] },
    scenePrompt: '一座城',
    negativePrompt: '现代',
  }

  it('正常格式的地点档案直接通过', () => {
    expect(validateLocationProfile(valid)).toEqual(valid)
  })

  it('name 或 scenePrompt 缺失时抛出异常', () => {
    expect(() => validateLocationProfile({ ...valid, name: undefined })).toThrow(CanvasSchemaError)
    expect(() => validateLocationProfile({ scenePrompt: 'x' })).toThrow(CanvasSchemaError)
  })

  it('无效的 type 强制转为 mixed', () => {
    const result = validateLocationProfile({ ...valid, type: 'underwater' })
    expect(result.type).toBe('mixed')
  })

  it('缺失的嵌套结构使用默认值', () => {
    const result = validateLocationProfile({ name: '王城', scenePrompt: '一座城' })
    expect(result.visualRules.colorPalette).toEqual([])
    expect(result.cameraRules).toEqual({ axisDirection: '', allowedAngles: [], forbiddenAngles: [] })
    expect(result.type).toBe('mixed')
  })
})

describe('validateShotDrafts', () => {
  const shot = {
    shotIndex: 0,
    duration: 3,
    locationId: 'loc-1',
    characterIds: ['char-1'],
    narrative: '小明走进城',
    camera: { shotSize: '全景', angle: '平', movement: '推', lens: '35mm' },
    continuity: { screenDirection: '左', characterFacing: { char1: '右' }, actionStart: '走', actionEnd: '停', emotionStart: '平静', emotionEnd: '紧张' },
    timeline: [{ time: '0s', action: '走' }],
    environment: { lighting: '日', mood: '平静' },
  }

  it('正常格式的镜头数组直接通过', () => {
    expect(validateShotDrafts([shot])).toEqual([shot])
  })

  it('输入非数组时抛出异常', () => {
    expect(() => validateShotDrafts({})).toThrow(CanvasSchemaError)
  })

  it('空数组时抛出异常', () => {
    expect(() => validateShotDrafts([])).toThrow(CanvasSchemaError)
  })

  it('镜头缺少 narrative 时抛出异常', () => {
    expect(() => validateShotDrafts([{ shotIndex: 0 }])).toThrow(CanvasSchemaError)
  })

  it('shotIndex 缺失时回退到数组索引', () => {
    const [result] = validateShotDrafts([{ narrative: 'x' }, { narrative: 'y' }])
    expect(result.shotIndex).toBe(0)
  })

  it('缺失的可选/嵌套字段使用默认值', () => {
    const [result] = validateShotDrafts([{ narrative: 'x' }])
    expect(result.duration).toBe(0)
    expect(result.locationId).toBeNull()
    expect(result.characterIds).toEqual([])
    expect(result.camera).toEqual({ shotSize: '', angle: '', movement: '', lens: '' })
    expect(result.continuity.characterFacing).toEqual({})
    expect(result.timeline).toBeUndefined()
    expect(result.environment).toBeUndefined()
  })

  it('非字符串的 locationId 置为 null', () => {
    const [result] = validateShotDrafts([{ narrative: 'x', locationId: 42 }])
    expect(result.locationId).toBeNull()
  })
})

describe('CanvasSchemaError', () => {
  it('携带字段名（验证器前缀）和原因', () => {
    try {
      validateNovelAnalysis({})
      throw new Error('should have thrown')
    }
    catch (err) {
      expect(err).toBeInstanceOf(CanvasSchemaError)
      const e = err as CanvasSchemaError
      // zod path 'summary' + validator 前缀 'analysis'
      expect(e.field).toBe('analysis.summary')
      expect(e.reason).toContain('string')
      expect(e.message).toContain('analysis.summary')
    }
  })
})

// ── zod 行为补充（本轮新增） ─────────────────────────────────────────────────

describe('validateCharacterProfile with zod', () => {
  it('最小输入时返回完整填充的档案', () => {
    const result = validateCharacterProfile({ name: 'Alice', identityPrompt: 'hero' })
    expect(result.name).toBe('Alice')
    expect(result.age).toBe('')
    expect(result.face.shape).toBe('')
    expect(result.accessories).toEqual([])
  })

  it('缺少 name 时抛出 CanvasSchemaError', () => {
    expect(() => validateCharacterProfile({ identityPrompt: 'hero' })).toThrow(CanvasSchemaError)
  })

  it('必填字段类型错误时抛出 CanvasSchemaError', () => {
    expect(() => validateCharacterProfile({ name: 42, identityPrompt: 'x' })).toThrow(CanvasSchemaError)
  })

  it('忽略多余字段 (zod strip)', () => {
    const result = validateCharacterProfile({
      name: 'Alice',
      identityPrompt: 'hero',
      extra: 'ignored',
    })
    expect((result as Record<string, unknown>).extra).toBeUndefined()
  })

  it('null/非对象的嵌套 face 强制使用默认值', () => {
    const result = validateCharacterProfile({
      name: 'A',
      identityPrompt: 'h',
      face: null,
      hair: 'not-an-object',
    })
    expect(result.face).toEqual({ shape: '', eyes: '', eyebrows: '', nose: '', mouth: '', skin: '' })
    expect(result.hair).toEqual({ color: '', style: '', length: '' })
  })
})

describe('validateLocationProfile with zod', () => {
  it('无效 type 通过默认值强制转为 mixed', () => {
    const result = validateLocationProfile({ name: 'x', scenePrompt: 'y', type: 'underwater' })
    expect(result.type).toBe('mixed')
  })

  it('保留合法的枚举 type', () => {
    const result = validateLocationProfile({ name: 'x', scenePrompt: 'y', type: 'exterior' })
    expect(result.type).toBe('exterior')
  })

  it('缺少 scenePrompt 时抛出异常', () => {
    expect(() => validateLocationProfile({ name: 'x' })).toThrow(CanvasSchemaError)
  })
})

describe('validateNovelAnalysis with zod', () => {
  it('根节点非对象时抛出异常', () => {
    expect(() => validateNovelAnalysis('nope')).toThrow(CanvasSchemaError)
    expect(() => validateNovelAnalysis(null)).toThrow(CanvasSchemaError)
  })

  it('忽略多余字段', () => {
    const result = validateNovelAnalysis({ summary: 's', mainConflict: 'c', extra: 1 })
    expect((result as Record<string, unknown>).extra).toBeUndefined()
  })
})

describe('validateShotDrafts with zod', () => {
  it('空数组时抛出 CanvasSchemaError', () => {
    expect(() => validateShotDrafts([])).toThrow(CanvasSchemaError)
  })

  it('过滤 characterIds 中的非字符串元素', () => {
    const [result] = validateShotDrafts([{ narrative: 'x', characterIds: ['a', 1, null] }])
    expect(result.characterIds).toEqual(['a'])
  })

  it('非字符串 locationId 强制转为 null', () => {
    const [result] = validateShotDrafts([{ narrative: 'x', locationId: 42 }])
    expect(result.locationId).toBeNull()
  })
})
