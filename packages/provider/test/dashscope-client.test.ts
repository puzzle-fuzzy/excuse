import type { DashScopeConfig } from '../src/types'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { __resetProviderCallObservers, DashScopeClient, registerProviderCallObserver } from '../src/dashscope-client'

// ── 测试配置 ──────────────────────────────────────────────

const config: DashScopeConfig = {
  apiKey: 'test-api-key',
  baseUrl: 'https://dashscope.test.local/api/v1',
}

// ── fetch mock 工具 ────────────────────────────────────────

/** 创建符合 typeof fetch 的 mock，补齐 preconnect 等静态方法 */
function mockFetch(
  impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  const fn = mock(impl)
  return Object.assign(fn, { preconnect() {} }) as unknown as typeof fetch
}

function asRecord(value: unknown): Record<string, unknown> {
  expect(value).toBeDefined()
  expect(value).not.toBeNull()
  expect(typeof value).toBe('object')
  return value as Record<string, unknown>
}

function parseJsonBody(init?: RequestInit): Record<string, unknown> {
  const body = init?.body
  if (typeof body !== 'string')
    throw new Error('Expected fetch body to be a JSON string')
  const parsed: unknown = JSON.parse(body)
  return asRecord(parsed)
}

function mockFetchResponse(status: number, body: unknown) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = mockFetch(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status })),
  )
  return () => {
    globalThis.fetch = originalFetch
  }
}

function mockFetchError(error: Error) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = mockFetch(() => Promise.reject(error))
  return () => {
    globalThis.fetch = originalFetch
  }
}

// ── tests ─────────────────────────────────────────────────

describe('DashScopeClient', () => {
  let client: DashScopeClient
  let restoreFetch: () => void

  beforeEach(() => {
    client = new DashScopeClient(config)
    restoreFetch = () => {}
  })

  afterEach(() => {
    restoreFetch()
  })

  // 避免测试间互相影响，每个 it 结束后恢复 fetch
  function withMock(status: number, body: unknown) {
    restoreFetch = mockFetchResponse(status, body)
  }
  function withMockError(error: Error) {
    restoreFetch = mockFetchError(error)
  }

  // ── chatCompletion ──

  describe('chatCompletion', () => {
    it('成功返回文本内容', async () => {
      withMock(200, {
        output: {
          choices: [{
            message: { content: [{ text: '你好世界' }] },
          }],
        },
        usage: { input_tokens: 100, output_tokens: 50 },
      })

      const result = await client.chatCompletion('qwen-max', { prompt: '你好' })

      expect(result.success).toBe(true)
      expect(result.output!.text).toBe('你好世界')
      expect(result.usage!.inputTokens).toBe(100)
      expect(result.usage!.outputTokens).toBe(50)
    })

    it('未知模型返回错误', async () => {
      const result = await client.chatCompletion('nonexistent-model', {})

      expect(result.success).toBe(false)
      expect(result.error).toContain('未知模型')
    })

    it('API 返回非 200 时解析错误', async () => {
      withMock(400, {
        code: 'InvalidParameter',
        message: '参数错误',
      })

      const result = await client.chatCompletion('qwen-max', { prompt: 'test' })

      expect(result.success).toBe(false)
      expect(result.error).toContain('请求参数有误')
    })

    it('网络错误返回友好消息', async () => {
      withMockError(new Error('ECONNREFUSED'))

      const result = await client.chatCompletion('qwen-max', { prompt: 'test' })

      expect(result.success).toBe(false)
      expect(result.error).toContain('网络错误')
    })

    it('正确构建 chat 请求体（messages 格式）', async () => {
      let capturedBody: Record<string, unknown> | null = null

      globalThis.fetch = mockFetch((_url, init) => {
        capturedBody = parseJsonBody(init)
        return Promise.resolve(new Response(JSON.stringify({
          output: { choices: [{ message: { content: [{ text: 'ok' }] } }] },
          usage: {},
        }), { status: 200 }))
      })

      await client.chatCompletion('qwen-max', { prompt: '你好', temperature: 0.5 })

      const input = asRecord(capturedBody?.input)
      const messages = input.messages as Array<Record<string, unknown>>
      const parameters = asRecord(capturedBody?.parameters)
      expect(capturedBody?.model).toBe('qwen-max')
      expect(messages[0]?.role).toBe('user')
      expect(messages[0]?.content).toBe('你好')
      expect(parameters.temperature).toBe(0.5)
      expect(parameters.result_format).toBe('message')
    })

    it('正确构建 openai-chat 请求体（qwen3.7-plus）', async () => {
      let capturedBody: Record<string, unknown> | null = null

      globalThis.fetch = mockFetch((_url, init) => {
        capturedBody = parseJsonBody(init)
        return Promise.resolve(new Response(JSON.stringify({
          choices: [{ message: { content: '分析结果', role: 'assistant' } }],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        }), { status: 200 }))
      })

      const result = await client.chatCompletion('qwen3.7-plus', { prompt: '你好', temperature: 0.7 })

      const messages = capturedBody?.messages as Array<Record<string, unknown>>
      expect(capturedBody?.model).toBe('qwen3.7-plus')
      expect(messages[0]?.role).toBe('user')
      expect(messages[0]?.content).toBe('你好')
      expect(capturedBody?.temperature).toBe(0.7)
      expect(capturedBody?.input).toBeUndefined()
      expect(capturedBody?.parameters).toBeUndefined()

      expect(result.success).toBe(true)
      expect(result.output!.text).toBe('分析结果')
      expect(result.usage!.inputTokens).toBe(10)
      expect(result.usage!.outputTokens).toBe(20)
    })

    it('设置正确的 Authorization header', async () => {
      let capturedHeaders: Record<string, unknown> | null = null

      globalThis.fetch = mockFetch((_url, init) => {
        capturedHeaders = asRecord(init?.headers)
        return Promise.resolve(new Response(JSON.stringify({
          output: { choices: [{ message: { content: [{ text: 'ok' }] } }] },
          usage: {},
        }), { status: 200 }))
      })

      await client.chatCompletion('qwen-max', { prompt: 'test' })

      expect(capturedHeaders.Authorization).toBe('Bearer test-api-key')
      expect(capturedHeaders['Content-Type']).toBe('application/json')
    })
  })

  // ── generateImage ──

  describe('generateImage', () => {
    it('成功返回图片 URL 列表', async () => {
      withMock(200, {
        output: {
          choices: [{
            message: {
              content: [
                { image: 'https://cdn.example.com/img1.png' },
                { image: 'https://cdn.example.com/img2.png' },
              ],
            },
          }],
        },
        usage: { image_count: 2 },
      })

      const result = await client.generateImage('qwen-image-2.0-pro', { prompt: '画一只猫' })
      restoreFetch()

      expect(result.success).toBe(true)
      expect(result.output!.urls).toHaveLength(2)
      expect(result.usage!.imageCount).toBe(2)
    })

    it('未知图片模型返回错误', async () => {
      const result = await client.generateImage('nonexistent', {})
      expect(result.success).toBe(false)
    })
  })

  // ── submitVideoTask ──

  describe('submitVideoTask', () => {
    it('成功提交异步任务并返回 taskId', async () => {
      withMock(200, {
        output: { task_id: 'task-abc-123' },
        request_id: 'req-xyz',
      })

      const result = await client.submitVideoTask('happyhorse-1.0-t2v', {
        prompt: '生成一个视频',
        duration: 5,
      })
      restoreFetch()

      expect(result.success).toBe(true)
      expect(result.type).toBe('video_task')
      expect(result.taskId).toBe('task-abc-123')
      expect(result.usage!.videoDuration).toBe(5)
    })

    it('无 task_id 时回退到 request_id', async () => {
      withMock(200, {
        request_id: 'req-fallback-456',
      })

      const result = await client.submitVideoTask('happyhorse-1.0-t2v', { prompt: 'test' })
      restoreFetch()

      expect(result.success).toBe(true)
      expect(result.type).toBe('video_task')
      expect(result.taskId).toBe('req-fallback-456')
    })

    it('包含 X-DashScope-Async header', async () => {
      let capturedHeaders: Record<string, unknown> | null = null

      globalThis.fetch = mockFetch((_url, init) => {
        capturedHeaders = asRecord(init?.headers)
        return Promise.resolve(new Response(JSON.stringify({
          output: { task_id: 't1' },
        }), { status: 200 }))
      })

      await client.submitVideoTask('happyhorse-1.0-t2v', { prompt: 'test' })

      expect(capturedHeaders['X-DashScope-Async']).toBe('enable')
    })

    it('网络错误返回友好消息', async () => {
      withMockError(new TypeError('fetch failed'))

      const result = await client.submitVideoTask('happyhorse-1.0-t2v', { prompt: 'test' })
      restoreFetch()

      expect(result.success).toBe(false)
      expect(result.error).toContain('网络错误')
    })
  })

  // ── queryTask ──

  describe('queryTask', () => {
    it('查询运行中的任务', async () => {
      withMock(200, {
        output: { task_status: 'RUNNING' },
      })

      const result = await client.queryTask('task-123')
      restoreFetch()

      expect(result.taskId).toBe('task-123')
      expect(result.status).toBe('RUNNING')
    })

    it('查询成功的任务（带 video_url）', async () => {
      withMock(200, {
        output: {
          task_status: 'SUCCEEDED',
          video_url: 'https://cdn.example.com/video.mp4',
        },
        usage: { video_duration: 5 },
      })

      const result = await client.queryTask('task-456')
      restoreFetch()

      expect(result.status).toBe('SUCCEEDED')
      expect(result.output).toBeDefined()
      expect(result.usage).toBeDefined()
    })

    it('查询成功的任务（带 results 数组）', async () => {
      withMock(200, {
        output: {
          task_status: 'SUCCEEDED',
          results: [{ url: 'https://cdn.example.com/img.png' }],
        },
      })

      const result = await client.queryTask('task-789')
      restoreFetch()

      expect(result.status).toBe('SUCCEEDED')
      expect(result.output).toBeDefined()
    })

    it('查询失败的任务返回中文错误消息', async () => {
      withMock(200, {
        output: {
          task_status: 'FAILED',
          code: 'DataInspectionFailed',
          message: 'Content inspection failed',
        },
      })

      const result = await client.queryTask('task-failed')
      restoreFetch()

      expect(result.status).toBe('FAILED')
      expect(result.errorCode).toBe('DataInspectionFailed')
      expect(result.errorMessage).toContain('不合规')
    })

    it('网络错误返回 UNKNOWN 状态', async () => {
      withMockError(new Error('timeout'))

      const result = await client.queryTask('task-neterr')
      restoreFetch()

      expect(result.status).toBe('UNKNOWN')
      expect(result.errorMessage).toContain('网络错误')
    })
  })

  // ── generate 路由 ──

  describe('generate', () => {
    it('文本模型路由到 chatCompletion', async () => {
      withMock(200, {
        output: { choices: [{ message: { content: [{ text: '回复' }] } }] },
        usage: {},
      })

      const result = await client.generate('qwen-max', { prompt: '你好' })
      restoreFetch()

      expect(result.success).toBe(true)
      expect(result.output!.text).toBe('回复')
    })

    it('图片模型路由到 generateImage', async () => {
      withMock(200, {
        output: { choices: [{ message: { content: [{ image: 'https://img.url' }] } }] },
        usage: { image_count: 1 },
      })

      const result = await client.generate('qwen-image-2.0-pro', { prompt: '画猫' })
      restoreFetch()

      expect(result.success).toBe(true)
      expect(result.output!.urls).toHaveLength(1)
    })

    it('视频模型路由到 submitVideoTask', async () => {
      withMock(200, {
        output: { task_id: 'task-vid-001' },
      })

      const result = await client.generate('happyhorse-1.0-t2v', { prompt: '视频', duration: 5 })
      restoreFetch()

      expect(result.success).toBe(true)
      expect(result.type).toBe('video_task')
      expect(result.taskId).toBe('task-vid-001')
    })

    it('未知模型返回错误', async () => {
      const result = await client.generate('nonexistent', {})
      expect(result.success).toBe(false)
      expect(result.error).toContain('未知模型')
    })
  })

  // ── provider call observer（metrics 埋点） ──

  describe('provider 调用观察者', () => {
    let calls: Array<{ model: string, durationMs: number, success: boolean }>
    let unregister: () => void

    beforeEach(() => {
      __resetProviderCallObservers()
      calls = []
      unregister = registerProviderCallObserver((model, durationMs, success) => {
        calls.push({ model, durationMs, success })
      })
    })

    afterEach(() => {
      unregister()
      __resetProviderCallObservers()
    })

    it('chatCompletion 成功 → observer 收到 success=true', async () => {
      withMock(200, {
        output: { choices: [{ message: { content: [{ text: 'ok' }] } }] },
        usage: {},
      })

      await client.chatCompletion('qwen-max', { prompt: 'hi' })

      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({ model: 'qwen-max', success: true })
      expect(calls[0]!.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('chatCompletion HTTP 错误 → observer 收到 success=false', async () => {
      withMock(500, { message: '服务器错误' })

      await client.chatCompletion('qwen-max', { prompt: 'hi' })

      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({ model: 'qwen-max', success: false })
    })

    it('chatCompletion 网络异常 → observer 收到 success=false', async () => {
      withMockError(new Error('network down'))

      await client.chatCompletion('qwen-max', { prompt: 'hi' })

      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({ model: 'qwen-max', success: false })
    })

    it('generateImage 成功 → observer 触发', async () => {
      withMock(200, {
        output: { choices: [{ message: { content: [{ image: 'https://example.com/x.png' }] } }] },
        usage: {},
      })

      await client.generateImage('qwen-image-2.0-pro', { prompt: 'cat' })

      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({ model: 'qwen-image-2.0-pro', success: true })
    })

    it('submitVideoTask 成功 → observer 触发', async () => {
      withMock(200, { output: { task_id: 'task-001' } })

      await client.submitVideoTask('happyhorse-1.0-t2v', { prompt: 'video', duration: 5 })

      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({ model: 'happyhorse-1.0-t2v', success: true })
    })

    it('submitVideoTask 未返回 task_id → observer 收到 success=false', async () => {
      withMock(200, { output: {} })

      await client.submitVideoTask('happyhorse-1.0-t2v', { prompt: 'video', duration: 5 })

      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({ model: 'happyhorse-1.0-t2v', success: false })
    })

    it('未注册 observer → 调用仍正常完成（不抛错）', async () => {
      __resetProviderCallObservers()
      withMock(200, {
        output: { choices: [{ message: { content: [{ text: 'ok' }] } }] },
      })

      const result = await client.chatCompletion('qwen-max', { prompt: 'hi' })

      expect(result.success).toBe(true)
      expect(calls).toHaveLength(0)
    })

    it('observer 抛错不影响主流程', async () => {
      __resetProviderCallObservers()
      registerProviderCallObserver(() => {
        throw new Error('observer boom')
      })
      withMock(200, {
        output: { choices: [{ message: { content: [{ text: 'ok' }] } }] },
      })

      const result = await client.chatCompletion('qwen-max', { prompt: 'hi' })

      expect(result.success).toBe(true)
    })
  })
})
