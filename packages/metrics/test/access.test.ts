import { describe, expect, it } from 'bun:test'
import { evaluateMetricsAccess, isAllowedIp } from '../src'

describe('isAllowedIp', () => {
  it('默认回环白名单接受 127.x.x.x', () => {
    expect(isAllowedIp('127.0.0.1', ['127.0.0.0/8'])).toBe(true)
    expect(isAllowedIp('127.255.255.255', ['127.0.0.0/8'])).toBe(true)
  })

  it('默认回环白名单接受 ::1', () => {
    expect(isAllowedIp('::1', ['::1/128'])).toBe(true)
  })

  it('非白名单 IP 拒绝', () => {
    expect(isAllowedIp('8.8.8.8', ['127.0.0.0/8', '::1/128'])).toBe(false)
  })

  it('完整 IPv4 /32 等值匹配', () => {
    expect(isAllowedIp('10.0.0.5', ['10.0.0.5/32'])).toBe(true)
    expect(isAllowedIp('10.0.0.6', ['10.0.0.5/32'])).toBe(false)
  })

  it('无前缀 CIDR 按精确 IP 等值匹配', () => {
    expect(isAllowedIp('10.0.0.5', ['10.0.0.5'])).toBe(true)
    expect(isAllowedIp('10.0.0.6', ['10.0.0.5'])).toBe(false)
  })

  it('不支持的 IPv4 段（/24）→ 即使命中前缀也拒绝', () => {
    expect(isAllowedIp('10.0.0.5', ['10.0.0.0/24'])).toBe(false)
  })

  it('空字符串 IP 拒绝', () => {
    expect(isAllowedIp('', ['127.0.0.0/8'])).toBe(false)
  })
})

describe('evaluateMetricsAccess', () => {
  const LOOPBACK = ['127.0.0.1/32', '::1/128']

  it('回环 IP + 未配置 token → 放行', () => {
    expect(evaluateMetricsAccess({ remoteIp: '127.0.0.1', authHeader: null, allowedCidrs: LOOPBACK })).toEqual({ allowed: true })
  })

  it('::1 IPv6 回环 → 放行', () => {
    expect(evaluateMetricsAccess({ remoteIp: '::1', authHeader: null, allowedCidrs: LOOPBACK })).toEqual({ allowed: true })
  })

  it('非回环 IP + 未配置 token → 403 Forbidden', () => {
    const r = evaluateMetricsAccess({ remoteIp: '1.2.3.4', authHeader: null, allowedCidrs: LOOPBACK })
    expect(r.allowed).toBe(false)
    expect(r.denyStatus).toBe(403)
    expect(r.denyBody).toBe('Forbidden')
  })

  it('非回环 IP + 配置 token + 正确 Bearer → 放行', () => {
    const r = evaluateMetricsAccess({
      remoteIp: '1.2.3.4',
      authHeader: 'Bearer secret-token',
      allowedCidrs: LOOPBACK,
      token: 'secret-token',
    })
    expect(r).toEqual({ allowed: true })
  })

  it('非回环 IP + 配置 token + 错误 Bearer → 401', () => {
    const r = evaluateMetricsAccess({
      remoteIp: '1.2.3.4',
      authHeader: 'Bearer wrong-token',
      allowedCidrs: LOOPBACK,
      token: 'secret-token',
    })
    expect(r.allowed).toBe(false)
    expect(r.denyStatus).toBe(401)
  })

  it('非回环 IP + 配置 token + 缺 Authorization → 401 + www-authenticate', () => {
    const r = evaluateMetricsAccess({
      remoteIp: '1.2.3.4',
      authHeader: null,
      allowedCidrs: LOOPBACK,
      token: 'secret-token',
    })
    expect(r.allowed).toBe(false)
    expect(r.denyStatus).toBe(401)
    expect(r.wwwAuthenticate).toContain('Bearer')
  })

  it('配置 token 时即使 IP 在白名单内也必须带正确 Bearer（避免误开放）', () => {
    const r = evaluateMetricsAccess({
      remoteIp: '127.0.0.1',
      authHeader: null,
      allowedCidrs: LOOPBACK,
      token: 'secret-token',
    })
    expect(r.allowed).toBe(false)
    expect(r.denyStatus).toBe(401)
  })

  it('自定义 allowedCidrs 放行非回环 IP（无 token）', () => {
    const r = evaluateMetricsAccess({
      remoteIp: '10.0.0.5',
      authHeader: null,
      allowedCidrs: ['10.0.0.5/32'],
    })
    expect(r).toEqual({ allowed: true })
  })

  it('空 remoteIp + 未配置 token → 403', () => {
    const r = evaluateMetricsAccess({ remoteIp: '', authHeader: null, allowedCidrs: LOOPBACK })
    expect(r.allowed).toBe(false)
    expect(r.denyStatus).toBe(403)
  })

  it('Bearer 大小写敏感前缀', () => {
    const r = evaluateMetricsAccess({
      remoteIp: '1.2.3.4',
      authHeader: 'bearer secret-token',
      allowedCidrs: LOOPBACK,
      token: 'secret-token',
    })
    expect(r.allowed).toBe(false)
    expect(r.denyStatus).toBe(401)
  })
})
