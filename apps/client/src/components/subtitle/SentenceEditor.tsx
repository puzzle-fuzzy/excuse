import type { SubtitleSentence } from '@excuse/shared'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

interface SentenceEditorProps {
  sentence: SubtitleSentence
  index: number
  onChange: (index: number, updated: SubtitleSentence) => void
}

export default function SentenceEditor({ sentence, index, onChange }: SentenceEditorProps) {
  return (
    <Card>
      <div className="px-4 pt-3 pb-2">
        <h3 className="text-sm font-semibold">
          编辑句子 #
          {index + 1}
        </h3>
      </div>
      <div className="px-4 pb-4 space-y-3">
        <Textarea
          value={sentence.text}
          onChange={(e) => {
            onChange(index, { ...sentence, text: e.target.value })
          }}
          rows={3}
          className="resize-none"
        />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-muted-foreground">开始时间</label>
            <Input
              type="number"
              value={sentence.beginTime}
              onChange={(e) => {
                onChange(index, { ...sentence, beginTime: Number(e.target.value) })
              }}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">结束时间</label>
            <Input
              type="number"
              value={sentence.endTime}
              onChange={(e) => {
                onChange(index, { ...sentence, endTime: Number(e.target.value) })
              }}
            />
          </div>
        </div>
      </div>
    </Card>
  )
}
