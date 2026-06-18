import type { SubtitleSentence, SubtitleStyleConfig } from '@excuse/shared'
import { SUBTITLE_STYLE_PRESETS } from '@excuse/subtitle-engine'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useSubtitleStore } from '@/stores/subtitle'

export function useSubtitleEditor(projectId: string | undefined) {
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
    if (projectId)
      selectProject(projectId)
  }, [projectId, selectProject])

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
  const isBusy = currentProject ? ['draft', 'extracting_audio', 'asr_processing', 'exporting'].includes(currentProject.status) : true
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

  return {
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
  }
}
