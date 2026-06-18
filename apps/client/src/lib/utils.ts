import type { ClassValue } from 'clsx'
import { clsx } from 'clsx'
import { toast } from 'sonner'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export async function copyToClipboard(text: string, successMsg = '已复制') {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(successMsg)
  }
  catch {
    toast.error('复制失败')
  }
}

/**
 * 统一 API 错误反馈 — 根据状态码分级展示有意义的提示
 *
 * unwrapEden 已将服务端错误消息提取到 error.message，
 * 并将 HTTP 状态码附在 error.status 上。本函数据此分级：
 *   - 402 → 余额不足
 *   - 429 → 请求过于频繁
 *   - 5xx → 服务异常
 *   - 无 status → 网络错误
 *   - 其他 → 展示服务端返回的具体消息
 */
export function handleApiError(err: unknown, fallback = '请求失败') {
  const e = err instanceof Error ? err : null
  const status = (e as (Error & { status?: number }) | null)?.status
  const message = e?.message || ''

  if (status === 402) {
    toast.error('余额不足，请先充值后再试')
    return
  }
  if (status === 429) {
    toast.error(message || '请求过于频繁，请稍后再试')
    return
  }
  if (status && status >= 500) {
    toast.error(message || '服务异常，请稍后重试')
    return
  }
  // 无 status + 无 message → 网络层错误
  if (!status && !message) {
    toast.error('网络连接失败，请检查网络后重试')
    return
  }
  toast.error(message || fallback)
}
