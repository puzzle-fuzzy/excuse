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
  it('拒绝空邮箱和密码', () => {
    const result = runLogin({ email: '', password: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map(i => i.message)
      expect(messages).toContain('请填写邮箱和密码')
    }
  })

  it('拒绝纯空白输入（trim 检查）', () => {
    const result = runLogin({ email: '   ', password: '   ' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map(i => i.message)
      expect(messages).toContain('请填写邮箱和密码')
    }
  })

  it('拒绝格式错误的邮箱', () => {
    const result = runLogin({ email: 'not-an-email', password: 'password' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map(i => i.message)
      expect(messages).toContain('请输入有效的邮箱地址')
    }
  })

  it('接受有效登录数据', () => {
    const result = runLogin({ email: 'user@example.com', password: 'password123' })
    expect(result.success).toBe(true)
  })

  it('保留密码原值（不 trim）供下游登录调用', () => {
    const result = runLogin({ email: 'user@example.com', password: '  pwd with spaces  ' })
    expect(result.success).toBe(true)
    if (result.success)
      expect(result.data.password).toBe('  pwd with spaces  ')
  })
})

describe('registerSchema', () => {
  it('空字段统一提示', () => {
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

  it('短密码字段级提示', () => {
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

  it('拒绝不匹配的密码', () => {
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

  it('接受完全有效的注册数据', () => {
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
  it('接受空名称（可选标签）', () => {
    const result = apiKeyCreateSchema.safeParse({ name: '' })
    expect(result.success).toBe(true)
  })

  it('拒绝超过 100 字符的名称', () => {
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

  it('参数列表为空时返回空对象 schema', () => {
    const schema = buildModelLabSchema([])
    expect(parse(schema, {}).success).toBe(true)
    expect(parse(schema, { prompt: 'hello' }).success).toBe(true)
  })

  it('构建含必填 prompt 的文本模型 schema', () => {
    const parameters: ModelParameter[] = [
      { name: 'prompt', type: 'text', description: '提示词', required: true },
      { name: 'temperature', type: 'number', description: '温度', defaultValue: 0.7 },
    ]
    const schema = buildModelLabSchema(parameters)
    expect(parse(schema, { prompt: 'hello', temperature: 0.7 }).success).toBe(true)
    expect(parse(schema, { prompt: '', temperature: 0.7 }).success).toBe(false)
    expect(parse(schema, { prompt: '   ', temperature: 0.7 }).success).toBe(false)
  })

  it('构建含必填 size + 可选 seed 的图像模型 schema', () => {
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

  it('构建含必填 prompt + 可选 boolean watermark 的视频模型 schema', () => {
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

  it('构建含必填 prompt 的字幕模型 schema', () => {
    const parameters: ModelParameter[] = [
      { name: 'prompt', type: 'text', description: '字幕内容', required: true },
    ]
    const schema = buildModelLabSchema(parameters)
    expect(parse(schema, { prompt: 'hello' }).success).toBe(true)
    expect(parse(schema, { prompt: '' }).success).toBe(false)
  })

  it('必填参数错误时使用 description 作为提示', () => {
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

  it('description 缺失时回退到参数名', () => {
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
