import type { VideoOutputResult } from '@excuse/shared'
import { getAssetUrls } from '@/lib/generation-utils'

export default function VideoOutputPreview({ output }: { output: VideoOutputResult }) {
  const urls = getAssetUrls(output)
  return (
    <div className="flex gap-2">
      {urls.map(url => (
        <video
          key={url}
          src={url}
          className="w-full max-w-xs rounded-lg border aspect-video object-cover"
          controls
          loop
        />
      ))}
    </div>
  )
}
