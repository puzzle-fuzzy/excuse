import { describe, expect, it } from 'bun:test'
import { getActivePipelineRun } from '../src/api/client'

/**
 * getActivePipelineRun 是 client.ts 导出的纯函数，用于从 pipeline run 列表中
 * 找出当前活跃（pending/running）的 run。
 *
 * 注：client.ts 中更核心的 unwrapEden、isApiErrorValue、normalizeApiBaseUrl
 * 等函数是模块私有的，不在本文件范围测试。它们的错误处理行为通过集成测试覆盖。
 * auth token 管理（setAuthToken/getAuthToken）依赖 SSE 模块（浏览器环境），
 * 无法在 Bun 非浏览器环境下单元测试。
 */

// ── getActivePipelineRun ───────────────────────────────

describe('getActivePipelineRun', () => {
  it('返回第一个 pending 或 running 的 run', () => {
    const runs = [
      { id: '1', status: 'succeeded' as const, phase: 'analysis', createdAt: '2025-01-01T00:00:00Z' },
      { id: '2', status: 'running' as const, phase: 'characters', createdAt: '2025-01-01T01:00:00Z' },
      { id: '3', status: 'pending' as const, phase: 'locations', createdAt: '2025-01-01T02:00:00Z' },
    ]
    const result = getActivePipelineRun(runs)
    expect(result).not.toBeNull()
    expect(result!.id).toBe('2')
  })

  it('返回 null 当所有 run 都是终态', () => {
    const runs = [
      { id: '1', status: 'succeeded' as const, phase: 'analysis', createdAt: '2025-01-01T00:00:00Z' },
      { id: '2', status: 'failed' as const, phase: 'characters', createdAt: '2025-01-01T01:00:00Z' },
    ]
    expect(getActivePipelineRun(runs)).toBeNull()
  })

  it('返回 null 当数组为空', () => {
    expect(getActivePipelineRun([])).toBeNull()
  })

  it('只识别 pending 和 running 为活跃状态', () => {
    const allStatuses = [
      { id: '1', status: 'draft' as const, phase: 'analysis', createdAt: '' },
      { id: '2', status: 'queued' as const, phase: 'analysis', createdAt: '' },
      { id: '3', status: 'succeeded' as const, phase: 'analysis', createdAt: '' },
      { id: '4', status: 'failed' as const, phase: 'analysis', createdAt: '' },
      { id: '5', status: 'cancelled' as const, phase: 'analysis', createdAt: '' },
    ]
    expect(getActivePipelineRun(allStatuses)).toBeNull()
  })

  it('pending 状态的 run 也视为活跃', () => {
    const runs = [
      { id: 'pending-1', status: 'pending' as const, phase: 'analysis', createdAt: '2025-01-01T00:00:00Z' },
    ]
    expect(getActivePipelineRun(runs)!.id).toBe('pending-1')
  })
})
