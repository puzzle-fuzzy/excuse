/**
 * 前端错误上报 — 把错误投递到 /api/client-errors 落 server 日志
 *
 * 用裸 fetch 而非 Eden treaty：错误上报不应依赖 API client 自身的正常工作
 *（正是 client 异常时最需要上报）。上报本身失败静默吞掉，绝不产生二次错误。
 */

interface ClientErrorPayload {
  message: string
  stack?: string
  url?: string
  userAgent?: string
}

export function reportClientError(err: unknown) {
  try {
    const error = err instanceof Error ? err : new Error(typeof err === 'string' ? err : 'unknown error')
    const payload: ClientErrorPayload = {
      message: error.message,
      stack: error.stack,
      url: window.location.href,
      userAgent: navigator.userAgent,
    }
    fetch('/api/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {
      // 上报本身失败不产生二次错误
    })
  }
  catch {
    // 安全兜底
  }
}
