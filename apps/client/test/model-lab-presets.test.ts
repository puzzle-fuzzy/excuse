import type { ModelConfig } from '../src/api/client'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  loadCanvasModelDefaults,
  modelToCanvasPreferencePatch,
  saveCanvasModelDefaults,
} from '../src/lib/model-lab-presets'

function makeStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  }
}

function makeModel(category: ModelConfig['category'], id: string): ModelConfig {
  return {
    id,
    name: id,
    category,
    type: 'generation',
    description: '',
    endpoint: '',
    async: false,
    pricing: { unit: 'token', inputPriceCents: 1 },
    parameters: [],
  }
}

beforeEach(() => {
  localStorage.clear()
})

describe('model lab 预设', () => {
  it('映射模型类别到 canvas 偏好键', () => {
    expect(modelToCanvasPreferencePatch(makeModel('text', 'qwen-plus'))).toEqual({ textModel: 'qwen-plus' })
    expect(modelToCanvasPreferencePatch(makeModel('image', 'qwen-image'))).toEqual({ imageModel: 'qwen-image' })
    expect(modelToCanvasPreferencePatch(makeModel('video', 'wanx'))).toEqual({ videoModel: 'wanx' })
    expect(modelToCanvasPreferencePatch(makeModel('subtitle', 'asr'))).toEqual({})
  })

  it('保存并合并 canvas 默认值', () => {
    const storage = makeStorage()

    saveCanvasModelDefaults({ textModel: 'qwen-plus' }, storage)
    const saved = saveCanvasModelDefaults({ imageModel: 'qwen-image' }, storage)

    expect(saved.preferences).toEqual({ textModel: 'qwen-plus', imageModel: 'qwen-image' })
    expect(loadCanvasModelDefaults(storage)?.preferences).toEqual(saved.preferences)
  })

  it('无效存储值返回 null', () => {
    const storage = makeStorage()
    storage.setItem('excuse:model-lab:canvas-defaults', '{bad json')

    expect(loadCanvasModelDefaults(storage)).toBeNull()
  })
})
