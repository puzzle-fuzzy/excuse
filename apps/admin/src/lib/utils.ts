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
 *   - 401/403 → 跳过（由 unwrapEden 统一清理登录态并跳转 /login，不重复 toast）
 *   - 402 → 余额不足
 *   - 429 → 请求过于频繁
 *   - 5xx → 服务异常
 *   - 无 status → 网络错误
 *   - 其他 → 展示服务端返回的具体消息
 *
 * 去重：同一文案在 DEDUP_WINDOW_MS 内只弹一次。
 * 这让「本地 onError 调 handleApiError」与「全局 MutationCache.onError 兜底调 handleApiError」
 * 共存时不会双重 toast（同一 mutation 失败会同时触发两者）。
 */
const DEDUP_WINDOW_MS = 3000
const recentToasts = new Map<string, number>()

function shouldDedupeToast(key: string): boolean {
  const now = Date.now()
  const last = recentToasts.get(key)
  if (last && now - last < DEDUP_WINDOW_MS)
    return true
  recentToasts.set(key, now)
  return false
}

export function handleApiError(err: unknown, fallback = '请求失败') {
  const e = err instanceof Error ? err : null
  const status = (e as (Error & { status?: number }) | null)?.status
  const message = e?.message || ''

  // 401/403 由 unwrapEden 统一清理登录态并跳转 /login，此处不重复 toast
  if (status === 401 || status === 403)
    return

  let toastMsg: string
  if (status === 402) {
    toastMsg = '余额不足，请先充值后再试'
  }
  else if (status === 429) {
    toastMsg = message || '请求过于频繁，请稍后重试'
  }
  else if (status && status >= 500) {
    toastMsg = message || '服务异常，请稍后重试'
  }
  else if (!status && !message) {
    // 无 status + 无 message → 网络层错误
    toastMsg = '网络连接失败，请检查网络后重试'
  }
  else {
    toastMsg = message || fallback
  }

  if (!shouldDedupeToast(toastMsg))
    toast.error(toastMsg)
}
