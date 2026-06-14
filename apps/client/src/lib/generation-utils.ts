import { isImageOutput, isVideoOutput, parseOutputResult } from '@excuse/shared'
import currency from 'currency.js'
import {
  AlertCircle,
  AudioLines,
  CheckCircle2,
  Clock,
  FileText,
  ImageIcon,
  Loader2,
  Save,
  Send,
  Video,
  XCircle,
} from 'lucide-react'

export const CATEGORY_CONFIG = {
  text: { label: '文本生成', color: 'bg-blue-500', icon: FileText, activeColor: 'bg-blue-500 text-white' },
  image: { label: '图像生成', color: 'bg-purple-500', icon: ImageIcon, activeColor: 'bg-purple-500 text-white' },
  video: { label: '视频生成', color: 'bg-pink-500', icon: Video, activeColor: 'bg-pink-500 text-white' },
  subtitle: { label: '视频加字幕', color: 'bg-teal-500', icon: AudioLines, activeColor: 'bg-teal-500 text-white' },
} as const

export type Category = keyof typeof CATEGORY_CONFIG

export const STATUS_CONFIG: Record<string, { label: string, color: string, icon: typeof Clock }> = {
  pending: { label: '等待中', color: 'bg-yellow-100 text-yellow-700', icon: Clock },
  submitting: { label: '提交中', color: 'bg-orange-100 text-orange-700', icon: Send },
  processing: { label: '处理中', color: 'bg-blue-100 text-blue-700', icon: Loader2 },
  saving_output: { label: '保存中', color: 'bg-indigo-100 text-indigo-700', icon: Save },
  succeeded: { label: '已完成', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  failed: { label: '失败', color: 'bg-red-100 text-red-700', icon: XCircle },
  cancelled: { label: '已取消', color: 'bg-gray-100 text-gray-700', icon: AlertCircle },
}

/** 格式化时间为相对时间 + 完整日期 */
export function formatTime(iso: string) {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHour = Math.floor(diffMs / 3600000)
  const diffDay = Math.floor(diffMs / 86400000)
  const dateStr = date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  if (diffMin < 1)
    return `刚刚 ${dateStr}`
  if (diffMin < 60)
    return `${diffMin} 分钟前 ${dateStr}`
  if (diffHour < 24)
    return `${diffHour} 小时前 ${dateStr}`
  if (diffDay < 7)
    return `${diffDay} 天前 ${dateStr}`
  return dateStr
}

/** 计算 pending/processing 的持续时间 */
export function formatDuration(startIso: string, endIso?: string | null) {
  const start = new Date(startIso).getTime()
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  const diffSec = Math.round((end - start) / 1000)
  if (diffSec < 60)
    return `${diffSec}秒`
  if (diffSec < 3600)
    return `${Math.floor(diffSec / 60)}分${diffSec % 60}秒`
  return `${Math.floor(diffSec / 3600)}时${Math.floor((diffSec % 3600) / 60)}分`
}

/** 需要在参数展示中隐藏的字段 */
export const HIDDEN_PARAMS = new Set(['prompt', 'negative_prompt', 'referenceFileIds'])

/** 判断字符串是否为 URL（媒体文件） */
export function isUrl(v: unknown): v is string {
  return typeof v === 'string' && (v.startsWith('http://') || v.startsWith('https://'))
}

/** 判断 URL 是否为图片 */
export function isImageUrl(url: string) {
  return /\.(?:jpg|jpeg|png|gif|webp|bmp|svg)(?:\?.*)?$/i.test(url) || url.includes('/image')
}

/** 判断 URL 是否为视频 */
export function isVideoUrl(url: string) {
  return /\.(?:mp4|webm|mov|avi)(?:\?.*)?$/i.test(url) || url.includes('/video')
}

/** 判断 URL 是否为音频 */
export function isAudioUrl(url: string) {
  return /\.(?:mp3|wav|flac|ogg|m4a|aac)(?:\?.*)?$/i.test(url) || url.includes('/audio')
}

/** 将毫秒格式化为 M:SS */
export function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

/** 将整数分格式化为人民币字符串 */
export function formatCents(cents: number, precision = 2): string {
  return currency(cents, { fromCents: true, precision }).format()
}

/** 从 outputResult 提取可展示的媒体 URL 列表（自动规范化，带 fallback） */
export function getAssetUrls(raw: unknown): string[] {
  const output = parseOutputResult(raw)
  if (!output)
    return []
  if (isImageOutput(output) && output.savedUrls.length > 0)
    return output.savedUrls
  if (isVideoOutput(output) && output.savedUrls.length > 0)
    return output.savedUrls
  if (isImageOutput(output) && output.urls?.length)
    return output.urls
  if (isVideoOutput(output))
    return output.video_url ? [output.video_url] : output.originalUrl ? [output.originalUrl] : []
  return []
}
