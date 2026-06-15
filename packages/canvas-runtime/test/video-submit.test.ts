import type { ValidatedModelParameters } from '@excuse/provider'
import type { ModelConfig } from '@excuse/shared'
import { describe, expect, it } from 'bun:test'
import { prepareCanvasVideoParams } from '../src'

const baseVideoModel: ModelConfig = {
  id: 'test-video',
  name: 'Test Video',
  category: 'video',
  type: 'generation',
  description: 'test video model',
  endpoint: '/test',
  async: true,
  pricing: { inputPriceCents: 100, unit: 'video' },
  parameters: [
    { name: 'prompt', type: 'text', required: true },
    { name: 'resolution', type: 'select', required: true, options: [{ label: '720P', value: '720P' }] },
    { name: 'duration', type: 'number', required: true, min: 1, max: 10 },
  ],
}

const modelWithNegativePrompt: ModelConfig = {
  ...baseVideoModel,
  id: 'test-video-negative',
  parameters: [
    ...baseVideoModel.parameters,
    { name: 'negative_prompt', type: 'text' },
  ],
}

function asValidated(params: Record<string, unknown>): ValidatedModelParameters {
  return params as ValidatedModelParameters
}

function makeDeps(modelConfig: ModelConfig, overrides?: {
  mergeWithDefaults?: (modelConfig: ModelConfig, params: Record<string, unknown>) => Record<string, unknown>
}) {
  const mergeWithDefaults = overrides?.mergeWithDefaults ?? ((_modelConfig: ModelConfig, params: Record<string, unknown>) => params)
  return {
    getModelById: (model: string) => model === modelConfig.id ? modelConfig : undefined,
    validateAndMerge: (config: ModelConfig, params: Record<string, unknown>) => {
      const errors: Array<{ field: string, message: string }> = []

      if (typeof params.duration === 'number' && params.duration > 10)
        errors.push({ field: 'duration', message: 'duration is too large' })

      for (const key of Object.keys(params)) {
        if (!config.parameters.some(param => param.name === key))
          errors.push({ field: key, message: 'unknown parameter' })
      }

      if (errors.length > 0)
        return { ok: false as const, errors }

      return { ok: true as const, params: asValidated(mergeWithDefaults(config, params)) }
    },
  }
}

describe('canvas 视频运行时', () => {
  describe('prepareCanvasVideoParams', () => {
    it('视频模型未声明 negative_prompt 时省略该字段', () => {
      const { params } = prepareCanvasVideoParams('test-video', {
        videoPrompt: 'stable cinematic shot',
        negativePrompt: 'no shake',
        duration: 5,
      }, makeDeps(baseVideoModel))

      expect(params.prompt).toBe('stable cinematic shot')
      expect(params.resolution).toBe('720P')
      expect(params.duration).toBe(5)
      expect(params.negative_prompt).toBeUndefined()
    })

    it('视频模型声明 negative_prompt 时保留该字段', () => {
      const { params } = prepareCanvasVideoParams('test-video-negative', {
        videoPrompt: 'stable cinematic shot',
        negativePrompt: 'no shake',
        duration: 5,
      }, makeDeps(modelWithNegativePrompt))

      expect(params.prompt).toBe('stable cinematic shot')
      expect(params.negative_prompt).toBe('no shake')
    })

    it('提交 provider 任务前拒绝无效 duration', () => {
      expect(() =>
        prepareCanvasVideoParams('test-video', {
          videoPrompt: 'stable cinematic shot',
          duration: 99,
        }, makeDeps(baseVideoModel)),
      ).toThrow('视频参数校验失败')
    })

    it('provider 默认值合并后拒绝格式错误的参数', () => {
      expect(() =>
        prepareCanvasVideoParams('test-video', {
          videoPrompt: 'stable cinematic shot',
          duration: 5,
        }, makeDeps(baseVideoModel, {
          mergeWithDefaults: (_modelConfig, params) => ({ ...params, resolution: '4K' }),
        })),
      ).toThrow('resolution 必须是 720P 或 1080P')
    })
  })
})
