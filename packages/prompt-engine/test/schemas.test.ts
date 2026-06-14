import { describe, expect, it } from 'bun:test'
import { canvasCharacterSchema, canvasLocationSchema } from '../src/schemas'

describe('canvasCharacterSchema', () => {
  const validCharacter = {
    name: '小明',
    identityPrompt: 'a boy with glasses',
  }

  it('accepts minimal character (only required fields)', () => {
    const result = canvasCharacterSchema.safeParse(validCharacter)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('小明')
      expect(result.data.identityPrompt).toBe('a boy with glasses')
    }
  })

  it('accepts full character with all nested fields', () => {
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

  it('rejects missing name', () => {
    const result = canvasCharacterSchema.safeParse({ identityPrompt: 'x' })
    expect(result.success).toBe(false)
  })

  it('rejects missing identityPrompt', () => {
    const result = canvasCharacterSchema.safeParse({ name: 'foo' })
    expect(result.success).toBe(false)
  })

  it('rejects non-string name', () => {
    const result = canvasCharacterSchema.safeParse({ name: 42, identityPrompt: 'x' })
    expect(result.success).toBe(false)
  })

  it('preserves unknown top-level fields via .loose()', () => {
    const result = canvasCharacterSchema.safeParse({ ...validCharacter, unknownField: 'extra' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect((result.data as Record<string, unknown>).unknownField).toBe('extra')
    }
  })

  it('preserves unknown nested face fields via .loose()', () => {
    const result = canvasCharacterSchema.safeParse({
      ...validCharacter,
      face: { shape: 'round', extraFaceField: 'x' },
    })
    expect(result.success).toBe(true)
  })

  it('optional role defaults to undefined when missing', () => {
    const result = canvasCharacterSchema.safeParse(validCharacter)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.role).toBeUndefined()
    }
  })

  it('accepts empty string name (LLM 抖动容忍，与 canvas-engine validateCharacterProfile 一致)', () => {
    const result = canvasCharacterSchema.safeParse({ name: '', identityPrompt: 'x' })
    expect(result.success).toBe(true)
  })
})

describe('canvasLocationSchema', () => {
  const validLocation = {
    name: '学校',
    scenePrompt: 'a school',
  }

  it('accepts minimal location (only required fields)', () => {
    const result = canvasLocationSchema.safeParse(validLocation)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('学校')
      expect(result.data.scenePrompt).toBe('a school')
    }
  })

  it('accepts full location with all nested fields', () => {
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

  it('rejects missing name', () => {
    const result = canvasLocationSchema.safeParse({ scenePrompt: 'x' })
    expect(result.success).toBe(false)
  })

  it('rejects missing scenePrompt', () => {
    const result = canvasLocationSchema.safeParse({ name: 'foo' })
    expect(result.success).toBe(false)
  })

  it('rejects unknown type enum value', () => {
    const result = canvasLocationSchema.safeParse({
      ...validLocation,
      type: 'unknown_type',
    })
    expect(result.success).toBe(false)
  })

  it('accepts valid type values (interior / exterior / mixed)', () => {
    for (const type of ['interior', 'exterior', 'mixed'] as const) {
      const result = canvasLocationSchema.safeParse({ ...validLocation, type })
      expect(result.success).toBe(true)
    }
  })

  it('preserves unknown fields via .loose()', () => {
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
