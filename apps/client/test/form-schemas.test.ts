import type { ModelParameter } from '@/api/client'
import { describe, expect, it } from 'vitest'
import {
  apiKeyCreateSchema,
  buildModelLabSchema,
  loginSchema,
  registerSchema,
} from '@/lib/form-schemas'

function runLogin(values: { email: string, password: string }) {
  return loginSchema.safeParse(values)
}

function runRegister(values: {
  username: string
  email: string
  password: string
  confirmPassword: string
}) {
  return registerSchema.safeParse(values)
}

describe('loginSchema', () => {
  it('rejects empty email and password', () => {
    const result = runLogin({ email: '', password: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map(i => i.message)
      expect(messages).toContain('请填写邮箱和密码')
    }
  })

  it('rejects whitespace-only inputs (trim check)', () => {
    const result = runLogin({ email: '   ', password: '   ' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map(i => i.message)
      expect(messages).toContain('请填写邮箱和密码')
    }
  })

  it('rejects malformed email format', () => {
    const result = runLogin({ email: 'not-an-email', password: 'password' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map(i => i.message)
      expect(messages).toContain('请输入有效的邮箱地址')
    }
  })

  it('accepts a valid login payload', () => {
    const result = runLogin({ email: 'user@example.com', password: 'password123' })
    expect(result.success).toBe(true)
  })

  it('preserves password value verbatim (no trim) for downstream login call', () => {
    const result = runLogin({ email: 'user@example.com', password: '  pwd with spaces  ' })
    expect(result.success).toBe(true)
    if (result.success)
      expect(result.data.password).toBe('  pwd with spaces  ')
  })
})

describe('registerSchema', () => {
  it('rejects empty fields with unified message', () => {
    const result = runRegister({
      username: '',
      email: '',
      password: '',
      confirmPassword: '',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map(i => i.message)
      expect(messages).toContain('请填写所有字段')
    }
  })

  it('rejects short password with field-level message', () => {
    const result = runRegister({
      username: 'alice',
      email: 'alice@example.com',
      password: '12345',
      confirmPassword: '12345',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const matching = result.error.issues.find(i => i.message === '密码至少 6 个字符')
      expect(matching).toBeTruthy()
    }
  })

  it('rejects mismatched passwords', () => {
    const result = runRegister({
      username: 'alice',
      email: 'alice@example.com',
      password: 'password123',
      confirmPassword: 'different123',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const matching = result.error.issues.find(i => i.message === '两次输入的密码不一致')
      expect(matching).toBeTruthy()
    }
  })

  it('accepts a fully valid register payload', () => {
    const result = runRegister({
      username: 'alice',
      email: 'alice@example.com',
      password: 'password123',
      confirmPassword: 'password123',
    })
    expect(result.success).toBe(true)
  })
})

describe('apiKeyCreateSchema', () => {
  it('accepts empty name (optional label)', () => {
    const result = apiKeyCreateSchema.safeParse({ name: '' })
    expect(result.success).toBe(true)
  })

  it('rejects names longer than 100 characters', () => {
    const result = apiKeyCreateSchema.safeParse({ name: 'x'.repeat(101) })
    expect(result.success).toBe(false)
    if (!result.success) {
      const matching = result.error.issues.find(i => i.message === '名称最长 100 个字符')
      expect(matching).toBeTruthy()
    }
  })
})

describe('buildModelLabSchema', () => {
  function parse(schema: ReturnType<typeof buildModelLabSchema>, value: unknown) {
    return schema.safeParse(value)
  }

  it('returns an empty object schema when parameters list is empty', () => {
    const schema = buildModelLabSchema([])
    expect(parse(schema, {}).success).toBe(true)
    expect(parse(schema, { prompt: 'hello' }).success).toBe(true)
  })

  it('builds text model schema with required prompt', () => {
    const parameters: ModelParameter[] = [
      { name: 'prompt', type: 'text', description: '提示词', required: true },
      { name: 'temperature', type: 'number', description: '温度', defaultValue: 0.7 },
    ]
    const schema = buildModelLabSchema(parameters)
    expect(parse(schema, { prompt: 'hello', temperature: 0.7 }).success).toBe(true)
    expect(parse(schema, { prompt: '', temperature: 0.7 }).success).toBe(false)
    expect(parse(schema, { prompt: '   ', temperature: 0.7 }).success).toBe(false)
  })

  it('builds image model schema with required size + optional seed', () => {
    const parameters: ModelParameter[] = [
      { name: 'prompt', type: 'text', description: '提示词', required: true },
      { name: 'size', type: 'select', description: '尺寸', required: true, options: [{ label: '1:1', value: '1024*1024' }] },
      { name: 'seed', type: 'number', description: '种子' },
    ]
    const schema = buildModelLabSchema(parameters)
    expect(parse(schema, { prompt: 'cat', size: '1024*1024', seed: 42 }).success).toBe(true)
    expect(parse(schema, { prompt: 'cat', size: '', seed: 42 }).success).toBe(false)
    expect(parse(schema, { prompt: '', size: '1024*1024', seed: 42 }).success).toBe(false)
  })

  it('builds video model schema with required prompt + optional boolean watermark', () => {
    const parameters: ModelParameter[] = [
      { name: 'prompt', type: 'text', description: '提示词', required: true },
      { name: 'duration', type: 'number', description: '时长（秒）', required: true, defaultValue: 5 },
      { name: 'watermark', type: 'boolean', description: '添加水印' },
    ]
    const schema = buildModelLabSchema(parameters)
    expect(parse(schema, { prompt: 'cat playing', duration: 5, watermark: false }).success).toBe(true)
    expect(parse(schema, { prompt: 'cat playing', duration: 5 }).success).toBe(true)
    expect(parse(schema, { prompt: '', duration: 5 }).success).toBe(false)
    expect(parse(schema, { prompt: 'cat playing', duration: undefined }).success).toBe(false)
  })

  it('builds subtitle model schema with required prompt', () => {
    const parameters: ModelParameter[] = [
      { name: 'prompt', type: 'text', description: '字幕内容', required: true },
    ]
    const schema = buildModelLabSchema(parameters)
    expect(parse(schema, { prompt: 'hello' }).success).toBe(true)
    expect(parse(schema, { prompt: '' }).success).toBe(false)
  })

  it('marks required param errors with the description when present', () => {
    const parameters: ModelParameter[] = [
      { name: 'prompt', type: 'text', description: '提示词', required: true },
    ]
    const schema = buildModelLabSchema(parameters)
    const result = parse(schema, { prompt: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some(i => i.message === '请填写提示词')).toBe(true)
    }
  })

  it('falls back to param name when description is missing', () => {
    const parameters: ModelParameter[] = [
      { name: 'raw_input', type: 'text', required: true },
    ]
    const schema = buildModelLabSchema(parameters)
    const result = parse(schema, { raw_input: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some(i => i.message === '请填写raw_input')).toBe(true)
    }
  })
})
