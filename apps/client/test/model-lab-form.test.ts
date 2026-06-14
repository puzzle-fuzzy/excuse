import type { ModelParameter } from '@/api/client'
import { describe, expect, it } from 'vitest'
import { buildModelLabSchema } from '@/lib/form-schemas'

function run(schema: ReturnType<typeof buildModelLabSchema>, values: unknown) {
  return schema.safeParse(values)
}

describe('buildModelLabSchema — 4 categories', () => {
  it('text model: requires prompt, allows optional number temperature', () => {
    const parameters: ModelParameter[] = [
      { name: 'prompt', type: 'text', description: '提示词', required: true },
      { name: 'temperature', type: 'number', description: '温度' },
    ]
    const schema = buildModelLabSchema(parameters)
    expect(run(schema, { prompt: 'hello', temperature: 0.5 }).success).toBe(true)
    expect(run(schema, { prompt: 'hello' }).success).toBe(true)
    expect(run(schema, { prompt: '' }).success).toBe(false)
  })

  it('image model: requires prompt + size; optional seed', () => {
    const parameters: ModelParameter[] = [
      { name: 'prompt', type: 'text', description: '提示词', required: true },
      {
        name: 'size',
        type: 'select',
        description: '尺寸',
        required: true,
        options: [
          { label: '1:1', value: '1024*1024' },
          { label: '16:9', value: '1280*720' },
        ],
      },
      { name: 'seed', type: 'number', description: '随机种子' },
    ]
    const schema = buildModelLabSchema(parameters)
    expect(run(schema, { prompt: 'cat', size: '1024*1024', seed: 42 }).success).toBe(true)
    expect(run(schema, { prompt: 'cat', size: '1024*1024' }).success).toBe(true)
    expect(run(schema, { prompt: '', size: '1024*1024' }).success).toBe(false)
    expect(run(schema, { prompt: 'cat', size: '' }).success).toBe(false)
  })

  it('video model: requires prompt + duration; optional boolean watermark', () => {
    const parameters: ModelParameter[] = [
      { name: 'prompt', type: 'text', description: '提示词', required: true },
      { name: 'duration', type: 'number', description: '时长（秒）', required: true, defaultValue: 5 },
      { name: 'watermark', type: 'boolean', description: '添加水印' },
    ]
    const schema = buildModelLabSchema(parameters)
    expect(run(schema, { prompt: 'sunset', duration: 5, watermark: false }).success).toBe(true)
    expect(run(schema, { prompt: 'sunset', duration: 5 }).success).toBe(true)
    expect(run(schema, { prompt: '', duration: 5 }).success).toBe(false)
    expect(run(schema, { prompt: 'sunset' }).success).toBe(false)
  })

  it('subtitle model: requires prompt', () => {
    const parameters: ModelParameter[] = [
      { name: 'prompt', type: 'text', description: '字幕内容', required: true },
    ]
    const schema = buildModelLabSchema(parameters)
    expect(run(schema, { prompt: '字幕内容' }).success).toBe(true)
    expect(run(schema, { prompt: '' }).success).toBe(false)
  })
})

describe('buildModelLabSchema — required validation messages', () => {
  it('marks all required fields individually', () => {
    const parameters: ModelParameter[] = [
      { name: 'prompt', type: 'text', description: '提示词', required: true },
      { name: 'size', type: 'select', description: '尺寸', required: true, options: [] },
    ]
    const schema = buildModelLabSchema(parameters)
    const result = run(schema, { prompt: '', size: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map(i => i.message)
      expect(messages).toContain('请填写提示词')
      expect(messages).toContain('请填写尺寸')
    }
  })

  it('falls back to param name when description missing', () => {
    const parameters: ModelParameter[] = [
      { name: 'raw_field', type: 'text', required: true },
    ]
    const schema = buildModelLabSchema(parameters)
    const result = run(schema, { raw_field: '' })
    expect(result.success).toBe(false)
    if (!result.success)
      expect(result.error.issues.some(i => i.message === '请填写raw_field')).toBe(true)
  })

  it('attaches issues to the field path so RHF can surface them as formState.errors.<field>', () => {
    const parameters: ModelParameter[] = [
      { name: 'prompt', type: 'text', description: '提示词', required: true },
    ]
    const schema = buildModelLabSchema(parameters)
    const result = run(schema, { prompt: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const promptIssue = result.error.issues.find(i => i.path.includes('prompt'))
      expect(promptIssue).toBeTruthy()
      expect(promptIssue?.message).toBe('请填写提示词')
    }
  })

  it('accepts empty parameters list as a no-op schema', () => {
    const schema = buildModelLabSchema([])
    expect(run(schema, {}).success).toBe(true)
    expect(run(schema, { random: 'value' }).success).toBe(true)
  })

  it('tolerates extra fields alongside declared params (form state may carry UI-only flags)', () => {
    const parameters: ModelParameter[] = [
      { name: 'prompt', type: 'text', required: true },
    ]
    const schema = buildModelLabSchema(parameters)
    const result = run(schema, { prompt: 'hello', extraField: 'ignored' })
    expect(result.success).toBe(true)
  })

  it('treats missing optional fields as valid (form may not register them at submit time)', () => {
    const parameters: ModelParameter[] = [
      { name: 'prompt', type: 'text', required: true },
      { name: 'seed', type: 'number' },
    ]
    const schema = buildModelLabSchema(parameters)
    expect(run(schema, { prompt: 'hello' }).success).toBe(true)
  })

  it('rejects optional number = undefined when explicitly passed as undefined', () => {
    const parameters: ModelParameter[] = [
      { name: 'prompt', type: 'text', required: true },
      { name: 'duration', type: 'number', required: true, defaultValue: 5 },
    ]
    const schema = buildModelLabSchema(parameters)
    expect(run(schema, { prompt: 'hello', duration: undefined }).success).toBe(false)
  })
})
