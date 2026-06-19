import type { ImageOutputResult } from '@excuse/shared'
import { getAssetUrls } from '@/lib/generation-utils'

export default function ImageOutputPreview({ output, onPreview }: { output: ImageOutputResult, onPreview: (url: string) => void }) {
  const urls = getAssetUrls(output)
  return (
    <div className="flex gap-2 flex-wrap">
      {urls.map(url => (
        <img
          key={url}
          src={url}
          alt="生成图片"
          className="size-28 cursor-pointer rounded-lg border object-cover hover:opacity-80 transition-opacity"
          onClick={() => onPreview(url)}
        />
      ))}
    </div>
  )
}
