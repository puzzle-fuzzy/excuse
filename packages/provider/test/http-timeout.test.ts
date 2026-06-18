import type { DashScopeConfig } from '../src/types'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { DashScopeClient } from '../src/dashscope-client'
import { DEFAULT_HTTP_TIMEOUT_MS, DEFAULT_STREAM_IDLE_TIMEOUT_MS, isAbortError } from '../src/http-timeout'

/**
 * docs/TODO.md §1.1：provider fetch 全链路超时验收。
 *
 * 验证：
 * - 同步调用 hang → 超时后返回 FailedProviderResult 且 code='TIMEOUT'（可被 task-engine 重试分类）。
 * - 网络错误（非超时）→ code='ECONNRESET'。
 * - 默认超时值导出正确；未配置超时时仍施加默认 signal。
 *
 * 防挂死设计：mock fetch **感知 init.signal**，signal abort 即 reject；
 * 并叠加 2s 硬兜底 reject，确保即便 signal 机制异常测试也不会无限挂起。
 */

function mockFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): typeof fetch {
  const fn = mock(impl)
  return Object.assign(fn, { preconnect() {} }) as unknown as typeof fetch
}

/** 永不主动 resolve 的 fetch，但感知 abort signal —— signal 触发或 2s 兜底即 reject。 */
function hangingUntilAbortFetch(): typeof fetch {
  return mockFetch((_input, init) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal as AbortSignal | undefined
    const fail = (reason: unknown) => reject(reason instanceof Error ? reason : new Error('aborted'))
    // 硬兜底：即便 signal 机制失效，2s 后也 reject，杜绝测试挂死
    const safety = setTimeout(() => fail(new Error('mock safety timeout')), 2000)
    if (signal) {
      if (signal.aborted) {
        clearTimeout(safety)
        fail(signal.reason)
        return
      }
      signal.addEventListener('abort', () => {
        clearTimeout(safety)
        fail(signal.reason)
      })
    }
  }))
}

describe('provider http timeout (TODO §1.1)', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('导出默认超时常量', () => {
    expect(DEFAULT_HTTP_TIMEOUT_MS).toBe(60_000)
    expect(DEFAULT_STREAM_IDLE_TIMEOUT_MS).toBe(30_000)
  })

  it('同步调用超时 → FailedProviderResult code=TIMEOUT', async () => {
    globalThis.fetch = hangingUntilAbortFetch()

    const client = new DashScopeClient({
      apiKey: 'test-key',
      httpTimeoutMs: 50, // 极短，测试快速
    })

    const result = await client.chatCompletion('qwen3.7-plus', { prompt: 'hi' })

    expect(result.type).toBe('failed')
    if (result.type === 'failed') {
      expect(result.code).toBe('TIMEOUT')
      expect(result.error).toContain('超时')
    }
  })

  it('网络错误（非超时）→ code=ECONNRESET（可重试）', async () => {
    globalThis.fetch = mockFetch(() => Promise.reject(new Error('ECONNREFUSED connect failed')))

    const client = new DashScopeClient({ apiKey: 'test-key', httpTimeoutMs: 50 })

    const result = await client.generateImage('qwen-image-2.0-pro', { prompt: 'hi' })

    expect(result.type).toBe('failed')
    if (result.type === 'failed')
      expect(result.code).toBe('ECONNRESET')
  })

  it('未配置 httpTimeoutMs 时使用默认 60s（仍施加 signal）', async () => {
    let capturedInit: RequestInit | undefined
    globalThis.fetch = mockFetch((_input, init) => {
      capturedInit = init
      return Promise.resolve(new Response(JSON.stringify({
        output: { choices: [{ message: { content: 'x' } }] },
        usage: {},
      }), { status: 200 }))
    })

    const client = new DashScopeClient({ apiKey: 'test-key' } satisfies DashScopeConfig)
    await client.chatCompletion('qwen3.7-plus', { prompt: 'hi' })

    // signal 存在即说明施加了超时（默认 60s）
    expect(capturedInit?.signal).toBeDefined()
  })
})
