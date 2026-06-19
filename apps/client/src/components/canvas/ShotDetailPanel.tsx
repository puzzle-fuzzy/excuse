/**
 * 镜头详情编辑面板 — 从 NodeDetailPanel.tsx 拆分
 *
 * 包含：视频 Prompt 编辑器、叙事描述、时长、场景选择、角色勾选、
 * 视频预览、参考资产、资产历史、重新生成/变体/删除操作。
 */
import type { ProjectDTO } from '@excuse/shared'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { statusTextClass } from '@/lib/status-tokens'
import { deleteCanvasShot, regenerateCanvasShot, retryCanvasShot, updateCanvasShot } from '../../api/client'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Textarea } from '../ui/textarea'
import AssetHistory from './AssetHistory'
import { PromptEditor } from './PromptEditor'
import { ShotReferenceAssets } from './ShotReferenceAssets'

interface ShotDetailPanelProps {
  shot: ProjectDTO['shots'][number]
  project: ProjectDTO
  onUpdate: () => void
  confirm: (title: string, description: string, onConfirm: () => void) => void
}

export function ShotDetailPanel({ shot, project, onUpdate, confirm }: ShotDetailPanelProps) {
  const [saving, setSaving] = useState(false)
  const [editShotNarrative, setEditShotNarrative] = useState(shot.narrative ?? '')
  const [editShotDuration, setEditShotDuration] = useState(shot.duration ?? 5)

  const handleShotPromptUpdate = useCallback(async (prompt: string) => {
    setSaving(true)
    try {
      await updateCanvasShot(shot.id, { videoPrompt: prompt })
      onUpdate()
    }
    catch {
      toast.error('更新镜头提示词失败')
    }
    finally {
      setSaving(false)
    }
  }, [shot.id, onUpdate])

  const handleShotFieldUpdate = useCallback(async (patch: {
    duration?: number
    locationId?: string | undefined
    characterIdsJson?: string[]
    narrative?: string
  }) => {
    try {
      await updateCanvasShot(shot.id, patch)
      onUpdate()
    }
    catch {
      toast.error('更新镜头失败')
    }
  }, [shot.id, onUpdate])

  return (
    <>
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">
          视频提示词
          {saving && <span className={statusTextClass('warning', 'ml-2')}>保存中...</span>}
        </label>
        <PromptEditor
          value={shot.videoPrompt || ''}
          onChange={handleShotPromptUpdate}
          characters={project.characters}
          locations={project.locations}
          shots={project.shots}
          placeholder="输入视频提示词，@ 插入角色/场景/镜头引用..."
          rows={6}
        />
      </div>

      {shot.negativePrompt && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">负面提示词</label>
          <p className="text-xs bg-muted/50 rounded p-2 font-mono whitespace-pre-wrap">
            {shot.negativePrompt}
          </p>
        </div>
      )}

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">叙事描述</label>
        <Textarea
          value={editShotNarrative}
          onChange={e => setEditShotNarrative(e.target.value)}
          onBlur={() => handleShotFieldUpdate({ narrative: editShotNarrative })}
          className="min-h-16 bg-background text-xs shadow-sm focus-visible:ring-2 focus-visible:ring-ring"
          rows={3}
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">时长（秒）</label>
        <Input
          type="number"
          value={editShotDuration}
          onChange={e => setEditShotDuration(Number(e.target.value))}
          onBlur={() => editShotDuration > 0 && handleShotFieldUpdate({ duration: editShotDuration })}
          min={1}
          max={30}
        />
      </div>

      {project.locations.length > 0 && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">场景</label>
          <Select
            value={shot.locationId || '__none__'}
            onValueChange={v => handleShotFieldUpdate({ locationId: v === '__none__' ? undefined : v })}
          >
            <SelectTrigger size="sm" className="h-7 w-full gap-1 px-2 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">无场景</SelectItem>
              {project.locations.map(loc => (
                <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {project.characters.length > 0 && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">出场角色</label>
          <div className="flex flex-wrap gap-1.5">
            {project.characters.map(ch => (
              <label key={ch.id} className="flex cursor-pointer items-center gap-1 text-xs">
                <Checkbox
                  checked={shot.characterIds.includes(ch.id)}
                  onCheckedChange={(checked) => {
                    const ids = checked === true
                      ? [...shot.characterIds, ch.id]
                      : shot.characterIds.filter((id: string) => id !== ch.id)
                    handleShotFieldUpdate({ characterIdsJson: ids })
                  }}
                />
                {ch.name}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="text-xs">
        <span className="text-muted-foreground">状态:</span>
        {' '}
        {shot.status}
      </div>

      {shot.videoUrl && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">视频预览</label>
          <video src={shot.videoUrl} controls className="w-full rounded-lg" />
        </div>
      )}

      <ShotReferenceAssets
        shot={shot}
        projectId={project.id}
        allShots={project.shots}
        onSave={async (assets) => {
          await updateCanvasShot(shot.id, { referenceAssetsJson: assets })
          onUpdate()
        }}
        onUpdate={onUpdate}
      />

      <AssetHistory
        targetEntityType="shot"
        targetEntityId={shot.id}
        category="shotVideo"
        onUpdate={onUpdate}
      />

      {shot.status === 'failed' && (
        <Button size="sm" onClick={() => { retryCanvasShot(shot.id).then(onUpdate) }}>
          重试镜头
        </Button>
      )}

      <Button
        size="sm"
        onClick={() => {
          regenerateCanvasShot(shot.id).then(() => {
            toast.success('正在创建镜头变体...')
            onUpdate()
          })
        }}
      >
        重新生成变体
      </Button>

      <Button
        variant="destructive"
        size="sm"
        onClick={() => { confirm(`确认删除镜头 ${shot.shotIndex}？`, '此操作不可恢复。', () => deleteCanvasShot(shot.id).then(onUpdate)) }}
      >
        删除镜头
      </Button>
    </>
  )
}
