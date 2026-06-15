/**
 * `/metrics` 端点的访问策略 —— 纯函数，无 IO 依赖。
 *
 * 由 server（`apps/server/src/routes/metrics.ts`）和 worker
 * （`apps/worker/src/health.ts`）共用，保证两个进程的 `/metrics`
 * 访问策略一致。
 *
 * 设计约束：本文件不 import 任何 app 层模块，不读 `process.env`；
 * 配置值（allowedCidrs / token）由调用方从各自 config 注入。
 */

/** 访问判定入参。`token` 为 undefined 表示未配置 token（不做 Bearer 校验）。 */
export interface MetricsAccessInput {
  /** 请求来源 IP（一般取 `x-forwarded-for` 第一段，缺失为空串） */
  remoteIp: string
  /** `Authorization` 头原值，可能为 null */
  authHeader: string | null
  /** 允许的 CIDR / IP 列表 */
  allowedCidrs: string[]
  /** 配置的访问 token；undefined 表示未配置 */
  token?: string
}

/** 访问判定结果。`allowed=false` 时给出 HTTP 拒绝所需的 status/body/header。 */
export interface MetricsAccessResult {
  allowed: boolean
  /** 拒绝时的 HTTP 状态码 */
  denyStatus?: 403 | 401
  /** 拒绝时的响应体 */
  denyBody?: string
  /** 401 时的 `www-authenticate` 头值 */
  wwwAuthenticate?: string
}

const BEARER_REALM = 'Bearer realm="metrics"'

/**
 * 评估 `/metrics` 访问权限。
 *
 * 策略（与原 server route 内联逻辑严格一致）：
 * 1. IP 不在白名单且未配置 token → 403 Forbidden。
 * 2. 配置了 token 时（**即使 IP 在白名单内也必须校验**，避免误开放）：
 *    解析 `Authorization: Bearer <token>`，不匹配 / 缺失 → 401 Unauthorized + www-authenticate。
 * 3. 否则放行。
 */
export function evaluateMetricsAccess(input: MetricsAccessInput): MetricsAccessResult {
  const ipAllowed = isAllowedIp(input.remoteIp, input.allowedCidrs)
  const hasToken = Boolean(input.token)

  if (!ipAllowed && !hasToken) {
    return { allowed: false, denyStatus: 403, denyBody: 'Forbidden' }
  }

  if (hasToken) {
    const auth = input.authHeader ?? ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
    if (token !== input.token) {
      return {
        allowed: false,
        denyStatus: 401,
        denyBody: 'Unauthorized',
        wwwAuthenticate: BEARER_REALM,
      }
    }
  }

  return { allowed: true }
}

/**
 * 简化版 CIDR / IP 匹配（v1 不引入第三方库）。
 *
 * 支持的 CIDR 形态：
 * - `127.0.0.0/8`：IPv4 回环段（127.x.x.x 全部允许）
 * - `::1/128` 或 `::1`：IPv6 回环精确匹配
 * - 完整 IPv4 / IPv6 字符串等值（如 `10.0.0.5/32`、`10.0.0.5`、`fe80::1`）
 *
 * **不支持**：任意非 `/8`/`/32`/`/128` 的 IPv4 段（如 `10.0.0.0/24`）、IPv6 段（`fe80::/64`）。
 * 生产环境需要复杂 CIDR 时建议在反向代理层做 IP 白名单。
 */
export function isAllowedIp(remoteIp: string, allowedCidrs: string[]): boolean {
  if (!remoteIp)
    return false
  const ip = remoteIp.trim()

  for (const cidr of allowedCidrs) {
    const normalized = cidr.trim()
    if (!normalized)
      continue

    if (normalized.includes('/')) {
      const [base, prefixStr] = normalized.split('/')
      const prefix = Number(prefixStr)

      if (base && base.includes(':')) {
        // IPv6 仅支持 ::1/128 精确匹配
        if (prefix === 128 && base === '::1' && ip === '::1')
          return true
        continue
      }

      if (base && prefix === 8) {
        const segments = base.split('.')
        if (segments.length === 4 && segments[0] && ip.includes('.')) {
          const ipSegments = ip.split('.')
          if (ipSegments.length === 4 && ipSegments[0] === segments[0])
            return true
        }
        continue
      }

      if (base && prefix === 32) {
        if (ip === base)
          return true
        continue
      }
      continue
    }

    // 无前缀的 CIDR：当成精确 IP 等值匹配
    if (ip === normalized)
      return true
  }

  return false
}
