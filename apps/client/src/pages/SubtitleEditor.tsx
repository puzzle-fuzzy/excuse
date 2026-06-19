import { ArrowLeft, Download, Loader2, RefreshCcw, Save, WandSparkles } from 'lucide-react'
import { useNavigate, useParams } from 'react-router'
import SentenceEditor from '@/components/subtitle/SentenceEditor'
import StyleEditor from '@/components/subtitle/StyleEditor'
import SubtitleTimeline from '@/components/subtitle/SubtitleTimeline'
import VideoPlayer from '@/components/subtitle/VideoPlayer'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useSubtitleEditor } from '@/hooks/use-subtitle-editor'
import { SUBTITLE_STATUS_LABELS } from '@/lib/subtitle-constants'

export default function SubtitleEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const {
    currentProject,
    loading,
    exporting,
    saving,
    selectedSentenceIndex,
    setSelectedSentenceIndex,
    editingSentences,
    selectedPreset,
    currentStyle,
    canEdit,
    canEditStyle,
    canExport,
    isCompleted,
    handleSave,
    handleExport,
    handleRetry,
    handleMerge,
    handleSplit,
    handlePresetChange,
    handleStyleOverride,
    handleSentenceChange,
  } = useSubtitleEditor(id)

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
          <span className={`text-sm ${canEditStyle ? 'text-[color:var(--status-success-fg)]' : currentProject.status === 'failed' ? 'text-destructive' : 'text-[color:var(--status-info-fg)]'}`}>
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
