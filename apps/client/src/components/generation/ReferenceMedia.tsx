import type { GenerationInputParams } from '@excuse/shared'
import { AudioLines } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { isAudioUrl, isImageUrl, isUrl, isVideoUrl } from '@/lib/generation-utils'

export default function ReferenceMedia({ inputParams }: { inputParams: GenerationInputParams }) {
  const mediaUrlParams = Object.entries(inputParams || {}).filter(
    ([, v]) => isUrl(v),
  )

  if (mediaUrlParams.length === 0)
    return null

  return (
    <div className="mt-2">
      <p className="mb-1 text-[10px] font-medium text-muted-foreground">参考素材</p>
      <div className="flex gap-1.5 flex-wrap">
        {mediaUrlParams.map(([key, url]) => {
          const u = url as string
          if (isImageUrl(u)) {
            return (
              <img
                key={key}
                src={u}
                alt={key}
                className="size-16 cursor-pointer rounded border object-cover hover:opacity-80 transition-opacity"
              />
            )
          }
          if (isVideoUrl(u)) {
            return (
              <video key={key} src={u} className="w-full max-w-xs rounded-lg border" controls />
            )
          }
          if (isAudioUrl(u)) {
            return (
              <Badge key={key} variant="outline" className="text-[10px] gap-1">
                <AudioLines className="size-3" />
                {key}
                : 音频文件
              </Badge>
            )
          }
          return (
            <Badge key={key} variant="outline" className="text-[10px]">
              {key}
              :
              {u.slice(0, 30)}
            </Badge>
          )
        })}
      </div>
    </div>
  )
}
