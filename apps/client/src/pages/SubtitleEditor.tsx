import type { SubtitleSentence, SubtitleStyleConfig } from '@excuse/shared'
import { SUBTITLE_STYLE_PRESETS } from '@excuse/subtitle-engine'
import { ArrowLeft, Download, Loader2, RefreshCcw, Save, Scissors, WandSparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { useSubtitleStore } from '@/stores/subtitle'

/** 状态中文标签 */
const STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  extracting_audio: '提取音频中',
  asr_processing: 'ASR 识别中',
  subtitle_editing: '字幕编辑',
  exporting: '导出中',
  completed: '已完成',
  failed: '失败',
}

const FONT_SIZE_MIN = 18
const FONT_SIZE_MAX = 96
const FONT_SIZE_STEP = 2
const FONT_SIZE_PRESETS = [
  { label: '小', value: 28 },
  { label: '标准', value: 38 },
  { label: '大', value: 48 },
  { label: '超大', value: 60 },
] as const
const BUSY_STATUSES = ['draft', 'extracting_audio', 'asr_processing', 'exporting'] as const

/** 格式化毫秒为 mm:ss 格式 */
function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function clampFontSize(value: number): number {
  if (!Number.isFinite(value))
    return 38
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(value)))
}

export default function SubtitleEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const currentProject = useSubtitleStore(s => s.currentProject)
  const selectProject = useSubtitleStore(s => s.selectProject)
  const updateSentences = useSubtitleStore(s => s.updateSentences)
  const updateStyle = useSubtitleStore(s => s.updateStyle)
  const exportProject = useSubtitleStore(s => s.exportProject)
  const exporting = useSubtitleStore(s => s.exporting)
  const retryProject = useSubtitleStore(s => s.retryProject)
  const loading = useSubtitleStore(s => s.loading)

  const [selectedSentenceIndex, setSelectedSentenceIndex] = useState<number | null>(null)
  const [editingSentences, setEditingSentences] = useState<SubtitleSentence[]>([])
  const [selectedPreset, setSelectedPreset] = useState<string>('cinema')
  const [styleDraft, setStyleDraft] = useState<SubtitleStyleConfig | null>(null)
  const [saving, setSaving] = useState(false)
  /** 是否已从服务器加载过句子 — 防止 SSE 刷新覆盖本地编辑 */
  const [sentencesLoaded, setSentencesLoaded] = useState(false)

  useEffect(() => {
    if (id) {
      selectProject(id)
    }
  }, [id, selectProject])

  // 同步 editingSentences — 首次加载或句子数量变化时同步服务器数据
  // SSE 更新仅同步句数变化（如 ASR 完成），不覆盖用户正在编辑的文字
  useEffect(() => {
    if (!currentProject?.sentences)
      return
    if (!sentencesLoaded) {
      setEditingSentences(currentProject.sentences)
      setSentencesLoaded(true)
    }
    else if (editingSentences.length !== currentProject.sentences.length) {
      setEditingSentences(currentProject.sentences)
    }
  }, [currentProject?.sentences, editingSentences.length, sentencesLoaded])

  // 同步字幕样式预设选择
  useEffect(() => {
    if (currentProject?.styleConfig) {
      setStyleDraft(currentProject.styleConfig)
      setSelectedPreset(currentProject.styleConfig.templateId)
    }
  }, [currentProject?.styleConfig])

  const hasSubtitleSentences = Boolean(currentProject?.sentences?.length)
  const isBusy = currentProject ? BUSY_STATUSES.includes(currentProject.status as typeof BUSY_STATUSES[number]) : true
  const canEditSentences = currentProject?.status === 'subtitle_editing'
  const canEditStyle = hasSubtitleSentences && !isBusy
  const canExport = hasSubtitleSentences && !isBusy
  const isCompleted = currentProject?.status === 'completed'
  const currentStyle = styleDraft ?? currentProject?.styleConfig ?? null

  async function handleSave() {
    setSaving(true)
    try {
      await updateSentences(editingSentences)
      toast.success('字幕已保存')
    }
    catch {
      toast.error('保存失败')
    }
    finally {
      setSaving(false)
    }
  }

  async function handleExport() {
    try {
      if (canEditStyle && styleDraft) {
        await updateStyle(styleDraft)
      }
      await exportProject()
    }
    catch {
      // error handled in store
    }
  }

  async function handleRetry() {
    try {
      await retryProject(currentProject!.id)
      // retry 在同一项目上操作（ID 不变），刷新详情即可
      await selectProject(currentProject!.id)
      // 重新加载后 reset editingSentences
      setSentencesLoaded(false)
    }
    catch {
      // error handled in store
    }
  }

  function handleMerge(index: number) {
    if (index >= editingSentences.length - 1)
      return
    const next = editingSentences[index + 1]!
    const merged: SubtitleSentence = {
      id: editingSentences[index]!.id,
      text: `${editingSentences[index]!.text} ${next.text}`,
      beginTime: editingSentences[index]!.beginTime,
      endTime: next.endTime,
    }
    const newSentences = [...editingSentences]
    newSentences.splice(index, 2, merged)
    setEditingSentences(newSentences)
    setSelectedSentenceIndex(null)
  }

  function handleSplit(index: number) {
    const sentence = editingSentences[index]!
    const midTime = Math.floor((sentence.beginTime + sentence.endTime) / 2)
    const firstHalf: SubtitleSentence = {
      id: sentence.id,
      text: sentence.text.slice(0, Math.ceil(sentence.text.length / 2)),
      beginTime: sentence.beginTime,
      endTime: midTime,
    }
    const secondHalf: SubtitleSentence = {
      id: crypto.randomUUID(),
      text: sentence.text.slice(Math.ceil(sentence.text.length / 2)),
      beginTime: midTime,
      endTime: sentence.endTime,
      ...(sentence.speakerId && { speakerId: sentence.speakerId }),
    }
    const newSentences = [...editingSentences]
    newSentences.splice(index, 1, firstHalf, secondHalf)
    setEditingSentences(newSentences)
  }

  function handlePresetChange(presetId: string) {
    setSelectedPreset(presetId)
    const preset = SUBTITLE_STYLE_PRESETS.find(p => p.id === presetId)
    if (preset) {
      setStyleDraft(preset.config)
    }
  }

  function handleStyleOverride(key: keyof SubtitleStyleConfig, value: unknown) {
    // 基于当前 styleConfig（包含之前的修改）而非 preset 基础值
    const current = styleDraft ?? currentProject?.styleConfig
    if (!current)
      return
    const updated = { ...current, [key]: value }
    setStyleDraft(updated as SubtitleStyleConfig)
  }

  function handleFontSizeChange(value: number) {
    handleStyleOverride('fontSize', clampFontSize(value))
  }

  if (!currentProject) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" onClick={() => navigate('/subtitle')}>
          <ArrowLeft className="size-4" />
          返回列表
        </Button>
        <div className="flex items-center gap-2">
          <span className={`text-sm ${canEditStyle ? 'text-green-600' : currentProject.status === 'failed' ? 'text-destructive' : 'text-blue-500'}`}>
            {STATUS_LABELS[currentProject.status] || currentProject.status}
          </span>
          {currentProject.status === 'failed' && (
            <Button onClick={handleRetry} disabled={loading} size="sm" variant="outline">
              {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
              重试
            </Button>
          )}
          {canEditSentences && (
            <Button onClick={handleSave} disabled={saving} size="sm">
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              保存
            </Button>
          )}
          {canExport && (
            <Button onClick={handleExport} disabled={exporting} size="sm">
              {exporting ? <Loader2 className="size-4 animate-spin" /> : <WandSparkles className="size-4" />}
              {isCompleted ? '按当前样式重新生成' : '生成带字幕视频'}
            </Button>
          )}
          {isCompleted && currentProject.exportedVideoUrl && (
            <a href={currentProject.exportedVideoUrl} download>
              <Button size="sm" variant="outline">
                <Download className="size-4" />
                下载当前成片
              </Button>
            </a>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Left — Video + Timeline */}
        <div className="space-y-4">
          {/* Video Player */}
          <Card>
            <CardContent className="p-2">
              {currentProject.videoUrl && (
                <video
                  src={currentProject.videoUrl}
                  controls
                  className="w-full rounded-lg"
                  style={{ maxHeight: '400px' }}
                />
              )}
            </CardContent>
          </Card>

          {/* Subtitle Timeline */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">字幕时间轴</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-75">
                <div className="space-y-1">
                  {editingSentences.map((sentence, index) => (
                    <div
                      key={sentence.id}
                      className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                        selectedSentenceIndex === index ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted/50'
                      }`}
                      onClick={() => setSelectedSentenceIndex(index)}
                    >
                      <span className="text-xs text-muted-foreground w-20 shrink-0">
                        {formatMs(sentence.beginTime)}
                        {' '}
                        -
                        {formatMs(sentence.endTime)}
                      </span>
                      <span className="text-sm flex-1 truncate">{sentence.text}</span>
                      {canEditSentences && (
                        <div className="flex gap-1 shrink-0">
                          <button
                            type="button"
                            className="text-xs text-muted-foreground hover:text-primary"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleMerge(index)
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
                              handleSplit(index)
                            }}
                            title="拆分此句"
                          >
                            <Scissors className="size-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {editingSentences.length === 0 && (
                    <div className="text-center py-8 text-sm text-muted-foreground">
                      {currentProject.status === 'asr_processing' ? 'ASR 识别进行中，请稍候...' : '暂无字幕内容'}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Right — Sentence Editor + Style Picker */}
        <div className="space-y-4">
          {/* Sentence Editor */}
          {selectedSentenceIndex !== null && editingSentences[selectedSentenceIndex] && canEditSentences && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  编辑句子 #
                  {selectedSentenceIndex + 1}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  value={editingSentences[selectedSentenceIndex]!.text}
                  onChange={(e) => {
                    const newSentences = [...editingSentences]
                    newSentences[selectedSentenceIndex!] = {
                      ...newSentences[selectedSentenceIndex!]!,
                      text: e.target.value,
                    }
                    setEditingSentences(newSentences)
                  }}
                  rows={3}
                  className="resize-none"
                />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-muted-foreground">开始时间</label>
                    <Input
                      type="number"
                      value={editingSentences[selectedSentenceIndex]!.beginTime}
                      onChange={(e) => {
                        const newSentences = [...editingSentences]
                        newSentences[selectedSentenceIndex!] = {
                          ...newSentences[selectedSentenceIndex!]!,
                          beginTime: Number(e.target.value),
                        }
                        setEditingSentences(newSentences)
                      }}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">结束时间</label>
                    <Input
                      type="number"
                      value={editingSentences[selectedSentenceIndex]!.endTime}
                      onChange={(e) => {
                        const newSentences = [...editingSentences]
                        newSentences[selectedSentenceIndex!] = {
                          ...newSentences[selectedSentenceIndex!]!,
                          endTime: Number(e.target.value),
                        }
                        setEditingSentences(newSentences)
                      }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Style Picker */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">字幕样式</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Preset Selection */}
              <div className="grid grid-cols-3 gap-2">
                {SUBTITLE_STYLE_PRESETS.map(preset => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`p-2 rounded text-xs transition-colors ${
                      selectedPreset === preset.id ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
                    }`}
                    onClick={() => handlePresetChange(preset.id)}
                    disabled={!canEditStyle}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>

              {/* Style Override Controls */}
              {currentStyle && canEditStyle && (
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
                          onChange={e => handleFontSizeChange(Number(e.target.value))}
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
                      onChange={e => handleFontSizeChange(Number(e.target.value))}
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
                          onClick={() => handleFontSizeChange(preset.value)}
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
                        onChange={e => handleStyleOverride('fontColor', e.target.value)}
                        className="size-8 rounded cursor-pointer"
                      />
                      <Input
                        value={currentStyle.fontColor}
                        onChange={e => handleStyleOverride('fontColor', e.target.value)}
                        className="flex-1"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">描边宽度</label>
                    <Input
                      type="number"
                      value={currentStyle.outlineWidth}
                      onChange={e => handleStyleOverride('outlineWidth', Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">位置</label>
                    <select
                      className="w-full rounded-md border p-2 text-sm"
                      value={currentStyle.position}
                      onChange={e => handleStyleOverride('position', e.target.value)}
                    >
                      <option value="top">顶部</option>
                      <option value="center">居中</option>
                      <option value="bottom">底部</option>
                    </select>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Error Display */}
          {currentProject.errorMessage && (
            <Card className="border-destructive">
              <CardContent className="p-3">
                <p className="text-sm text-destructive">{currentProject.errorMessage}</p>
              </CardContent>
            </Card>
          )}

          {/* Exported Video */}
          {isCompleted && currentProject.exportedVideoUrl && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">导出结果</CardTitle>
              </CardHeader>
              <CardContent>
                <video
                  src={currentProject.exportedVideoUrl}
                  controls
                  className="w-full rounded-lg"
                  style={{ maxHeight: '300px' }}
                />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
