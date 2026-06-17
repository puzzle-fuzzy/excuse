import { describe, expect, it } from 'bun:test'
import {
  createGenerationNotifyDispatcher,
  createNotificationDispatcher,
  GENERATION_STATUS_CHANNEL,
  mapGenerationNotifyToSSEEvents,
  mapNotificationNotifyToSSEEvent,
  NOTIFICATION_CHANNEL,
  parseGenerationNotifyPayload,
  parseNotificationNotifyPayload,
  SSE_GENERATION_STATUS_EVENT,
  SSE_NOTIFICATION_EVENT,
  SSE_PIPELINE_NODE_EVENT,
  startNotifyListeners,
  UserEventHub,
} from '../src'

describe('@excuse/events', () => {
  it('解析 generation notify JSON 负载', () => {
    const payload = parseGenerationNotifyPayload(JSON.stringify({
      accountId: 'acc-1',
      recordId: 'rec-1',
      taskId: 'task-1',
      status: 'succeeded',
      category: 'video',
      model: 'wan',
    }))

    expect(payload.accountId).toBe('acc-1')
    expect(GENERATION_STATUS_CHANNEL).toBe('generation_status')
  })

  it('将 generation notify 负载映射为用户 SSE 事件', () => {
    const events = mapGenerationNotifyToSSEEvents({
      accountId: 'acc-1',
      recordId: 'rec-1',
      taskId: 'task-1',
      traceId: 'trace-1',
      status: 'succeeded',
      category: 'video',
      model: 'wan',
    })

    expect(events).toEqual([
      {
        userId: 'acc-1',
        event: SSE_GENERATION_STATUS_EVENT,
        data: {
          id: 'rec-1',
          taskId: 'task-1',
          traceId: 'trace-1',
          status: 'succeeded',
          category: 'video',
          model: 'wan',
        },
      },
    ])
  })

  it('canvas 元数据存在时添加 canvas pipeline 事件', () => {
    const events = mapGenerationNotifyToSSEEvents({
      accountId: 'acc-1',
      recordId: 'rec-1',
      taskId: 'task-1',
      status: 'failed',
      category: 'video',
      model: 'wan',
      canvasMeta: {
        projectId: 'project-1',
        shotId: 'shot-1',
        projectStatus: 'failed',
      },
    })

    expect(events.map(event => event.event)).toEqual([
      SSE_GENERATION_STATUS_EVENT,
      SSE_PIPELINE_NODE_EVENT,
      SSE_PIPELINE_NODE_EVENT,
    ])
    expect(events[1]!.data).toMatchObject({
      projectId: 'project-1',
      nodeType: 'shot',
      nodeId: 'shot-1',
      status: 'failed',
    })
  })

  it('canvas 视频 shot 完成时在 pipeline 事件中携带 videoUrl（供前端 delta-patch 即时回填）', () => {
    const events = mapGenerationNotifyToSSEEvents({
      accountId: 'acc-1',
      recordId: 'rec-1',
      taskId: 'task-1',
      status: 'succeeded',
      category: 'video',
      model: 'wan',
      canvasMeta: { projectId: 'project-1', shotId: 'shot-1' },
      outputResult: { type: 'video', savedUrls: ['https://cdn/video.mp4'] },
    })

    expect(events[1]!.data).toMatchObject({
      nodeType: 'shot',
      nodeId: 'shot-1',
      status: 'completed',
      data: { videoUrl: 'https://cdn/video.mp4' },
    })
  })

  it('canvas shot 无视频 URL 时不附带 data 字段', () => {
    const events = mapGenerationNotifyToSSEEvents({
      accountId: 'acc-1',
      recordId: 'rec-1',
      taskId: 'task-1',
      status: 'succeeded',
      category: 'video',
      model: 'wan',
      canvasMeta: { projectId: 'project-1', shotId: 'shot-1' },
    })

    expect(events[1]!.data).toMatchObject({
      nodeType: 'shot',
      nodeId: 'shot-1',
      status: 'completed',
    })
    expect('data' in events[1]!.data).toBe(false)
  })

  it('跟踪用户事件 hub 连接并向所有标签页分发', () => {
    const hub = new UserEventHub()
    const received: Array<{ event: string, data: unknown }> = []
    const first = (event: string, data: unknown) => received.push({ event, data })
    const second = (event: string, data: unknown) => received.push({ event, data })

    expect(hub.addConnection('user-1', first)).toBe(1)
    expect(hub.addConnection('user-1', second)).toBe(2)
    expect(hub.getOnlineUserCount()).toBe(1)
    expect(hub.getConnectionCount('user-1')).toBe(2)

    expect(hub.dispatchToUser('user-1', 'hello', { ok: true })).toBe(2)
    expect(received).toEqual([
      { event: 'hello', data: { ok: true } },
      { event: 'hello', data: { ok: true } },
    ])

    expect(hub.removeConnection('user-1', first)).toBe(1)
    expect(hub.removeConnection('user-1', second)).toBe(0)
    expect(hub.getOnlineUserCount()).toBe(0)
  })

  it('某个 sender 抛出异常时继续分发', () => {
    const hub = new UserEventHub()
    const errors: unknown[] = []
    const received: string[] = []
    hub.addConnection('user-1', () => {
      throw new Error('broken connection')
    })
    hub.addConnection('user-1', event => received.push(event))

    expect(hub.dispatchToUser('user-1', 'hello', {}, error => errors.push(error))).toBe(1)
    expect(errors).toHaveLength(1)
    expect(received).toEqual(['hello'])
  })

  it('通过提供的 transport 分发 generation NOTIFY 负载', () => {
    const dispatched: Array<{ userId: string, event: string, data: unknown }> = []
    const handleNotify = createGenerationNotifyDispatcher({
      dispatchToUser: (userId, event, data) => dispatched.push({ userId, event, data }),
    })

    const result = handleNotify(JSON.stringify({
      accountId: 'acc-1',
      recordId: 'rec-1',
      taskId: 'task-1',
      traceId: 'trace-1',
      status: 'succeeded',
      category: 'text',
      model: 'qwen-max',
    }))

    expect(result?.payload.accountId).toBe('acc-1')
    expect(result?.events).toHaveLength(1)
    expect(dispatched).toEqual([
      {
        userId: 'acc-1',
        event: SSE_GENERATION_STATUS_EVENT,
        data: {
          id: 'rec-1',
          taskId: 'task-1',
          traceId: 'trace-1',
          status: 'succeeded',
          category: 'text',
          model: 'qwen-max',
        },
      },
    ])
  })

  it('报告无效 NOTIFY 负载但不分发', () => {
    const errors: Array<{ error: unknown, rawPayload: string }> = []
    const handleNotify = createGenerationNotifyDispatcher({
      dispatchToUser: () => {
        throw new Error('should not dispatch')
      },
      onError: (error, rawPayload) => errors.push({ error, rawPayload }),
    })

    expect(handleNotify('{bad json')).toBeNull()
    expect(errors).toHaveLength(1)
    expect(errors[0]!.rawPayload).toBe('{bad json')
  })

  // ===== Notification channel（P2-2） =====

  it('暴露通知频道名称', () => {
    expect(NOTIFICATION_CHANNEL).toBe('notification')
    expect(SSE_NOTIFICATION_EVENT).toBe('notification')
  })

  it('解析 notification notify JSON 负载', () => {
    const payload = parseNotificationNotifyPayload(JSON.stringify({
      id: 'n-1',
      accountId: 'acc-1',
      type: 'task_completed',
      title: '视频生成完成',
      body: 'wan · 点击查看',
      meta: { recordId: 'rec-1', category: 'video' },
      read: false,
      createdAt: '2026-06-14T00:00:00.000Z',
    }))

    expect(payload.id).toBe('n-1')
    expect(payload.accountId).toBe('acc-1')
    expect(payload.meta?.recordId).toBe('rec-1')
  })

  it('将 notification 负载映射为 SSE 事件，丢弃 accountId 并保留 meta', () => {
    const event = mapNotificationNotifyToSSEEvent({
      id: 'n-1',
      accountId: 'acc-1',
      type: 'canvas_completed',
      title: '画布项目已全部完成',
      meta: { projectId: 'proj-1', category: 'video' },
      read: false,
      createdAt: '2026-06-14T00:00:00.000Z',
    })

    expect(event).toEqual({
      id: 'n-1',
      type: 'canvas_completed',
      title: '画布项目已全部完成',
      meta: { projectId: 'proj-1', category: 'video' },
      read: false,
      createdAt: '2026-06-14T00:00:00.000Z',
    })
    // accountId 仅用于路由，不下发到前端
    expect('accountId' in event).toBe(false)
  })

  it('通过提供的 transport 分发 notification NOTIFY 负载', () => {
    const dispatched: Array<{ userId: string, event: string, data: unknown }> = []
    const handleNotification = createNotificationDispatcher({
      dispatchToUser: (userId, event, data) => dispatched.push({ userId, event, data }),
    })

    const result = handleNotification(JSON.stringify({
      id: 'n-1',
      accountId: 'acc-1',
      type: 'balance_warning',
      title: '余额不足',
      body: '请前往计费页充值',
      read: false,
      createdAt: '2026-06-14T00:00:00.000Z',
    }))

    expect(result?.payload.accountId).toBe('acc-1')
    expect(dispatched).toEqual([
      {
        userId: 'acc-1',
        event: SSE_NOTIFICATION_EVENT,
        data: {
          id: 'n-1',
          type: 'balance_warning',
          title: '余额不足',
          body: '请前往计费页充值',
          read: false,
          createdAt: '2026-06-14T00:00:00.000Z',
        },
      },
    ])
  })

  it('报告无效 notification 负载但不分发', () => {
    const errors: Array<{ error: unknown, rawPayload: string }> = []
    const handleNotification = createNotificationDispatcher({
      dispatchToUser: () => {
        throw new Error('should not dispatch')
      },
      onError: (error, rawPayload) => errors.push({ error, rawPayload }),
    })

    expect(handleNotification('{bad json')).toBeNull()
    expect(errors).toHaveLength(1)
    expect(errors[0]!.rawPayload).toBe('{bad json')
  })

  // ===== PostgreSQL LISTEN 频道注册 wiring =====

  function createFakeTransport() {
    const handlers = new Map<string, (payload: string) => void>()
    const transport = {
      listen(channel: string, handler: (payload: string) => void) {
        handlers.set(channel, handler)
      },
    }
    return { transport, handlers }
  }

  it('通过 transport 订阅 generation_status 频道', async () => {
    const { transport, handlers } = createFakeTransport()

    await startNotifyListeners({
      transport,
      onGenerationStatus: () => {},
      onNotification: () => {},
    })

    expect(handlers.has(GENERATION_STATUS_CHANNEL)).toBe(true)
    expect(handlers.has(NOTIFICATION_CHANNEL)).toBe(true)
  })

  it('将原始负载原样转发到匹配的 handler', async () => {
    const { transport, handlers } = createFakeTransport()
    const genPayloads: string[] = []
    const notifPayloads: string[] = []

    await startNotifyListeners({
      transport,
      onGenerationStatus: raw => genPayloads.push(raw),
      onNotification: raw => notifPayloads.push(raw),
    })

    handlers.get(GENERATION_STATUS_CHANNEL)!('{"recordId":"rec-1"}')
    handlers.get(NOTIFICATION_CHANNEL)!('{"id":"n-1"}')

    expect(genPayloads).toEqual(['{"recordId":"rec-1"}'])
    expect(notifPayloads).toEqual(['{"id":"n-1"}'])
  })

  it('transport.listen 返回 Promise 时等待其完成', async () => {
    let resolveListen: (() => void) | undefined
    const listenPromise = new Promise<void>((resolve) => {
      resolveListen = resolve
    })
    const transport = {
      listen(_channel: string, _handler: (payload: string) => void) {
        return listenPromise
      },
    }

    let finished = false
    const done = startNotifyListeners({
      transport,
      onGenerationStatus: () => {},
      onNotification: () => {},
    }).then(() => {
      finished = true
    })

    // Promise 尚未 resolve 时 startNotifyListeners 不应完成
    await Promise.resolve()
    await Promise.resolve()
    expect(finished).toBe(false)

    resolveListen!()
    await done
    expect(finished).toBe(true)
  })
})
