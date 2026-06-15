import { parseLLMJson } from '@excuse/prompt-engine'
import { describe, expect, it } from 'bun:test'

describe('parseLLMJson', () => {
  it('解析干净的 JSON object', () => {
    const input = '{"name":"test","value":42}'
    const result = parseLLMJson<{ name: string, value: number }>(input)
    expect(result).toEqual({ name: 'test', value: 42 })
  })

  it('解析干净的 JSON array', () => {
    const input = '[1,2,3]'
    const result = parseLLMJson<number[]>(input)
    expect(result).toEqual([1, 2, 3])
  })

  it('去除 markdown json 代码围栏', () => {
    const input = '```json\n{"key":"value"}\n```'
    const result = parseLLMJson<{ key: string }>(input)
    expect(result).toEqual({ key: 'value' })
  })

  it('去除无语言标签的 markdown 代码围栏', () => {
    const input = '```\n{"key":"value"}\n```'
    const result = parseLLMJson<{ key: string }>(input)
    expect(result).toEqual({ key: 'value' })
  })

  it('从周围文本中提取 JSON', () => {
    const input = 'Here is the result:\n{"summary":"hello"}\nEnd of result.'
    const result = parseLLMJson<{ summary: string }>(input)
    expect(result).toEqual({ summary: 'hello' })
  })

  it('从周围文本中提取原始值 JSON array', () => {
    const input = 'Result:\n["a","b","c"]\nDone.'
    const result = parseLLMJson<string[]>(input)
    expect(result).toEqual(['a', 'b', 'c'])
  })

  it('从代码围栏中提取对象 JSON array', () => {
    const input = '```json\n[{"id":1},{"id":2}]\n```'
    const result = parseLLMJson<Array<{ id: number }>>(input)
    expect(result).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('从周围文本中提取对象 JSON array', () => {
    const input = 'Result:\n[{"id":1},{"id":2}]\nDone.'
    const result = parseLLMJson<Array<{ id: number }>>(input)
    expect(result).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('处理嵌套 JSON object', () => {
    const input = '{"outer":{"inner":{"deep":true}},"arr":[1,2]}'
    const result = parseLLMJson<{ outer: { inner: { deep: boolean } }, arr: number[] }>(input)
    expect(result.outer.inner.deep).toBe(true)
    expect(result.arr).toEqual([1, 2])
  })

  it('未找到 JSON 时抛出异常', () => {
    expect(() => parseLLMJson('no json here')).toThrow('Failed to extract JSON')
  })

  it('截断输入预览抛出异常', () => {
    const longInput = 'x'.repeat(300)
    expect(() => parseLLMJson(longInput)).toThrow(longInput.slice(0, 200))
  })

  it('处理纯空白输入', () => {
    expect(() => parseLLMJson('   ')).toThrow('Failed to extract JSON')
  })

  it('处理代码围栏中多余空白的 JSON', () => {
    const input = '```json\n  \n  {"a": 1}  \n  \n```'
    const result = parseLLMJson<{ a: number }>(input)
    expect(result).toEqual({ a: 1 })
  })

  it('处理带前导文本的真实 LLM 输出', () => {
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
