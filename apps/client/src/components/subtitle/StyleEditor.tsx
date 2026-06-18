import type { SubtitleStyleConfig } from '@excuse/shared'
import { SUBTITLE_STYLE_PRESETS } from '@excuse/subtitle-engine'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

const FONT_SIZE_MIN = 18
const FONT_SIZE_MAX = 96
const FONT_SIZE_STEP = 2
const FONT_SIZE_PRESETS = [
  { label: '小', value: 28 },
  { label: '标准', value: 38 },
  { label: '大', value: 48 },
  { label: '超大', value: 60 },
] as const

function clampFontSize(value: number): number {
  if (!Number.isFinite(value))
    return 38
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(value)))
}

interface StyleEditorProps {
  currentStyle: SubtitleStyleConfig | null
  selectedPreset: string
  canEdit: boolean
  onPresetChange: (presetId: string) => void
  onStyleOverride: (key: keyof SubtitleStyleConfig, value: unknown) => void
}

export default function StyleEditor({
  currentStyle,
  selectedPreset,
  canEdit,
  onPresetChange,
  onStyleOverride,
}: StyleEditorProps) {
  return (
    <Card>
      <div className="px-4 pt-3 pb-2">
        <h3 className="text-sm font-semibold">字幕样式</h3>
      </div>
      <div className="px-4 pb-4 space-y-3">
        {/* Preset Selection */}
        <div className="grid grid-cols-3 gap-2">
          {SUBTITLE_STYLE_PRESETS.map(preset => (
            <button
              key={preset.id}
              type="button"
              className={`p-2 rounded text-xs transition-colors ${
                selectedPreset === preset.id ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
              }`}
              onClick={() => onPresetChange(preset.id)}
              disabled={!canEdit}
            >
              {preset.name}
            </button>
          ))}
        </div>

        {/* Style Override Controls */}
        {currentStyle && canEdit && (
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2 space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium">字幕大小</label>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min={FONT_SIZE_MIN}
                    max={FONT_SIZE_MAX}
                    step={FONT_SIZE_STEP}
                    value={currentStyle.fontSize}
                    onChange={e => onStyleOverride('fontSize', clampFontSize(Number(e.target.value)))}
                    className="h-8 w-20 text-right"
                  />
                  <span className="text-xs text-muted-foreground">px</span>
                </div>
              </div>
              <input
                type="range"
                min={FONT_SIZE_MIN}
                max={FONT_SIZE_MAX}
                step={FONT_SIZE_STEP}
                value={currentStyle.fontSize}
                onChange={e => onStyleOverride('fontSize', clampFontSize(Number(e.target.value)))}
                className="w-full accent-primary"
                aria-label="字幕大小"
              />
              <div className="grid grid-cols-4 gap-1">
                {FONT_SIZE_PRESETS.map(preset => (
                  <Button
                    key={preset.label}
                    type="button"
                    variant={currentStyle.fontSize === preset.value ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => onStyleOverride('fontSize', preset.value)}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                导出视频会使用这里的字号；1080p 推荐 38-48，短视频可用 48 以上。
              </p>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">字体颜色</label>
              <div className="flex items-center gap-1">
                <input
                  type="color"
                  value={currentStyle.fontColor}
                  onChange={e => onStyleOverride('fontColor', e.target.value)}
                  className="size-8 rounded cursor-pointer"
                />
                <Input
                  value={currentStyle.fontColor}
                  onChange={e => onStyleOverride('fontColor', e.target.value)}
                  className="flex-1"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">描边宽度</label>
              <Input
                type="number"
                value={currentStyle.outlineWidth}
                onChange={e => onStyleOverride('outlineWidth', Number(e.target.value))}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">位置</label>
              <select
                className="w-full rounded-md border p-2 text-sm"
                value={currentStyle.position}
                onChange={e => onStyleOverride('position', e.target.value)}
              >
                <option value="top">顶部</option>
                <option value="center">居中</option>
                <option value="bottom">底部</option>
              </select>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
