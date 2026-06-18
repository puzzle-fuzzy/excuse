import { Card, CardContent } from '@/components/ui/card'

interface VideoPlayerProps {
  videoUrl: string | null
  maxHeight?: string
}

export default function VideoPlayer({ videoUrl, maxHeight = '400px' }: VideoPlayerProps) {
  if (!videoUrl)
    return null

  return (
    <Card>
      <CardContent className="p-2">
        <video
          src={videoUrl}
          controls
          className="w-full rounded-lg"
          style={{ maxHeight }}
        />
      </CardContent>
    </Card>
  )
}
