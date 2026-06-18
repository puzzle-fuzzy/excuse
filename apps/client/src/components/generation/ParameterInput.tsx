import type { ModelParameter } from '@/api/client'
import { FileText, Loader2, Upload, Video, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

interface ParameterInputProps {
  param: ModelParameter
  value: unknown
  onChange: (value: unknown) => void
  /** 输入框唯一 ID 前缀（避免 Workspace / ModelLab 的 DOM id 冲突） */
  idPrefix?: string

  // ── mediaUpload 专属 ──
  /** 是否正在上传 */
  uploading?: boolean
  /** 上传触发（父组件负责创建 file input 并发起上传） */
  onUpload?: () => void
  /** 清除已上传的媒体 */
  onClear?: () => void
  /** 已上传文件名（用于展示） */
  uploadedName?: string
}

/**
 * 模型参数输入组件 — 根据 ModelParameter.type 渲染对应的表单控件。
 *
 * 覆盖 text / number / select / boolean / mediaUpload 五种参数形态，
 * 替代 Workspace.tsx renderParamInput 与 ModelLab.tsx renderParam 的重复实现。
 *
 * mediaUpload 模式下，父组件通过 onUpload / onClear / uploading / uploadedName
 * 注入上传行为（Workspace 用 store action，ModelLab 用本地 file input）。
 */
export default function ParameterInput({
  param,
  value,
  onChange,
  idPrefix = 'param',
  uploading = false,
  onUpload,
  onClear,
  uploadedName,
}: ParameterInputProps) {
  const inputId = `${idPrefix}-${param.name}`

  // ── mediaUpload ──────────────────────────────────
  if (param.mediaUpload) {
    const currentUrl = typeof value === 'string' ? value : ''
    const hasUrl = currentUrl.trim() !== ''
    const isImage = param.mediaUpload.accept.startsWith('image/')
    const isVideo = param.mediaUpload.accept.startsWith('video/')
    const isAudio = param.mediaUpload.accept.startsWith('audio/')

    return (
      <div className="space-y-2">
        {hasUrl && (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2">
            {isImage && (
              <img src={currentUrl} alt={param.description || ''} className="size-12 rounded border object-cover" />
            )}
            {isVideo && (
              <div className="flex size-12 items-center justify-center rounded border bg-muted">
                <Video className="size-5 text-muted-foreground" />
              </div>
            )}
            {isAudio && (
              <div className="flex size-12 items-center justify-center rounded border bg-muted">
                <FileText className="size-5 text-muted-foreground" />
              </div>
            )}
            {!isImage && !isVideo && !isAudio && (
              <div className="flex size-12 items-center justify-center rounded border bg-muted">
                <FileText className="size-5 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-muted-foreground">
                {uploadedName || currentUrl}
              </p>
            </div>
            {onClear && (
              <Button
                variant="ghost"
                size="sm"
                className="size-7 p-0 text-muted-foreground hover:text-destructive"
                onClick={onClear}
                aria-label={`清除${param.description || param.name}`}
              >
                <X className="size-4" />
              </Button>
            )}
          </div>
        )}

        {!hasUrl && (
          <button
            type="button"
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/25 p-3 text-sm text-muted-foreground transition-colors hover:border-muted-foreground/50 hover:bg-muted/30"
            onClick={onUpload}
            disabled={uploading}
          >
            {uploading
              ? <Loader2 className="size-4 animate-spin" />
              : <Upload className="size-4" />}
            {uploading ? '上传中...' : `点击上传${isImage ? '图片' : isVideo ? '视频' : isAudio ? '音频' : '文件'}`}
          </button>
        )}
      </div>
    )
  }

  // ── text ──────────────────────────────────────────
  if (param.type === 'text') {
    const isPrompt = param.name === 'prompt' || param.name === 'negative_prompt'
    if (isPrompt) {
      return (
        <Textarea
          id={inputId}
          placeholder={param.description || param.name}
          value={typeof value === 'string' ? value : ''}
          onChange={e => onChange(e.target.value)}
          rows={param.name === 'prompt' ? 4 : 2}
          className="resize-none"
        />
      )
    }
    return (
      <Input
        id={inputId}
        placeholder={param.description || param.name}
        value={typeof value === 'string' ? value : ''}
        onChange={e => onChange(e.target.value)}
      />
    )
  }

  // ── number ────────────────────────────────────────
  if (param.type === 'number') {
    return (
      <Input
        id={inputId}
        type="number"
        placeholder={param.description || param.name}
        value={String(value ?? param.defaultValue ?? '')}
        min={param.min}
        max={param.max}
        onChange={e => onChange(Number(e.target.value))}
      />
    )
  }

  // ── select ────────────────────────────────────────
  if (param.type === 'select') {
    return (
      <Select
        value={String(value ?? param.defaultValue ?? '')}
        onValueChange={val => onChange(val)}
      >
        <SelectTrigger id={inputId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {param.options?.map(o => (
            <SelectItem key={String(o.value)} value={String(o.value)}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  // ── boolean ───────────────────────────────────────
  if (param.type === 'boolean') {
    return (
      <label htmlFor={inputId} className="flex items-center gap-2 cursor-pointer">
        <input
          id={inputId}
          type="checkbox"
          checked={Boolean(value ?? param.defaultValue ?? false)}
          onChange={e => onChange(e.target.checked)}
          className="rounded border-input"
        />
        <span className="text-sm text-muted-foreground">{param.description || param.name}</span>
      </label>
    )
  }

  // ── fallback ──────────────────────────────────────
  return (
    <Input
      id={inputId}
      placeholder={param.description || param.name}
      value={String(value ?? '')}
      onChange={e => onChange(e.target.value)}
    />
  )
}
