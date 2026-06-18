import type { SubtitleOutputResult } from '@excuse/shared'
import { Download } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { formatMs } from '@/lib/generation-utils'

export default function SubtitleOutputPreview({ output }: { output: SubtitleOutputResult, onPreview: (url: string) => void }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-medium text-muted-foreground">
        转录句子 (
        {output.sentences.length}
        {' '}
        条)
      </p>
      <ScrollArea className="max-h-40">
        <div className="rounded-lg bg-muted p-2 space-y-1">
          {output.sentences.map(s => (
            <div key={s.id} className="flex gap-2 text-xs">
              <span className="text-muted-foreground shrink-0">
                {formatMs(s.beginTime)}
                {' '}
                →
                {' '}
                {formatMs(s.endTime)}
              </span>
              <span className="flex-1">{s.text}</span>
              {s.speakerId != null && (
                <Badge variant="outline" className="text-[10px] shrink-0">
                  说话人
                  {' '}
                  {s.speakerId}
                </Badge>
              )}
            </div>
          ))}
          {output.sentences.length === 0 && (
            <p className="text-center text-xs text-muted-foreground py-4">暂无转录内容</p>
          )}
        </div>
      </ScrollArea>
      {output.transcriptionUrl && (
        <Button variant="outline" size="sm" asChild>
          <a href={output.transcriptionUrl} target="_blank" rel="noopener noreferrer">
            <Download className="size-3" />
            下载转录文件
          </a>
        </Button>
      )}
    </div>
  )
}
