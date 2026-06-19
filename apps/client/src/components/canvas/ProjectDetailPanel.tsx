/**
 * 项目信息编辑面板 — 从 NodeDetailPanel.tsx 拆分
 *
 * 包含：项目标题、故事文本编辑、保存按钮。
 * 仅对 storyInput / analysis 节点显示。
 */
import type { ProjectDTO } from '@excuse/shared'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { updateCanvasProject } from '../../api/client'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'

interface ProjectDetailPanelProps {
  project: ProjectDTO
  onUpdate: () => void
}

export function ProjectDetailPanel({ project, onUpdate }: ProjectDetailPanelProps) {
  const [editTitle, setEditTitle] = useState(project.title ?? '')
  const [editStoryText, setEditStoryText] = useState(project.storyText)
  const [editSaving, setEditSaving] = useState(false)

  const handleProjectUpdate = useCallback(async () => {
    const patch: { title?: string, storyText?: string } = {}
    const titleChanged = editTitle !== (project.title ?? '')
    const storyTextChanged = editStoryText !== project.storyText
    if (titleChanged)
      patch.title = editTitle
    if (storyTextChanged)
      patch.storyText = editStoryText
    if (!titleChanged && !storyTextChanged)
      return

    setEditSaving(true)
    try {
      await updateCanvasProject(project.id, patch)
      onUpdate()
    }
    catch {
      toast.error('更新项目信息失败')
    }
    finally {
      setEditSaving(false)
    }
  }, [project, editTitle, editStoryText, onUpdate])

  const hasChanges = editTitle !== (project.title ?? '') || editStoryText !== project.storyText
  const storyTextInvalid = editStoryText !== project.storyText && editStoryText.length < 10

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">项目标题</label>
        <Input
          value={editTitle}
          onChange={e => setEditTitle(e.target.value)}
          placeholder="输入项目标题"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          故事文本
          <span className="ml-1 text-muted-foreground/60">
            (
            {editStoryText.length}
            {' '}
            字符)
          </span>
        </label>
        <Textarea
          value={editStoryText}
          onChange={e => setEditStoryText(e.target.value)}
          className="min-h-30 bg-background shadow-sm focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="在此粘贴故事文本..."
          rows={6}
        />
      </div>
      <Button
        size="sm"
        onClick={handleProjectUpdate}
        disabled={editSaving || !hasChanges || storyTextInvalid}
      >
        {editSaving ? '保存中...' : '保存修改'}
      </Button>
    </div>
  )
}
