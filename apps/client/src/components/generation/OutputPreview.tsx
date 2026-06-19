import type { OutputResult } from '@excuse/shared'
import { isImageOutput, isSubtitleOutput, isTextOutput, isVideoOutput } from '@excuse/shared'
import ImageOutputPreview from './ImageOutputPreview'
import SubtitleOutputPreview from './SubtitleOutputPreview'
import TextOutputPreview from './TextOutputPreview'
import VideoOutputPreview from './VideoOutputPreview'

interface OutputPreviewProps {
  output: OutputResult
  onPreview: (url: string) => void
}

export default function OutputPreview({ output, onPreview }: OutputPreviewProps) {
  if (isTextOutput(output))
    return <TextOutputPreview output={output} />
  if (isImageOutput(output))
    return <ImageOutputPreview output={output} onPreview={onPreview} />
  if (isVideoOutput(output))
    return <VideoOutputPreview output={output} />
  if (isSubtitleOutput(output))
    return <SubtitleOutputPreview output={output} onPreview={onPreview} />
  // ProcessingOutputResult 不需要预览
  return null
}
