import { describe, expect, it } from 'bun:test'
import { canvasCharacterSchema, canvasLocationSchema } from '../src/schemas'

describe('canvasCharacterSchema', () => {
  const validCharacter = {
    name: '小明',
    identityPrompt: 'a boy with glasses',
  }

  it('接受最小角色（仅必填字段）', () => {
    const result = canvasCharacterSchema.safeParse(validCharacter)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('小明')
      expect(result.data.identityPrompt).toBe('a boy with glasses')
    }
  })

  it('接受包含所有嵌套字段的完整角色', () => {
    const result = canvasCharacterSchema.safeParse({
      name: '小明',
      role: '主角',
      age: '18',
      gender: '男',
      bodyShape: 'slim',
      height: '175cm',
      face: { shape: 'round', eyes: 'big', eyebrows: 'thick', nose: 'small', mouth: 'wide', skin: 'fair' },
      hair: { color: 'black', style: 'short', length: 'above-ear' },
      costume: { mainColor: 'blue', style: 'casual', material: 'cotton', details: ['button', 'pocket'] },
      accessories: ['watch'],
      identityPrompt: 'a boy with glasses',
      negativePrompt: 'blurry',
    })
    expect(result.success).toBe(true)
  })

  it('拒绝缺少 name', () => {
    const result = canvasCharacterSchema.safeParse({ identityPrompt: 'x' })
    expect(result.success).toBe(false)
  })

  it('拒绝缺少 identityPrompt', () => {
    const result = canvasCharacterSchema.safeParse({ name: 'foo' })
    expect(result.success).toBe(false)
  })

  it('拒绝非字符串 name', () => {
    const result = canvasCharacterSchema.safeParse({ name: 42, identityPrompt: 'x' })
    expect(result.success).toBe(false)
  })

  it('通过 .loose() 透传未知顶层字段', () => {
    const result = canvasCharacterSchema.safeParse({ ...validCharacter, unknownField: 'extra' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect((result.data as Record<string, unknown>).unknownField).toBe('extra')
    }
  })

  it('通过 .loose() 透传未知 face 嵌套字段', () => {
    const result = canvasCharacterSchema.safeParse({
      ...validCharacter,
      face: { shape: 'round', extraFaceField: 'x' },
    })
    expect(result.success).toBe(true)
  })

  it('可选 role 缺失时默认为 undefined', () => {
    const result = canvasCharacterSchema.safeParse(validCharacter)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.role).toBeUndefined()
    }
  })

  it('接受空字符串 name（LLM 抖动容忍，与 canvas-engine validateCharacterProfile 一致）', () => {
    const result = canvasCharacterSchema.safeParse({ name: '', identityPrompt: 'x' })
    expect(result.success).toBe(true)
  })
})

describe('canvasLocationSchema', () => {
  const validLocation = {
    name: '学校',
    scenePrompt: 'a school',
  }

  it('接受最小场景（仅必填字段）', () => {
    const result = canvasLocationSchema.safeParse(validLocation)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('学校')
      expect(result.data.scenePrompt).toBe('a school')
    }
  })

  it('接受包含所有嵌套字段的完整场景', () => {
    const result = canvasLocationSchema.safeParse({
      name: '学校',
      type: 'interior',
      location: '北京',
      era: 'modern',
      atmosphere: 'lively',
      visualRules: {
        colorPalette: ['blue', 'white'],
        lighting: 'bright',
        architecture: 'modern',
        floor: 'tile',
        backgroundElements: ['desk', 'blackboard'],
      },
      cameraRules: {
        axisDirection: 'left-to-right',
        allowedAngles: ['wide', 'medium'],
        forbiddenAngles: ['dutch'],
      },
      scenePrompt: 'a school',
      negativePrompt: 'blurry',
    })
    expect(result.success).toBe(true)
  })

  it('拒绝缺少 name', () => {
    const result = canvasLocationSchema.safeParse({ scenePrompt: 'x' })
    expect(result.success).toBe(false)
  })

  it('拒绝缺少 scenePrompt', () => {
    const result = canvasLocationSchema.safeParse({ name: 'foo' })
    expect(result.success).toBe(false)
  })

  it('拒绝未知 type 枚举值', () => {
    const result = canvasLocationSchema.safeParse({
      ...validLocation,
      type: 'unknown_type',
    })
    expect(result.success).toBe(false)
  })

  it('接受有效 type 值（interior / exterior / mixed）', () => {
    for (const type of ['interior', 'exterior', 'mixed'] as const) {
      const result = canvasLocationSchema.safeParse({ ...validLocation, type })
      expect(result.success).toBe(true)
    }
  })

  it('通过 .loose() 透传未知字段', () => {
    const result = canvasLocationSchema.safeParse({
      ...validLocation,
      customField: 'extra',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect((result.data as Record<string, unknown>).customField).toBe('extra')
    }
  })
})
