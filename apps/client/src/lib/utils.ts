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
