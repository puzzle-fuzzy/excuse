import type { SubtitleSentence } from '@excuse/shared'
import { Scissors } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { formatMs } from '@/lib/generation-utils'

interface SubtitleTimelineProps {
  sentences: SubtitleSentence[]
  selectedIndex: number | null
  canEdit: boolean
  status: string
  onSelect: (index: number) => void
  onMerge: (index: number) => void
  onSplit: (index: number) => void
}

export default function SubtitleTimeline({
  sentences,
  selectedIndex,
  canEdit,
  status,
  onSelect,
  onMerge,
  onSplit,
}: SubtitleTimelineProps) {
  return (
    <Card className="overflow-hidden">
      <div className="px-4 pt-3 pb-2">
        <h3 className="text-sm font-semibold">字幕时间轴</h3>
      </div>
      <div className="px-4 pb-4">
        <ScrollArea className="h-75">
          <div className="space-y-1">
            {sentences.map((sentence, index) => (
              <div
                key={sentence.id}
                className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                  selectedIndex === index ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted/50'
                }`}
                onClick={() => onSelect(index)}
              >
                <span className="text-xs text-muted-foreground w-20 shrink-0">
                  {formatMs(sentence.beginTime)}
                  {' '}
                  -
                  {formatMs(sentence.endTime)}
                </span>
                <span className="text-sm flex-1 truncate">{sentence.text}</span>
                {canEdit && (
                  <div className="flex gap-1 shrink-0">
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-primary"
                      onClick={(e) => {
                        e.stopPropagation()
                        onMerge(index)
                      }}
                      title="合并下一句"
                    >
                      <Scissors className="size-3 rotate-90" />
                    </button>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-primary"
                      onClick={(e) => {
                        e.stopPropagation()
                        onSplit(index)
                      }}
                      title="拆分此句"
                    >
                      <Scissors className="size-3" />
                    </button>
                  </div>
                )}
              </div>
            ))}
            {sentences.length === 0 && (
              <div className="text-center py-8 text-sm text-muted-foreground">
                {status === 'asr_processing' ? 'ASR 识别进行中，请稍候...' : '暂无字幕内容'}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </Card>
  )
}
