import { Pencil, Trash2, Upload, Undo2, ZoomIn } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

/** 图片点击放大查看的简易 lightbox */
function ImageViewer({ src, alt, onClose }: { src: string, alt: string, onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 cursor-zoom-out"
      onClick={onClose}
    >
      <img
        src={src}
        alt={alt}
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
        onClick={e => e.stopPropagation()}
      />
    </div>
  )
}

interface ReferenceUploadZoneProps {
  currentUrl: string | null
  onUpload: (file: File) => Promise<string>
  accept?: string
  label?: string
  /** 删除前显示的确认文案，不传则不显示删除按钮 */
  confirmRemove?: string
}

export function ReferenceUploadZone({
  currentUrl,
  onUpload,
  accept = 'image/*',
  label = '参考图',
  confirmRemove,
}: ReferenceUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentUrl)
  const [error, setError] = useState<string | null>(null)
  const [viewerOpen, setViewerOpen] = useState(false)
  /** 已「删除」但仍可恢复的 URL（不清 DB，只隐藏 UI） */
  const [hiddenUrl, setHiddenUrl] = useState<string | null>(null)

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('仅支持图片文件')
      return
    }
    setError(null)
    setUploading(true)

    try {
      const localUrl = URL.createObjectURL(file)
      setPreviewUrl(localUrl)

      const url = await onUpload(file)
      setPreviewUrl(url)
    }
    catch (err) {
      setError(err instanceof Error ? err.message : '上传失败')
      setPreviewUrl(currentUrl)
    }
    finally {
      setUploading(false)
    }
  }, [onUpload, currentUrl])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file)
      handleFile(file)
  }, [handleFile])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragging(false)
  }, [])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file)
      handleFile(file)
    e.target.value = ''
  }, [handleFile])

  /** 「删除」：不清 DB，只隐藏 UI，保留恢复能力 */
  const handleRemove = useCallback(async () => {
    if (confirmRemove && !window.confirm(confirmRemove))
      return
    if (previewUrl) {
      setHiddenUrl(previewUrl)
      setPreviewUrl(null)
    }
  }, [confirmRemove, previewUrl])

  /** 恢复之前隐藏的图片 */
  const handleRestore = useCallback(() => {
    if (hiddenUrl) {
      setPreviewUrl(hiddenUrl)
      setHiddenUrl(null)
    }
  }, [hiddenUrl])

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>

      {previewUrl
        ? (
            <div className="relative group rounded-lg overflow-hidden border">
              <img
                src={previewUrl}
                alt={label}
                className="w-full h-40 object-cover cursor-zoom-in"
                onClick={() => setViewerOpen(true)}
              />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={(e) => { e.stopPropagation(); setViewerOpen(true) }}
                >
                  <ZoomIn className="w-3 h-3 mr-1" />
                  查看
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={(e) => { e.stopPropagation(); inputRef.current?.click() }}
                  disabled={uploading}
                >
                  <Pencil className="w-3 h-3 mr-1" />
                  替换
                </Button>
                {confirmRemove && (
                  <Button
                    variant="destructive"
                    size="xs"
                    onClick={(e) => { e.stopPropagation(); handleRemove() }}
                  >
                    <Trash2 className="w-3 h-3 mr-1" />
                    隐藏
                  </Button>
                )}
              </div>
            </div>
          )
        : hiddenUrl
          ? (
              <div className="flex flex-col items-center justify-center h-40 rounded-lg border-2 border-dashed border-muted-foreground/25 bg-muted/20">
                <p className="text-xs text-muted-foreground mb-3">图片已隐藏</p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRestore}
                  >
                    <Undo2 className="w-3 h-3 mr-1" />
                    恢复
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => inputRef.current?.click()}
                  >
                    <Upload className="w-3 h-3 mr-1" />
                    上传新图片
                  </Button>
                </div>
              </div>
            )
          : (
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => inputRef.current?.click()}
                className={`
              flex flex-col items-center justify-center h-40 rounded-lg border-2 border-dashed cursor-pointer transition-colors
              ${dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50'}
              ${uploading ? 'opacity-50 pointer-events-none' : ''}
            `}
              >
                {uploading
                  ? (
                      <p className="text-xs text-muted-foreground">上传中...</p>
                    )
                  : (
                      <>
                        <Upload className="w-8 h-8 text-muted-foreground/50 mb-2" />
                        <p className="text-xs text-muted-foreground">拖拽图片到此处，或点击上传</p>
                      </>
                    )}
              </div>
            )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleInputChange}
        className="hidden"
      />

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {viewerOpen && previewUrl && (
        <ImageViewer src={previewUrl} alt={label} onClose={() => setViewerOpen(false)} />
      )}
    </div>
  )
}
