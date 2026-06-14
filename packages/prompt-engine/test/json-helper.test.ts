import { z } from 'zod'
import { describe, expect, it } from 'bun:test'
import { LLMSchemaValidationError, parseLLMJson, parseLLMJsonWithSchema } from '../src'

describe('parseLLMJson', () => {
  it('should parse clean JSON object', () => {
    const input = '{"name":"test","value":42}'
    const result = parseLLMJson<{ name: string, value: number }>(input)
    expect(result).toEqual({ name: 'test', value: 42 })
  })

  it('should parse clean JSON array', () => {
    const input = '[1,2,3]'
    const result = parseLLMJson<number[]>(input)
    expect(result).toEqual([1, 2, 3])
  })

  it('should strip markdown json code fence', () => {
    const input = '```json\n{"key":"value"}\n```'
    const result = parseLLMJson<{ key: string }>(input)
    expect(result).toEqual({ key: 'value' })
  })

  it('should strip markdown code fence without language tag', () => {
    const input = '```\n{"key":"value"}\n```'
    const result = parseLLMJson<{ key: string }>(input)
    expect(result).toEqual({ key: 'value' })
  })

  it('should extract JSON from surrounding text', () => {
    const input = 'Here is the result:\n{"summary":"hello"}\nEnd of result.'
    const result = parseLLMJson<{ summary: string }>(input)
    expect(result).toEqual({ summary: 'hello' })
  })

  it('should extract JSON array of primitives from surrounding text', () => {
    const input = 'Result:\n["a","b","c"]\nDone.'
    const result = parseLLMJson<string[]>(input)
    expect(result).toEqual(['a', 'b', 'c'])
  })

  it('should extract JSON array of objects from code fence', () => {
    const input = '```json\n[{"id":1},{"id":2}]\n```'
    const result = parseLLMJson<Array<{ id: number }>>(input)
    expect(result).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('should extract JSON array of objects from surrounding text', () => {
    const input = 'Result:\n[{"id":1},{"id":2}]\nDone.'
    const result = parseLLMJson<Array<{ id: number }>>(input)
    expect(result).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('should handle nested JSON objects', () => {
    const input = '{"outer":{"inner":{"deep":true}},"arr":[1,2]}'
    const result = parseLLMJson<{ outer: { inner: { deep: boolean } }, arr: number[] }>(input)
    expect(result.outer.inner.deep).toBe(true)
    expect(result.arr).toEqual([1, 2])
  })

  it('should throw when no JSON found', () => {
    expect(() => parseLLMJson('no json here')).toThrow('Failed to extract JSON')
  })

  it('should throw with truncated input preview', () => {
    const longInput = 'x'.repeat(300)
    expect(() => parseLLMJson(longInput)).toThrow(longInput.slice(0, 200))
  })

  it('should handle whitespace-only input', () => {
    expect(() => parseLLMJson('   ')).toThrow('Failed to extract JSON')
  })

  it('should handle JSON in code fence with extra whitespace', () => {
    const input = '```json\n  \n  {"a": 1}  \n  \n```'
    const result = parseLLMJson<{ a: number }>(input)
    expect(result).toEqual({ a: 1 })
  })

  it('should handle real-world LLM output with preamble', () => {
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

  it('returns typed value on valid JSON', () => {
    const result = parseLLMJsonWithSchema('{"name":"foo","value":42}', schema)
    expect(result.name).toBe('foo')
    expect(result.value).toBe(42)
  })

  it('parses JSON wrapped in markdown fence', () => {
    const result = parseLLMJsonWithSchema('```json\n{"name":"foo","value":42}\n```', schema)
    expect(result.name).toBe('foo')
    expect(result.value).toBe(42)
  })

  it('parses JSON extracted from surrounding text', () => {
    const result = parseLLMJsonWithSchema(
      'Result:\n{"name":"foo","value":42}\nDone.',
      schema,
    )
    expect(result.name).toBe('foo')
  })

  it('throws LLMSchemaValidationError on schema mismatch (wrong field type)', () => {
    expect(() =>
      parseLLMJsonWithSchema('{"name":"foo","value":"not a number"}', schema),
    ).toThrow(LLMSchemaValidationError)
  })

  it('throws LLMSchemaValidationError on missing required field', () => {
    expect(() =>
      parseLLMJsonWithSchema('{"name":"foo"}', schema),
    ).toThrow(LLMSchemaValidationError)
  })

  it('error carries zodError + rawPreview (≤ 200 chars)', () => {
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

  it('preserves parseLLMJson behavior on non-JSON input (throws base Error)', () => {
    expect(() => parseLLMJsonWithSchema('no json here', schema)).toThrow('Failed to extract JSON')
    expect(() => parseLLMJsonWithSchema('no json here', schema)).not.toThrow(LLMSchemaValidationError)
  })

  it('distinguishes schema error from JSON parse error via instanceof', () => {
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

  it('works with array schema (z.array)', () => {
    const arrSchema = z.array(z.object({ id: z.number() }))
    const result = parseLLMJsonWithSchema('[{"id":1},{"id":2}]', arrSchema)
    expect(result).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('works with .loose() schema — extra fields passthrough', () => {
    const looseSchema = z.object({ name: z.string() }).loose()
    const result = parseLLMJsonWithSchema('{"name":"foo","extra":"bar"}', looseSchema)
    expect(result.name).toBe('foo')
    expect((result as Record<string, unknown>).extra).toBe('bar')
  })
})
