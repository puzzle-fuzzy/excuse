import { describe, expect, it } from 'vitest'
import { formatRelativeTime } from '../src/lib/format-time'

// 固定 now（ms）避免依赖真实时钟；所有用例以此构造 iso 字符串。
const NOW = new Date('2026-06-15T12:00:00Z').getTime()
const iso = (offsetMs: number) => new Date(NOW - offsetMs).toISOString()

describe('formatRelativeTime', () => {
  it('< 1 分钟返回「刚刚」', () => {
    expect(formatRelativeTime(iso(30 * 1000), NOW)).toBe('刚刚')
  })

  it('未来时间（时钟偏移）兜底为「刚刚」', () => {
    expect(formatRelativeTime(new Date(NOW + 60 * 1000).toISOString(), NOW)).toBe('刚刚')
  })

  it('1~59 分钟返回「N 分钟前」', () => {
    expect(formatRelativeTime(iso(60 * 1000), NOW)).toBe('1 分钟前')
    expect(formatRelativeTime(iso(59 * 60 * 1000), NOW)).toBe('59 分钟前')
  })

  it('60 分钟进位为「N 小时前」', () => {
    expect(formatRelativeTime(iso(60 * 60 * 1000), NOW)).toBe('1 小时前')
    expect(formatRelativeTime(iso(23 * 60 * 60 * 1000), NOW)).toBe('23 小时前')
  })

  it('24 小时进位为「N 天前」', () => {
    expect(formatRelativeTime(iso(24 * 60 * 60 * 1000), NOW)).toBe('1 天前')
    expect(formatRelativeTime(iso(7 * 24 * 60 * 60 * 1000), NOW)).toBe('7 天前')
  })
})
