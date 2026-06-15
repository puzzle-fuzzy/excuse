import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { LLMSchemaValidationError, parseLLMJson, parseLLMJsonWithSchema } from '../src'

describe('parseLLMJson', () => {
  it('解析干净的 JSON 对象', () => {
    const input = '{"name":"test","value":42}'
    const result = parseLLMJson<{ name: string, value: number }>(input)
    expect(result).toEqual({ name: 'test', value: 42 })
  })

  it('解析干净的 JSON 数组', () => {
    const input = '[1,2,3]'
    const result = parseLLMJson<number[]>(input)
    expect(result).toEqual([1, 2, 3])
  })

  it('去除 markdown json 代码块围栏', () => {
    const input = '```json\n{"key":"value"}\n```'
    const result = parseLLMJson<{ key: string }>(input)
    expect(result).toEqual({ key: 'value' })
  })

  it('去除无语言标签的 markdown 代码块围栏', () => {
    const input = '```\n{"key":"value"}\n```'
    const result = parseLLMJson<{ key: string }>(input)
    expect(result).toEqual({ key: 'value' })
  })

  it('从周围文本中提取 JSON', () => {
    const input = 'Here is the result:\n{"summary":"hello"}\nEnd of result.'
    const result = parseLLMJson<{ summary: string }>(input)
    expect(result).toEqual({ summary: 'hello' })
  })

  it('从周围文本中提取基本类型 JSON 数组', () => {
    const input = 'Result:\n["a","b","c"]\nDone.'
    const result = parseLLMJson<string[]>(input)
    expect(result).toEqual(['a', 'b', 'c'])
  })

  it('从代码块围栏中提取 JSON 对象数组', () => {
    const input = '```json\n[{"id":1},{"id":2}]\n```'
    const result = parseLLMJson<Array<{ id: number }>>(input)
    expect(result).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('从周围文本中提取 JSON 对象数组', () => {
    const input = 'Result:\n[{"id":1},{"id":2}]\nDone.'
    const result = parseLLMJson<Array<{ id: number }>>(input)
    expect(result).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('处理嵌套 JSON 对象', () => {
    const input = '{"outer":{"inner":{"deep":true}},"arr":[1,2]}'
    const result = parseLLMJson<{ outer: { inner: { deep: boolean } }, arr: number[] }>(input)
    expect(result.outer.inner.deep).toBe(true)
    expect(result.arr).toEqual([1, 2])
  })

  it('找不到 JSON 时抛出异常', () => {
    expect(() => parseLLMJson('no json here')).toThrow('Failed to extract JSON')
  })

  it('抛出异常时包含截断输入预览', () => {
    const longInput = 'x'.repeat(300)
    expect(() => parseLLMJson(longInput)).toThrow(longInput.slice(0, 200))
  })

  it('处理纯空白输入', () => {
    expect(() => parseLLMJson('   ')).toThrow('Failed to extract JSON')
  })

  it('处理代码块围栏中带额外空白的 JSON', () => {
    const input = '```json\n  \n  {"a": 1}  \n  \n```'
    const result = parseLLMJson<{ a: number }>(input)
    expect(result).toEqual({ a: 1 })
  })

  it('处理真实 LLM 输出（带前导文本）', () => {
    const input = `根据您的要求，分析结果如下：

\`\`\`json
{
  "summary": "一个关于少年的成长故事",
  "mainConflict": "内心的挣扎",
  "timeline": ["开端", "发展", "高潮"],
  "characterNames": ["小明", "小红"],
  "sceneNames": ["学校", "家"]
}
\`\`\`

希望这个分析对您有帮助。`
    const result = parseLLMJson<{
      summary: string
      mainConflict: string
      timeline: string[]
      characterNames: string[]
      sceneNames: string[]
    }>(input)
    expect(result.summary).toBe('一个关于少年的成长故事')
    expect(result.characterNames).toEqual(['小明', '小红'])
  })
})

describe('parseLLMJsonWithSchema', () => {
  const schema = z.object({ name: z.string(), value: z.number() })

  it('有效 JSON 时返回带类型的值', () => {
    const result = parseLLMJsonWithSchema('{"name":"foo","value":42}', schema)
    expect(result.name).toBe('foo')
    expect(result.value).toBe(42)
  })

  it('解析 markdown 围栏包裹的 JSON', () => {
    const result = parseLLMJsonWithSchema('```json\n{"name":"foo","value":42}\n```', schema)
    expect(result.name).toBe('foo')
    expect(result.value).toBe(42)
  })

  it('从周围文本中提取 JSON', () => {
    const result = parseLLMJsonWithSchema(
      'Result:\n{"name":"foo","value":42}\nDone.',
      schema,
    )
    expect(result.name).toBe('foo')
  })

  it('schema 不匹配（字段类型错误）时抛出 LLMSchemaValidationError', () => {
    expect(() =>
      parseLLMJsonWithSchema('{"name":"foo","value":"not a number"}', schema),
    ).toThrow(LLMSchemaValidationError)
  })

  it('缺少必填字段时抛出 LLMSchemaValidationError', () => {
    expect(() =>
      parseLLMJsonWithSchema('{"name":"foo"}', schema),
    ).toThrow(LLMSchemaValidationError)
  })

  it('错误携带 zodError + rawPreview（≤ 200 字符）', () => {
    const raw = '{"name":"foo","value":"x"} extra padding '.repeat(20)
    try {
      parseLLMJsonWithSchema(raw, schema)
      expect.fail('should have thrown')
    }
    catch (err) {
      expect(err).toBeInstanceOf(LLMSchemaValidationError)
      const e = err as LLMSchemaValidationError
      expect(e.rawPreview.length).toBeLessThanOrEqual(200)
      expect(e.zodError.issues.length).toBeGreaterThan(0)
      expect(e.message).toContain('LLM output failed schema validation')
    }
  })

  it('zodError.issues 含 value 字段路径', () => {
    try {
      parseLLMJsonWithSchema('{"name":"foo","value":"x"}', schema)
      expect.fail('should have thrown')
    }
    catch (err) {
      const e = err as LLMSchemaValidationError
      const paths = e.zodError.issues.map(i => i.path.join('.'))
      expect(paths).toContain('value')
    }
  })

  it('非 JSON 输入时保留 parseLLMJson 行为（抛出基础 Error）', () => {
    expect(() => parseLLMJsonWithSchema('no json here', schema)).toThrow('Failed to extract JSON')
    expect(() => parseLLMJsonWithSchema('no json here', schema)).not.toThrow(LLMSchemaValidationError)
  })

  it('通过 instanceof 区分 schema 错误与 JSON 解析错误', () => {
    let caught: unknown
    try {
      parseLLMJsonWithSchema('{"name":"foo","value":"x"}', schema)
    }
    catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(LLMSchemaValidationError)
    expect(caught).toBeInstanceOf(Error)
    expect((caught as LLMSchemaValidationError).name).toBe('LLMSchemaValidationError')

    let jsonError: unknown
    try {
      parseLLMJsonWithSchema('not json', schema)
    }
    catch (err) {
      jsonError = err
    }
    expect(jsonError).not.toBeInstanceOf(LLMSchemaValidationError)
    expect(jsonError).toBeInstanceOf(Error)
  })

  it('支持 array schema（z.array）', () => {
    const arrSchema = z.array(z.object({ id: z.number() }))
    const result = parseLLMJsonWithSchema('[{"id":1},{"id":2}]', arrSchema)
    expect(result).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('支持 .loose() schema — 额外字段透传', () => {
    const looseSchema = z.object({ name: z.string() }).loose()
    const result = parseLLMJsonWithSchema('{"name":"foo","extra":"bar"}', looseSchema)
    expect(result.name).toBe('foo')
    expect((result as Record<string, unknown>).extra).toBe('bar')
  })
})
