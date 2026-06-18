import { describe, expect, it } from 'bun:test'
import {
  buildRateLimitKey,
  createRateLimitErrorBody,
  createRateLimitErrorResponse,
  SlidingWindowRateLimiter,
} from '../src'

/** 构造一个无签名但格式正确的 JWT（三段 base64url），用于测试 JWT 解码路径 */
function makeFakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = 'fake_signature'
  return `Bearer ${header}.${body}.${sig}`
}

describe('@excuse/rate-limit', () => {
  it('从有效 JWT 中解码 sub 构造 user key', () => {
    const request = new Request('http://local.test', {
      headers: { Authorization: makeFakeJwt({ sub: 'user-123' }) },
    })

    expect(buildRateLimitKey(request)).toBe('user:user-123')
  })

  it('无效 token（非 JWT 格式）回退到 IP bucket', () => {
    const request = new Request('http://local.test', {
      headers: { Authorization: 'Bearer not-a-jwt' },
    })

    expect(buildRateLimitKey(request)).toBe('ip:unknown')
  })

  it('缺少 auth 时回退到 forwarded ip 构造 key', () => {
    const request = new Request('http://local.test', {
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
    })

    expect(buildRateLimitKey(request)).toBe('ip:1.2.3.4')
  })

  it('JWT 无 sub 字段时回退到 IP bucket', () => {
    const request = new Request('http://local.test', {
      headers: { Authorization: makeFakeJwt({ iss: 'test' }) },
    })

    expect(buildRateLimitKey(request)).toBe('ip:unknown')
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
