import { afterEach, describe, expect, it, mock } from 'bun:test'

// Mock @excuse/db before importing sse-manager (it imports pgClient from @excuse/db)
mock.module('@excuse/db', () => ({
  pgClient: { listen: async () => {} },
  notifyGenerationStatus: async () => {},
  markGenerationFailed: async () => {},
  markGenerationProcessing: async () => {},
  markGenerationSucceeded: async () => {},
}))

const { addConnection, dispatchToUser, getOnlineUserCount, removeConnection } = await import('../src/services/sse-manager')

// 追踪所有测试中添加的连接，确保 afterEach 清理干净
type Sender = (event: string, data: unknown) => void
const addedConnections: Array<{ userId: string, sender: Sender }> = []

function trackedAdd(userId: string, sender: Sender) {
  addConnection(userId, sender)
  addedConnections.push({ userId, sender })
}

afterEach(() => {
  for (const { userId, sender } of addedConnections) {
    removeConnection(userId, sender)
  }
  addedConnections.length = 0
})

describe('SSE Manager — connection lifecycle', () => {
  it('为用户添加连接', () => {
    const sender: Sender = () => {}
    trackedAdd('user-1', sender)
    expect(getOnlineUserCount()).toBe(1)
  })

  it('同一用户支持多个连接', () => {
    const sender1: Sender = () => {}
    const sender2: Sender = () => {}
    trackedAdd('user-1', sender1)
    trackedAdd('user-1', sender2)
    expect(getOnlineUserCount()).toBe(1) // same user
  })

  it('最后一个连接移除时移除用户条目', () => {
    const sender1: Sender = () => {}
    const sender2: Sender = () => {}
    trackedAdd('user-1', sender1)
    trackedAdd('user-1', sender2)
    removeConnection('user-1', sender1)
    expect(getOnlineUserCount()).toBe(1)
    removeConnection('user-1', sender2)
    expect(getOnlineUserCount()).toBe(0)
    // 防止 afterEach 再次移除已删除的连接
    addedConnections.length = 0
  })

  it('不存在的用户调用 removeConnection 无副作用', () => {
    expect(() => removeConnection('nobody', (() => {}) as Sender)).not.toThrow()
  })
})

describe('SSE Manager — dispatchToUser', () => {
  it('向用户的所有连接广播', () => {
    const received: Array<{ event: string, data: unknown }> = []
    const sender1: Sender = (event, data) => {
      received.push({ event, data })
    }
    const sender2: Sender = (event, data) => {
      received.push({ event, data })
    }

    trackedAdd('user-dispatch', sender1)
    trackedAdd('user-dispatch', sender2)

    dispatchToUser('user-dispatch', 'test_event', { msg: 'hello' })

    expect(received).toEqual([
      { event: 'test_event', data: { msg: 'hello' } },
      { event: 'test_event', data: { msg: 'hello' } },
    ])
  })

  it('用户无连接时无副作用', () => {
    expect(() => dispatchToUser('nobody', 'test', {})).not.toThrow()
  })

  it('一个 sender 失败不阻塞其他 sender', () => {
    let received = false
    const badSender = () => {
      throw new Error('boom')
    }
    const goodSender = () => {
      received = true
    }

    trackedAdd('user-error', badSender)
    trackedAdd('user-error', goodSender)

    // Should not throw, and good sender should still be called
    expect(() => dispatchToUser('user-error', 'test', {})).not.toThrow()
    expect(received).toBe(true)
  })
})
