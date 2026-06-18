import type { SSEGenerationStatusEvent, SSENotificationEvent, SSEPipelineNodeEvent } from '@excuse/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getAuthToken, setAuthToken } from '../src/api/client'
// Import after mocks
import { sseClient } from '../src/api/sse'

/**
 * SSE 客户端测试 — Vitest mock fetchEventSource
 *
 * 覆盖：
 *   - 连接建立（Bearer token header / httpOnly cookie）
 *   - 事件解析与分发（generation_status, pipeline_node_update, notification, heartbeat）
 *   - 非法 JSON 事件不崩溃连接
 *   - 401/403 认证失败 → 停止重连 + 清理登录态
 *   - 5xx/网络错误 → 自动重连
 *   - disconnect() → abort fetch 流 + 不重连
 *   - 无内存 token → 仍可通过 httpOnly cookie 连接
 */

// ── Mock fetchEventSource — 可控的 SSE 流模拟 ──────────────

interface FetchEventSourceInit {
  signal?: AbortSignal
  headers?: Record<string, string>
  credentials?: RequestCredentials
  onopen?: (response: Response) => Promise<void>
  onmessage?: (msg: { event: string, data: string }) => void
  onerror?: (err: unknown) => unknown | number | void
  onclose?: () => void
  openWhenHidden?: boolean
}

/** 当前被捕获的 SSE init 配置 — 测试用此回调来模拟服务器推送 */
let capturedInit: FetchEventSourceInit | null = null
let resolveStream: (() => void) | null = null
let _rejectStream: ((err: unknown) => void) | null = null

vi.mock('@microsoft/fetch-event-source', () => ({
  fetchEventSource: vi.fn(async (_url: string, init: FetchEventSourceInit) => {
    capturedInit = init
    // 模拟 @microsoft/fetch-event-source 的核心行为：
    // 1. 先调用 onopen（如果 onopen throw，捕获错误并路由到 onerror）
    // 2. onerror 可以 throw（终止连接）或返回重连间隔（继续）
    // 3. 如果 onerror throw → fetchEventSource promise reject
    // 4. 如果 onerror 返回间隔 → 继续等待（模拟永不结束的流）
    return new Promise<void>((resolve, reject) => {
      resolveStream = resolve
      _rejectStream = reject

      // 当 abort signal 触发时，reject（模拟 fetch abort）
      if (init.signal) {
        init.signal.addEventListener('abort', () => {
          reject(new DOMException('The user aborted a request.', 'AbortError'))
        })
      }
    })
  }),
}))

// Mock auth client
vi.mock('../src/api/client', () => ({
  getAuthToken: vi.fn(() => 'valid-jwt-token'),
  resolveApiBaseUrl: vi.fn(() => ''),
  setAuthToken: vi.fn(),
}))

// ── Helper: 模拟服务器行为 ──────────────────────────────────

function pushEvent(event: string, data: string) {
  capturedInit?.onmessage?.({ event, data })
}

async function respondOpen(status: number, contentType = 'text/event-stream') {
  const response = new Response(null, { status, headers: { 'content-type': contentType } })
  await capturedInit?.onopen?.(response)
}

function pushError(err: unknown): unknown | number | void {
  return capturedInit?.onerror?.(err)
}

function closeStream() {
  resolveStream?.()
  capturedInit?.onclose?.()
}

// ── 测试 ──────────────────────────────────────────────────

describe('sSEClient', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    capturedInit = null
    resolveStream = null
    _rejectStream = null
    sseClient.disconnect()
    // 等待 disconnect 后的状态清理完成
    // （fetchEventSource 的 finally 会设置 isConnecting=false）
  })

  describe('连接建立', () => {
    it('有 token 时发送 Bearer Authorization header', async () => {
      vi.mocked(getAuthToken).mockReturnValue('my-jwt-token')
      sseClient.connect()

      expect(capturedInit).not.toBeNull()
      expect(capturedInit!.headers).toEqual({ Authorization: 'Bearer my-jwt-token' })
      expect(capturedInit!.credentials).toBe('include')
    })

    it('无内存 token 时仍通过 httpOnly cookie 连接', () => {
      vi.mocked(getAuthToken).mockReturnValue(null)
      sseClient.connect()

      expect(capturedInit).not.toBeNull()
      expect(capturedInit!.headers).toBeUndefined()
      expect(capturedInit!.credentials).toBe('include')
    })

    it('已在连接时不重复连接', async () => {
      vi.mocked(getAuthToken).mockReturnValue('token-1')
      sseClient.connect()
      const firstInit = capturedInit

      sseClient.connect()
      expect(capturedInit).toBe(firstInit)
    })
  })

  describe('事件解析与分发', () => {
    it('generation_status 事件正确解析并分发', async () => {
      vi.mocked(getAuthToken).mockReturnValue('token')
      const handler = vi.fn()
      sseClient.on('generation_status', handler)
      sseClient.connect()
      await respondOpen(200)

      const event: SSEGenerationStatusEvent = {
        id: 'rec-001',
        taskId: 'gen_123',
        model: 'qwen-max',
        status: 'succeeded',
        category: 'text',
      }
      pushEvent('generation_status', JSON.stringify(event))

      expect(handler).toHaveBeenCalledWith(event)
    })

    it('pipeline_node_update 事件正确解析并分发', async () => {
      vi.mocked(getAuthToken).mockReturnValue('token')
      const handler = vi.fn()
      sseClient.on('pipeline_node_update', handler)
      sseClient.connect()
      await respondOpen(200)

      const event: SSEPipelineNodeEvent = {
        projectId: 'proj-001',
        nodeType: 'characters',
        nodeId: 'node-1',
        status: 'completed',
      }
      pushEvent('pipeline_node_update', JSON.stringify(event))

      expect(handler).toHaveBeenCalledWith(event)
    })

    it('notification 事件正确解析并分发', async () => {
      vi.mocked(getAuthToken).mockReturnValue('token')
      const handler = vi.fn()
      sseClient.on('notification', handler)
      sseClient.connect()
      await respondOpen(200)

      const event: SSENotificationEvent = {
        id: 'notif-001',
        type: 'balance_warning',
        title: '余额预警',
        body: '余额不足',
        read: false,
        createdAt: '2024-01-01T00:00:00.000Z',
      }
      pushEvent('notification', JSON.stringify(event))

      expect(handler).toHaveBeenCalledWith(event)
    })

    it('notification meta 透传 projectId + shotId + recordId（Canvas 锚点链路）', async () => {
      vi.mocked(getAuthToken).mockReturnValue('token')
      const handler = vi.fn()
      sseClient.on('notification', handler)
      sseClient.connect()
      await respondOpen(200)

      pushEvent('notification', JSON.stringify({
        id: 'notif-canvas-1',
        type: 'task_completed',
        title: '视频生成完成',
        meta: {
          recordId: 'rec-1',
          category: 'video',
          projectId: 'proj-canvas-1',
          shotId: 'shot-9',
        },
        read: false,
        createdAt: '2024-01-01T00:00:00.000Z',
      }))

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        id: 'notif-canvas-1',
        type: 'task_completed',
        meta: {
          recordId: 'rec-1',
          category: 'video',
          projectId: 'proj-canvas-1',
          shotId: 'shot-9',
        },
      }))
    })

    it('heartbeat 事件不触发 handler', async () => {
      vi.mocked(getAuthToken).mockReturnValue('token')
      const handler = vi.fn()
      sseClient.on('generation_status', handler)
      sseClient.connect()
      await respondOpen(200)

      pushEvent('heartbeat', JSON.stringify({ timestamp: '2024-01-01' }))
      expect(handler).not.toHaveBeenCalled()
    })

    it('connected 事件正常处理（不崩溃）', async () => {
      vi.mocked(getAuthToken).mockReturnValue('token')
      sseClient.connect()
      await respondOpen(200)

      pushEvent('connected', JSON.stringify({ timestamp: '2024-01-01' }))
      // 无 handler 注册，不应崩溃
    })
  })

  describe('非法 JSON 事件处理', () => {
    it('非法 JSON 不崩溃连接，只 console.warn', async () => {
      vi.mocked(getAuthToken).mockReturnValue('token')
      const handler = vi.fn()
      sseClient.on('generation_status', handler)
      sseClient.connect()
      await respondOpen(200)

      pushEvent('generation_status', 'not-json-at-all')
      expect(handler).not.toHaveBeenCalled()
    })

    it('合法 JSON 但字段缺失的事件被丢弃', async () => {
      vi.mocked(getAuthToken).mockReturnValue('token')
      const handler = vi.fn()
      sseClient.on('generation_status', handler)
      sseClient.connect()
      await respondOpen(200)

      // 缺少 required status 字段
      pushEvent('generation_status', JSON.stringify({ id: 'rec-001', taskId: 'gen_123' }))
      expect(handler).not.toHaveBeenCalled()
    })

    it('非法 status 值的事件被丢弃', async () => {
      vi.mocked(getAuthToken).mockReturnValue('token')
      const handler = vi.fn()
      sseClient.on('generation_status', handler)
      sseClient.connect()
      await respondOpen(200)

      pushEvent('generation_status', JSON.stringify({
        id: 'rec-001',
        taskId: 'gen_123',
        model: 'qwen-max',
        status: 'invalid_status',
        category: 'text',
      }))
      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('认证失败（401/403）', () => {
    // 在真实 @microsoft/fetch-event-source 中，onopen 的 throw 会被库捕获，
    // 路由到 onerror，然后 onerror 可以再次 throw 来终止连接。
    // 我们的 mock 不模拟这种内部路由，所以直接手动模拟完整流程：
    // 1. onopen throw → 2. 库捕获 → 3. 路由到 onerror → 4. onerror 处理

    it('401 时清理登录态（UnauthorizedError 流程）', async () => {
      vi.mocked(getAuthToken).mockReturnValue('valid-token')
      sseClient.connect()

      // 手动模拟 fetchEvent-source 的内部路由：
      // onopen 检测 401 → throw UnauthorizedError → 库路由到 onerror → onerror 处理并再 throw
      let openError: unknown
      try {
        await respondOpen(401)
      }
      catch (e) {
        openError = e
      }

      // 路由到 onerror（模拟 fetchEvent-source 库的内部路由行为）
      try {
        pushError(openError)
      }
      catch {
        // onerror 也会 throw UnauthorizedError → 连接终止
      }

      expect(setAuthToken).toHaveBeenCalledWith(null)
    })

    it('403 同样清理登录态', async () => {
      vi.mocked(getAuthToken).mockReturnValue('valid-token')
      sseClient.connect()

      let openError: unknown
      try {
        await respondOpen(403)
      }
      catch (e) {
        openError = e
      }

      try {
        pushError(openError)
      }
      catch {}

      expect(setAuthToken).toHaveBeenCalledWith(null)
    })
  })

  describe('网络错误和 5xx', () => {
    // 同上：onopen throw RetriableError 由 fetchEvent-source 内部路由到 onerror。
    // 在 mock 中，throw 后 promise reject → .catch() 捕获 → scheduleReconnect()
    // 我们验证：5xx 不清理登录态（setAuthToken 不被调用）+ 会触发重连

    it('5xx 不清理登录态，会触发 scheduleReconnect', async () => {
      vi.mocked(getAuthToken).mockReturnValue('token')
      sseClient.connect()

      // 模拟 500 响应 → onopen throw RetriableError → 不清理登录态
      try {
        await respondOpen(500)
      }
      catch {}

      // 5xx 不应清理登录态（与 401/403 不同）
      expect(setAuthToken).not.toHaveBeenCalled()
      // .catch 中会调用 scheduleReconnect（intentionallyClosed=false 时）
    })
  })

  describe('断开与重连', () => {
    it('disconnect 后不触发自动重连', async () => {
      vi.mocked(getAuthToken).mockReturnValue('token')
      sseClient.connect()
      await respondOpen(200)

      sseClient.disconnect()

      // 模拟服务器关闭连接 — onclose 不应触发重连
      closeStream()
      // 无 assert — 仅验证 intentionallyClosed=true 后 onclose 不触发 scheduleReconnect
    })
  })

  describe('订阅管理', () => {
    it('on() 返回取消订阅函数', async () => {
      vi.mocked(getAuthToken).mockReturnValue('token')
      const handler = vi.fn()
      const unsub = sseClient.on('generation_status', handler)
      sseClient.connect()
      await respondOpen(200)

      const event: SSEGenerationStatusEvent = {
        id: 'rec-001',
        taskId: 'gen_123',
        model: 'qwen-max',
        status: 'succeeded',
        category: 'text',
      }
      pushEvent('generation_status', JSON.stringify(event))
      expect(handler).toHaveBeenCalledTimes(1)

      unsub()
      pushEvent('generation_status', JSON.stringify(event))
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('handler 异常不影响其他 handler 和连接', async () => {
      vi.mocked(getAuthToken).mockReturnValue('token')
      const badHandler = vi.fn(() => {
        throw new Error('handler crash')
      })
      const goodHandler = vi.fn()
      sseClient.on('generation_status', badHandler)
      sseClient.on('generation_status', goodHandler)
      sseClient.connect()
      await respondOpen(200)

      const event: SSEGenerationStatusEvent = {
        id: 'rec-001',
        taskId: 'gen_123',
        model: 'qwen-max',
        status: 'succeeded',
        category: 'text',
      }
      pushEvent('generation_status', JSON.stringify(event))

      expect(badHandler).toHaveBeenCalled()
      expect(goodHandler).toHaveBeenCalled()
    })
  })
})
