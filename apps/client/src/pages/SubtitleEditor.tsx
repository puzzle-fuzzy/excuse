import type { SubtitleSentence, SubtitleStyleConfig } from '@excuse/shared'
import { SUBTITLE_STYLE_PRESETS } from '@excuse/subtitle-engine'
import { ArrowLeft, Download, Loader2, RefreshCcw, Save, WandSparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import SentenceEditor from '@/components/subtitle/SentenceEditor'
import StyleEditor from '@/components/subtitle/StyleEditor'
import SubtitleTimeline from '@/components/subtitle/SubtitleTimeline'
import VideoPlayer from '@/components/subtitle/VideoPlayer'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SUBTITLE_STATUS_LABELS } from '@/lib/subtitle-constants'
import { useSubtitleStore } from '@/stores/subtitle'

const BUSY_STATUSES = ['draft', 'extracting_audio', 'asr_processing', 'exporting'] as const

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
  const [sentencesLoaded, setSentencesLoaded] = useState(false)

  useEffect(() => {
    if (id)
      selectProject(id)
  }, [id, selectProject])

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

  useEffect(() => {
    if (currentProject?.styleConfig) {
      setStyleDraft(currentProject.styleConfig)
      setSelectedPreset(currentProject.styleConfig.templateId)
    }
  }, [currentProject?.styleConfig])

  const hasSentences = Boolean(currentProject?.sentences?.length)
  const isBusy = currentProject ? BUSY_STATUSES.includes(currentProject.status as typeof BUSY_STATUSES[number]) : true
  const canEdit = currentProject?.status === 'subtitle_editing'
  const canEditStyle = hasSentences && !isBusy
  const canExport = hasSentences && !isBusy
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
      if (canEditStyle && styleDraft)
        await updateStyle(styleDraft)
      await exportProject()
    }
    catch {
      // error handled in store
    }
  }

  async function handleRetry() {
    try {
      await retryProject(currentProject!.id)
      await selectProject(currentProject!.id)
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
    if (preset)
      setStyleDraft(preset.config)
  }

  function handleStyleOverride(key: keyof SubtitleStyleConfig, value: unknown) {
    const current = styleDraft ?? currentProject?.styleConfig
    if (!current)
      return
    setStyleDraft({ ...current, [key]: value } as SubtitleStyleConfig)
  }

  function handleSentenceChange(index: number, updated: SubtitleSentence) {
    const newSentences = [...editingSentences]
    newSentences[index] = updated
    setEditingSentences(newSentences)
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
            {SUBTITLE_STATUS_LABELS[currentProject.status] || currentProject.status}
          </span>
          {currentProject.status === 'failed' && (
            <Button onClick={handleRetry} disabled={loading} size="sm" variant="outline">
              {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
              重试
            </Button>
          )}
          {canEdit && (
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
          <VideoPlayer videoUrl={currentProject.videoUrl} />
          <SubtitleTimeline
            sentences={editingSentences}
            selectedIndex={selectedSentenceIndex}
            canEdit={canEdit}
            status={currentProject.status}
            onSelect={setSelectedSentenceIndex}
            onMerge={handleMerge}
            onSplit={handleSplit}
          />
        </div>

        {/* Right — Sentence Editor + Style Picker */}
        <div className="space-y-4">
          {selectedSentenceIndex !== null && editingSentences[selectedSentenceIndex] && canEdit && (
            <SentenceEditor
              sentence={editingSentences[selectedSentenceIndex]!}
              index={selectedSentenceIndex}
              onChange={handleSentenceChange}
            />
          )}
          <StyleEditor
            currentStyle={currentStyle}
            selectedPreset={selectedPreset}
            canEdit={canEditStyle}
            onPresetChange={handlePresetChange}
            onStyleOverride={handleStyleOverride}
          />
          {currentProject.errorMessage && (
            <Card className="border-destructive">
              <CardContent className="p-3">
                <p className="text-sm text-destructive">{currentProject.errorMessage}</p>
              </CardContent>
            </Card>
          )}
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
