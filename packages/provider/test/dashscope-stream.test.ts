import type { DashScopeConfig } from '../src/types'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { DashScopeClient } from '../src/dashscope-client'

// ── 测试配置 ──────────────────────────────────────────────

const config: DashScopeConfig = {
  apiKey: 'test-api-key',
  baseUrl: 'https://dashscope.test.local/api/v1',
}

/** 把 SSE 文本帧数组编码成 ReadableStream */
function makeSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      const enc = new TextEncoder()
      for (const chunk of chunks)
        controller.enqueue(enc.encode(chunk))
      controller.close()
    },
  })
}

/** mock fetch 返回 200 + SSE body */
function mockFetchSSE(chunks: string[]) {
  const originalFetch = globalThis.fetch
  const fn = mock(() => Promise.resolve(new Response(makeSSEStream(chunks), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })))
  globalThis.fetch = Object.assign(fn, { preconnect() {} }) as unknown as typeof fetch
  return () => {
    globalThis.fetch = originalFetch
  }
}

/** mock fetch 返回错误状态 */
function mockFetchError(status: number, body = 'error') {
  const originalFetch = globalThis.fetch
  const fn = mock(() => Promise.resolve(new Response(body, { status })))
  globalThis.fetch = Object.assign(fn, { preconnect() {} }) as unknown as typeof fetch
  return () => {
    globalThis.fetch = originalFetch
  }
}

/** 收集 async generator 输出 */
async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of gen)
    out.push(item)
  return out
}

// ── tests ─────────────────────────────────────────────────

describe('DashScopeClient.chatCompletionStream', () => {
  let client: DashScopeClient
  let restoreFetch: () => void

  beforeEach(() => {
    client = new DashScopeClient(config)
    restoreFetch = () => {}
  })

  afterEach(() => {
    restoreFetch()
  })

  // 用一个简化的 ValidatedModelParameters（仅需 prompt）
  const params = { prompt: 'hello', max_tokens: 1500 } as never

  it('正常流：yield 每个 delta chunk + 最后 usage 帧 + done 帧', async () => {
    restoreFetch = mockFetchSSE([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}],"finish_reason":null}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n',
      'data: [DONE]\n\n',
    ])

    const chunks = await collect(client.chatCompletionStream('qwen3.7-plus', params))

    // 3 个 data + 1 个 [DONE] = 4 个 yield（[DONE] 时 done=true）
    expect(chunks).toHaveLength(4)
    expect(chunks[0]?.delta).toBe('Hello')
    expect(chunks[1]?.delta).toBe(' world')
    // 第三帧：finish_reason='stop' → usage 出现
    expect(chunks[2]?.usage).toEqual({ inputTokens: 5, outputTokens: 2 })
    expect(chunks[2]?.done).toBe(true)
    // 第四帧：[DONE] 标记
    expect(chunks[3]?.delta).toBe('')
    expect(chunks[3]?.done).toBe(true)
  })

  it('模型不存在 → throw', async () => {
    await expect(collect(client.chatCompletionStream('unknown-model', params))).rejects.toThrow(/未知模型/)
  })

  it('chat 协议模型（如 qwen-max）→ throw（仅 openai-chat 支持）', async () => {
    await expect(collect(client.chatCompletionStream('qwen-max', params))).rejects.toThrow(/不支持流式/)
  })

  it('HTTP 500 → throw，错误信息含 status code', async () => {
    restoreFetch = mockFetchError(500, 'upstream down')
    await expect(collect(client.chatCompletionStream('qwen3.7-plus', params))).rejects.toThrow(/500/)
  })

  it('单行 JSON.parse 失败：跳过该行，不终止流', async () => {
    restoreFetch = mockFetchSSE([
      'data: {malformed json}\n\n',
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
      'data: [DONE]\n\n',
    ])

    const chunks = await collect(client.chatCompletionStream('qwen3.7-plus', params))

    // malformed 行被跳过；只有 1 个 delta + 1 个 done
    expect(chunks).toHaveLength(2)
    expect(chunks[0]?.delta).toBe('ok')
    expect(chunks[1]?.done).toBe(true)
  })

  it('data: [DONE] 后立即终止，不再 yield', async () => {
    restoreFetch = mockFetchSSE([
      'data: {"choices":[{"delta":{"content":"first"}}]}\n\n',
      'data: [DONE]\n\n',
      'data: {"choices":[{"delta":{"content":"after done"}}]}\n\n',
    ])

    const chunks = await collect(client.chatCompletionStream('qwen3.7-plus', params))

    // 只 yield 第一个 delta + [DONE] 帧；DONE 之后的行不应被读到
    expect(chunks).toHaveLength(2)
    expect(chunks[0]?.delta).toBe('first')
    expect(chunks[1]?.done).toBe(true)
  })
})
