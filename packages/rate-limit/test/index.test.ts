import { describe, expect, it } from 'bun:test'
import {
  buildRateLimitKey,
  createRateLimitErrorBody,
  createRateLimitErrorResponse,
  SlidingWindowRateLimiter,
} from '../src'

describe('@excuse/rate-limit', () => {
  it('从 authorization 头构造 key', () => {
    const request = new Request('http://local.test', {
      headers: { Authorization: 'Bearer abcdef' },
    })

    expect(buildRateLimitKey(request)).toBe('user:Bearer abcdef')
  })

  it('缺少 auth 时回退到 forwarded ip 构造 key', () => {
    const request = new Request('http://local.test', {
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
    })

    expect(buildRateLimitKey(request)).toBe('ip:1.2.3.4')
  })

  it('构造一致的错误响应体与 Response', async () => {
    expect(createRateLimitErrorBody(12)).toEqual({
      success: false,
      error: '请求过于频繁，请稍后再试',
      retryAfter: 12,
    })

    const response = createRateLimitErrorResponse(12)
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('12')
    expect(await response.json()).toEqual(createRateLimitErrorBody(12))
  })

  it('在滑动窗口内对分类请求限流', () => {
    const limiter = new SlidingWindowRateLimiter()

    expect(limiter.check({ userId: 'u1', category: 'video', maxRequests: 2, windowMs: 1000, now: 1000 }).allowed).toBe(true)
    expect(limiter.check({ userId: 'u1', category: 'video', maxRequests: 2, windowMs: 1000, now: 1100 }).allowed).toBe(true)

    const blocked = limiter.check({ userId: 'u1', category: 'video', maxRequests: 2, windowMs: 1000, now: 1200 })
    expect(blocked).toEqual({ allowed: false, retryAfterSec: 1 })

    expect(limiter.check({ userId: 'u1', category: 'video', maxRequests: 2, windowMs: 1000, now: 2101 }).allowed).toBe(true)
  })
})
