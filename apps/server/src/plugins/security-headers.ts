/**
 * 安全响应头插件 — 为所有 HTTP 响应添加安全相关 headers
 *
 * 防御措施：
 *   - X-Frame-Options: DENY → 防止 clickjacking（页面被嵌入 iframe）
 *   - X-Content-Type-Options: nosniff → 防止 MIME 类型嗅探攻击
 *   - Referrer-Policy: strict-origin-when-cross-origin → 防止敏感 URL 参数泄露
 *   - X-XSS-Protection: 0 → 禁用浏览器旧版 XSS 过滤器（CSP 更可靠）
 *   - Permissions-Policy → 限制浏览器功能访问（摄像头、麦克风等）
 *   - Content-Security-Policy-Report-Only → 防 XSS 的核心防线
 *
 * CSP 当前为 Report-Only（仅上报不阻断）——浏览器把违规投递到 /api/csp-report，
 * 由 logger 落库以便团队评估「切到 enforce 模式」是否安全。确认线上零违规后再把
 * header 名换成 Content-Security-Policy。策略说明：
 *   - script-src 'self'：仅允许同源脚本（生产构建产物为外部 hashed JS，无 inline）
 *   - style-src 'unsafe-inline'：Tailwind + Radix/sonner 会注入内联 style 属性
 *   - img/media-src 允许 data:/blob:/https：前端从 OSS / dashscope 远程加载图视频
 *   - connect-src 'self'：Eden treaty + SSE 均走同源 /api
 *   - frame-ancestors 'none' + object-src 'none'：彻底封堵 iframe 嵌入与插件
 */
import { Elysia } from 'elysia'

/**
 * CSP 策略（nginx 与本插件共用同一份，改动时两处同步）。
 * 注意：nginx.conf 里有一份等价字符串，修改时务必同步。
 */
export const CSP_POLICY = [
  `default-src 'self'`,
  `script-src 'self'`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob: https:`,
  `media-src 'self' blob: https:`,
  `font-src 'self' data:`,
  `connect-src 'self'`,
  `worker-src 'self' blob:`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  `frame-ancestors 'none'`,
  `report-uri /api/csp-report`,
].join('; ')

export const securityHeadersPlugin = new Elysia({ name: 'security-headers' })
  .derive(({ set }) => {
    set.headers['X-Frame-Options'] = 'DENY'
    set.headers['X-Content-Type-Options'] = 'nosniff'
    set.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    set.headers['X-XSS-Protection'] = '0'
    set.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'
    // Report-Only：仅上报不阻断，确认线上零违规后切 enforce（详见文件头注释）
    set.headers['Content-Security-Policy-Report-Only'] = CSP_POLICY
    return {}
  })
