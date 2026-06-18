/**
 * 安全响应头插件 — 为所有 HTTP 响应添加安全相关 headers
 *
 * 防御措施：
 *   - X-Frame-Options: DENY → 防止 clickjacking（页面被嵌入 iframe）
 *   - X-Content-Type-Options: nosniff → 防止 MIME 类型嗅探攻击
 *   - Referrer-Policy: strict-origin-when-cross-origin → 防止敏感 URL 参数泄露
 *   - X-XSS-Protection: 0 → 禁用浏览器旧版 XSS 过滤器（CSP 更可靠）
 *   - Permissions-Policy → 限制浏览器功能访问（摄像头、麦克风等）
 */
import { Elysia } from 'elysia'

export const securityHeadersPlugin = new Elysia({ name: 'security-headers' })
  .derive(({ set }) => {
    set.headers['X-Frame-Options'] = 'DENY'
    set.headers['X-Content-Type-Options'] = 'nosniff'
    set.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    set.headers['X-XSS-Protection'] = '0'
    set.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'
    return {}
  })
