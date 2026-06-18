import type { ServerConfig } from '../config'
import { logger } from '@excuse/shared'
import { Elysia } from 'elysia'

interface CspReportBody {
  'csp-report'?: {
    'document-uri'?: string
    'referrer'?: string
    'violated-directive'?: string
    'effective-directive'?: string
    'original-policy'?: string
    'disposition'?: string
    'blocked-uri'?: string
    'line-number'?: number
    'column-number'?: number
    'source-file'?: string
    'status-code'?: number
    'script-sample'?: string
  }
}

/**
 * POST /api/csp-report — Content-Security-Policy 违规上报端点
 *
 * 配合 securityHeadersPlugin 的 `Content-Security-Policy-Report-Only` + `report-uri`：
 * 浏览器在遇到（会被）策略阻断的资源时，把 `{ 'csp-report': {...} }` POST 到这里。
 * 端点仅落日志（不持久化、不要求认证），用于评估「切到 enforce 模式」是否安全。
 *
 * 当线上持续零违规时，即可把安全头从 Report-Only 改为 enforce（详见 security-headers.ts）。
 */
export function createCspReportRoutes(_config: ServerConfig) {
  return new Elysia({ prefix: '/api/csp-report' })
    .post('/', ({ body }) => {
      const report = (body as CspReportBody | null)?.['csp-report']
      if (report) {
        logger.warn({
          'document-uri': report['document-uri'],
          'violated-directive': report['violated-directive'],
          'blocked-uri': report['blocked-uri'],
          'source-file': report['source-file'],
          'line-number': report['line-number'],
          'script-sample': report['script-sample'],
          'disposition': report.disposition,
        }, 'CSP violation reported')
      }
      // 204 — 浏览器不关心响应体；空 body 避免无谓往返
      return new Response(null, { status: 204 })
    }, {
      // 违规报告由浏览器自动发出，无凭证、无 JSON content-type，放宽松校验
      parse: 'text',
    })
}
