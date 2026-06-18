/**
 * 角色详情编辑面板 — 从 NodeDetailPanel.tsx 拆分
 *
 * 包含：名称/角色定位/描述字段、身份 Prompt 展示、参考图/转面图上传、
 * 重新生成/删除操作、资产历史。
 */
import type { ProjectDTO } from '@excuse/shared'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { deleteCanvasCharacter, regenerateCanvasCharacter, updateCanvasCharacter, uploadFile } from '../../api/client'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import AssetHistory from './AssetHistory'
import { ReferenceUploadZone } from './ReferenceUploadZone'

interface CharacterDetailPanelProps {
  character: ProjectDTO['characters'][number]
  onUpdate: () => void
  confirm: (title: string, description: string, onConfirm: () => void) => void
}

export function CharacterDetailPanel({ character, onUpdate, confirm }: CharacterDetailPanelProps) {
  const [editCharName, setEditCharName] = useState(character.name ?? '')
  const [editCharRole, setEditCharRole] = useState(character.role ?? '')
  const [editCharDesc, setEditCharDesc] = useState(character.description ?? '')

  const handleCharacterFieldUpdate = useCallback(async (patch: { name?: string, role?: string, description?: string }) => {
    try {
      await updateCanvasCharacter(character.id, patch)
      onUpdate()
    }
    catch {
      toast.error('更新角色失败')
    }
  }, [character.id, onUpdate])

  const handleCharacterUpload = useCallback(async (file: File) => {
    const res = await uploadFile(file)
    await updateCanvasCharacter(character.id, { referenceImageUrl: res.data.publicUrl })
    onUpdate()
    return res.data.publicUrl
  }, [character.id, onUpdate])

  const handleCharacterTurnaroundUpload = useCallback(async (file: File) => {
    const res = await uploadFile(file)
    await updateCanvasCharacter(character.id, { turnaroundSheetUrl: res.data.publicUrl })
    onUpdate()
    return res.data.publicUrl
  }, [character.id, onUpdate])

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">名称</label>
          <Input
            value={editCharName}
            onChange={e => setEditCharName(e.target.value)}
            onBlur={() => handleCharacterFieldUpdate({ name: editCharName })}
            placeholder="角色名称"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">角色定位</label>
          <Input
            value={editCharRole}
            onChange={e => setEditCharRole(e.target.value)}
            onBlur={() => handleCharacterFieldUpdate({ role: editCharRole })}
            placeholder="如：主角、配角"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">描述</label>
        <textarea
          value={editCharDesc}
          onChange={e => setEditCharDesc(e.target.value)}
          onBlur={() => handleCharacterFieldUpdate({ description: editCharDesc })}
          className="flex min-h-16 w-full rounded-lg border border-input bg-background px-3 py-2 text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="角色描述"
          rows={3}
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">身份 Prompt</label>
        <p className="text-xs bg-muted/50 rounded p-2 font-mono whitespace-pre-wrap">
          {character.identityPrompt || '未生成'}
        </p>
      </div>

      <ReferenceUploadZone
        currentUrl={character.referenceImageUrl}
        onUpload={handleCharacterUpload}
        label="角色参考图"
        confirmRemove="确认删除角色参考图？"
      />

      <ReferenceUploadZone
        currentUrl={character.turnaroundSheetUrl}
        onUpload={handleCharacterTurnaroundUpload}
        label="转面图 / 三视图"
        confirmRemove="确认删除转面图？"
      />

      <Button
        size="sm"
        onClick={() => {
          regenerateCanvasCharacter(character.id).then(() => {
            toast.success('正在重新生成角色...')
            onUpdate()
          })
        }}
      >
        重新生成
      </Button>

      <AssetHistory targetEntityType="character" targetEntityId={character.id} category="characterPortrait" onUpdate={onUpdate} />
      <AssetHistory targetEntityType="character" targetEntityId={character.id} category="characterTurnaround" onUpdate={onUpdate} />

      <Button
        variant="destructive"
        size="sm"
        onClick={() => { confirm(`确认删除角色「${character.name}」？`, '关联的镜头将移除该角色引用。', () => deleteCanvasCharacter(character.id).then(onUpdate)) }}
      >
        删除角色
      </Button>
    </>
  )
}
