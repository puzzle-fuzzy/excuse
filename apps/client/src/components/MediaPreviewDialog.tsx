import { Download, X } from 'lucide-react'

interface MediaPreviewDialogProps {
  url: string | null
  onClose: () => void
}

/** 根据 URL 后缀推断媒体类型 */
function detectMediaType(url: string): 'image' | 'video' | 'audio' {
  const lower = url.toLowerCase().split('?')[0]
  if (/\.(?:mp4|webm|mov|avi|mkv|m4v)$/.test(lower))
    return 'video'
  if (/\.(?:mp3|wav|ogg|aac|flac|m4a)$/.test(lower))
    return 'audio'
  return 'image'
}

export default function MediaPreviewDialog({ url, onClose }: MediaPreviewDialogProps) {
  if (!url)
    return null

  const mediaType = detectMediaType(url)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={onClose}>
      <div className="relative max-h-[90vh] max-w-[90vw]">
        {mediaType === 'image' && (
          <img src={url} alt="Preview" className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain" />
        )}
        {mediaType === 'video' && (
          <video
            src={url}
            controls
            autoPlay
            className="max-h-[90vh] max-w-[90vw] rounded-lg"
            onClick={e => e.stopPropagation()}
          />
        )}
        {mediaType === 'audio' && (
          <div className="flex items-center gap-4 rounded-lg bg-gray-900 p-8" onClick={e => e.stopPropagation()}>
            <audio src={url} controls autoPlay />
          </div>
        )}
        <a
          href={url}
          download
          className="absolute right-2 top-2 rounded-lg bg-black/50 p-2 text-white hover:bg-black/70"
          onClick={e => e.stopPropagation()}
        >
          <Download className="size-4" />
        </a>
        <button
          className="absolute left-2 top-2 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70"
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}
