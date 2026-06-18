import type { ReactNode } from 'react'
import { Loader2, Upload } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export interface ReferenceFile {
  id: string
  url: string
  name: string
}

interface ReferenceImageUploaderProps {
  /** 已上传的参考图列表 */
  files: ReferenceFile[]
  /** 是否正在上传 */
  uploading: boolean
  /** 文件选择回调（父组件负责实际的上传逻辑） */
  onUpload: (files: FileList) => void
  /** 删除单张参考图 */
  onRemove: (id: string) => void
  /** 最大允许张数（默认 5） */
  maxCount?: number
  /** 标题文本（默认 "参考图片"） */
  title?: string
  /** 上传区提示文案 */
  uploadHint?: string
  /** 额外的顶部组件（如说明文字） */
  children?: ReactNode
}

/**
 * 共享参考图片上传组件 — 虚线框上传区 + 缩略图网格 + 删除。
 *
 * 替代 Workspace.tsx 与 ModelLab.tsx 中重复的参考图上传 UI。
 * 父组件通过 onUpload / onRemove 注入上传逻辑（store action 或本地状态）。
 */
export default function ReferenceImageUploader({
  files,
  uploading,
  onUpload,
  onRemove,
  maxCount = 5,
  title = '参考图片',
  uploadHint = `点击上传参考图片（最多 ${maxCount} 张）`,
  children,
}: ReferenceImageUploaderProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {children}
          <label className="flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 p-4 transition-colors hover:border-muted-foreground/50">
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={e => e.target.files?.length && onUpload(e.target.files)}
              disabled={uploading}
            />
            {uploading
              ? <Loader2 className="size-5 animate-spin text-muted-foreground" />
              : (
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Upload className="size-4" />
                    {uploadHint}
                  </span>
                )}
          </label>
          {files.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {files.map(file => (
                <div key={file.id} className="relative size-16 overflow-hidden rounded-lg border">
                  <img src={file.url} alt={file.name} className="size-full object-cover" />
                  <button
                    type="button"
                    className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-destructive text-white text-xs"
                    onClick={() => onRemove(file.id)}
                    aria-label={`删除 ${file.name}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
