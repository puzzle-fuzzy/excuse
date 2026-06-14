import type { CanvasShotReferenceAsset, ProjectDTO } from '@excuse/shared'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { deleteCanvasCharacter, deleteCanvasLocation, deleteCanvasShot, regenerateCanvasCharacter, regenerateCanvasLocation, regenerateCanvasShot, retryCanvasShot, updateCanvasCharacter, updateCanvasLocation, updateCanvasProject, updateCanvasShot, uploadFile } from '../../api/client'
import { Button } from '../ui/button'
import { ConfirmDialog } from '../ui/confirm-dialog'
import { Input } from '../ui/input'
import AssetHistory from './AssetHistory'
import { PromptEditor } from './PromptEditor'
import { ReferenceUploadZone } from './ReferenceUploadZone'

interface NodeDetailPanelProps {
  selectedNode: { id: string, type: string }
  project: ProjectDTO
  onUpdate: () => void
}

export default function NodeDetailPanel({ selectedNode, project, onUpdate }: NodeDetailPanelProps) {
  const [saving, setSaving] = useState(false)
  const [confirmState, setConfirmState] = useState<{
    open: boolean
    title: string
    description?: string
    onConfirm: () => void
  }>({ open: false, title: '', onConfirm: () => {} })

  const confirm = useCallback((title: string, description: string, onConfirm: () => void) => {
    setConfirmState({ open: true, title, description, onConfirm })
  }, [])

  // Node IDs in ReactFlow use prefixes: char-xxx, loc-xxx, shot-xxx
  const entityId = selectedNode.id.replace(/^(char-|loc-|shot-)/, '')
  const shot = project.shots.find(s => s.id === entityId)
  const character = project.characters.find(c => c.id === entityId)
  const location = project.locations.find(l => l.id === entityId)

  const handleShotPromptUpdate = useCallback(async (prompt: string) => {
    if (!shot)
      return
    setSaving(true)
    try {
      await updateCanvasShot(shot.id, { videoPrompt: prompt })
      onUpdate()
    }
    catch {
      toast.error('更新镜头 Prompt 失败')
    }
    finally {
      setSaving(false)
    }
  }, [shot, onUpdate])

  const handleCharacterUpload = useCallback(async (file: File) => {
    if (!character)
      return ''
    const res = await uploadFile(file)
    await updateCanvasCharacter(character.id, { referenceImageUrl: res.data.publicUrl })
    onUpdate()
    return res.data.publicUrl
  }, [character, onUpdate])

  const handleLocationUpload = useCallback(async (file: File) => {
    if (!location)
      return ''
    const res = await uploadFile(file)
    await updateCanvasLocation(location.id, { referenceImageUrl: res.data.publicUrl })
    onUpdate()
    return res.data.publicUrl
  }, [location, onUpdate])

  // 角色编辑状态
  const [editCharName, setEditCharName] = useState(character?.name ?? '')
  const [editCharRole, setEditCharRole] = useState(character?.role ?? '')
  const [editCharDesc, setEditCharDesc] = useState(character?.description ?? '')

  const handleCharacterFieldUpdate = useCallback(async (patch: { name?: string, role?: string, description?: string }) => {
    if (!character)
      return
    try {
      await updateCanvasCharacter(character.id, patch)
      onUpdate()
    }
    catch {
      toast.error('更新角色失败')
    }
  }, [character, onUpdate])

  // 场景编辑状态
  const [editLocName, setEditLocName] = useState(location?.name ?? '')
  const [editLocType, setEditLocType] = useState(location?.type ?? '')

  const handleLocationFieldUpdate = useCallback(async (patch: { name?: string, type?: string }) => {
    if (!location)
      return
    try {
      await updateCanvasLocation(location.id, patch)
      onUpdate()
    }
    catch {
      toast.error('更新场景失败')
    }
  }, [location, onUpdate])

  // 镜头编辑状态
  const [editShotNarrative, setEditShotNarrative] = useState(shot?.narrative ?? '')
  const [editShotDuration, setEditShotDuration] = useState(shot?.duration ?? 5)

  const handleShotFieldUpdate = useCallback(async (patch: {
    duration?: number
    locationId?: string | undefined
    characterIdsJson?: string[]
    narrative?: string
  }) => {
    if (!shot)
      return
    try {
      await updateCanvasShot(shot.id, patch)
      onUpdate()
    }
    catch {
      toast.error('更新镜头失败')
    }
  }, [shot, onUpdate])

  const isProjectNode = selectedNode.type === 'storyInput' || selectedNode.type === 'analysis'
  const [editTitle, setEditTitle] = useState(project.title ?? '')
  const [editStoryText, setEditStoryText] = useState(project.storyText)
  const [editSaving, setEditSaving] = useState(false)

  const handleProjectUpdate = useCallback(async () => {
    // Only send fields that actually changed
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

  const nodeTitle = shot
    ? `镜头 ${shot.shotIndex}`
    : character
      ? `角色: ${character.name}`
      : location
        ? `场景: ${location.name}`
        : isProjectNode
          ? '项目信息'
          : selectedNode.type

  return (
    <div className="p-4 space-y-4 text-sm">
      <h3 className="font-semibold text-base">{nodeTitle}</h3>

      {shot && (
        <>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              视频 Prompt
              {saving && <span className="ml-2 text-yellow-600">保存中...</span>}
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
              <label className="text-xs font-medium text-muted-foreground">Negative Prompt</label>
              <p className="text-xs bg-muted/50 rounded p-2 font-mono whitespace-pre-wrap">
                {shot.negativePrompt}
              </p>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">叙事描述</label>
            <textarea
              value={editShotNarrative}
              onChange={e => setEditShotNarrative(e.target.value)}
              onBlur={() => handleShotFieldUpdate({ narrative: editShotNarrative })}
              className="flex min-h-16 w-full rounded-lg border border-input bg-background px-3 py-2 text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
              <select
                value={shot.locationId || ''}
                onChange={e => handleShotFieldUpdate({ locationId: e.target.value || undefined })}
                className="w-full rounded-lg border border-input bg-background px-3 py-1.5 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">无场景</option>
                {project.locations.map(loc => (
                  <option key={loc.id} value={loc.id}>{loc.name}</option>
                ))}
              </select>
            </div>
          )}

          {project.characters.length > 0 && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">出场角色</label>
              <div className="flex flex-wrap gap-1.5">
                {project.characters.map(ch => (
                  <label key={ch.id} className="flex items-center gap-1 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={shot.characterIds.includes(ch.id)}
                      onChange={(e) => {
                        const ids = e.target.checked
                          ? [...shot.characterIds, ch.id]
                          : shot.characterIds.filter((id: string) => id !== ch.id)
                        handleShotFieldUpdate({ characterIdsJson: ids })
                      }}
                      className="rounded border-input"
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
              <video
                src={shot.videoUrl}
                controls
                className="w-full rounded-lg"
              />
            </div>
          )}

          {/* 镜头额外参考资产 */}
          <ShotReferenceAssets
            shot={shot}
            onSave={async (assets) => {
              await updateCanvasShot(shot.id, { referenceAssetsJson: assets })
              onUpdate()
            }}
          />

          {/* 镜头资产历史 — 视频 */}
          <AssetHistory
            targetEntityType="shot"
            targetEntityId={shot.id}
            category="shotVideo"
            onUpdate={onUpdate}
          />

          {shot.status === 'failed' && (
            <Button
              size="sm"
              onClick={() => {
                retryCanvasShot(shot.id).then(onUpdate)
              }}
            >
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
            onClick={() => {
              confirm(`确认删除镜头 ${shot.shotIndex}？`, '此操作不可恢复。', () => deleteCanvasShot(shot.id).then(onUpdate))
            }}
          >
            删除镜头
          </Button>
        </>
      )}

      {character && (
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
            onRemove={async () => {
              await updateCanvasCharacter(character.id, { referenceImageUrl: '' })
              onUpdate()
            }}
            label="角色参考图"
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

          {/* 角色资产历史 — 肖像 + 转面图 */}
          <AssetHistory
            targetEntityType="character"
            targetEntityId={character.id}
            category="characterPortrait"
            onUpdate={onUpdate}
          />
          <AssetHistory
            targetEntityType="character"
            targetEntityId={character.id}
            category="characterTurnaround"
            onUpdate={onUpdate}
          />

          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              confirm(`确认删除角色「${character.name}」？`, '关联的镜头将移除该角色引用。', () => deleteCanvasCharacter(character.id).then(onUpdate))
            }}
          >
            删除角色
          </Button>
        </>
      )}

      {location && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">名称</label>
              <Input
                value={editLocName}
                onChange={e => setEditLocName(e.target.value)}
                onBlur={() => handleLocationFieldUpdate({ name: editLocName })}
                placeholder="场景名称"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">类型</label>
              <Input
                value={editLocType}
                onChange={e => setEditLocType(e.target.value)}
                onBlur={() => handleLocationFieldUpdate({ type: editLocType })}
                placeholder="如：室内、室外"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">场景 Prompt</label>
            <p className="text-xs bg-muted/50 rounded p-2 font-mono whitespace-pre-wrap">
              {location.scenePrompt || '未生成'}
            </p>
          </div>

          <ReferenceUploadZone
            currentUrl={location.referenceImageUrl}
            onUpload={handleLocationUpload}
            onRemove={async () => {
              await updateCanvasLocation(location.id, { referenceImageUrl: '' })
              onUpdate()
            }}
            label="场景参考图"
          />

          <Button
            size="sm"
            onClick={() => {
              regenerateCanvasLocation(location.id).then(() => {
                toast.success('正在重新生成场景...')
                onUpdate()
              })
            }}
          >
            重新生成
          </Button>

          {/* 场景资产历史 — 参考图 */}
          <AssetHistory
            targetEntityType="location"
            targetEntityId={location.id}
            category="locationRef"
            onUpdate={onUpdate}
          />

          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              confirm(`确认删除场景「${location.name}」？`, '关联的镜头将移除该场景引用。', () => deleteCanvasLocation(location.id).then(onUpdate))
            }}
          >
            删除场景
          </Button>
        </>
      )}

      {!shot && !character && !location && isProjectNode && (
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
            <textarea
              value={editStoryText}
              onChange={e => setEditStoryText(e.target.value)}
              className="flex min-h-30 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
      )}

      {!shot && !character && !location && !isProjectNode && (
        <p className="text-xs text-muted-foreground">
          选中故事输入、分析、角色、场景或镜头节点可查看和编辑详细信息。
        </p>
      )}

      <ConfirmDialog
        open={confirmState.open}
        onOpenChange={open => !open && setConfirmState(prev => ({ ...prev, open: false }))}
        title={confirmState.title}
        description={confirmState.description}
        onConfirm={confirmState.onConfirm}
      />
    </div>
  )
}

// ── 参考资产 role 中文标签 ────────────────────────────
const ROLE_LABELS: Record<CanvasShotReferenceAsset['role'], string> = {
  character: '角色图',
  location: '场景图',
  style: '风格图',
  firstFrame: '首帧图',
  other: '其他',
}

const ROLE_OPTIONS: CanvasShotReferenceAsset['role'][] = ['character', 'location', 'style', 'firstFrame', 'other']

/** 镜头额外参考资产管理 — URL 输入 + role 选择 + label */
function ShotReferenceAssets({
  shot,
  onSave,
}: {
  shot: ProjectDTO['shots'][number]
  onSave: (assets: CanvasShotReferenceAsset[]) => Promise<void>
}) {
  const [addUrl, setAddUrl] = useState('')
  const [addRole, setAddRole] = useState<CanvasShotReferenceAsset['role']>('other')
  const [addLabel, setAddLabel] = useState('')
  const [saving, setSaving] = useState(false)

  const handleAdd = useCallback(async () => {
    const url = addUrl.trim()
    if (!url)
      return
    if (shot.referenceAssets.length >= 8) {
      toast.error('最多 8 个参考资产')
      return
    }
    setSaving(true)
    try {
      const next: CanvasShotReferenceAsset[] = [
        ...shot.referenceAssets,
        { assetId: `manual-${Date.now()}`, url, role: addRole, label: addLabel.trim() || undefined, source: 'manual' },
      ]
      await onSave(next)
      setAddUrl('')
      setAddLabel('')
    }
    catch {
      toast.error('添加参考资产失败')
    }
    finally {
      setSaving(false)
    }
  }, [addUrl, addRole, addLabel, shot.referenceAssets, onSave])

  const handleRemove = useCallback(async (index: number) => {
    setSaving(true)
    try {
      const next = shot.referenceAssets.filter((_, i) => i !== index)
      await onSave(next)
    }
    catch {
      toast.error('删除参考资产失败')
    }
    finally {
      setSaving(false)
    }
  }, [shot.referenceAssets, onSave])

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-muted-foreground">
        参考资产
        {saving && <span className="ml-2 text-yellow-600">保存中...</span>}
      </label>

      {/* 已有参考资产列表 */}
      {shot.referenceAssets.length > 0 && (
        <div className="space-y-1.5">
          {shot.referenceAssets.map((asset, i) => (
            <div key={asset.assetId} className="flex items-center gap-2 text-xs bg-muted/50 rounded p-1.5">
              {asset.url && (
                <img
                  src={asset.url}
                  alt={asset.label || ROLE_LABELS[asset.role]}
                  className="w-8 h-8 rounded object-cover bg-muted"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <span className="inline-flex items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    {ROLE_LABELS[asset.role]}
                  </span>
                  {asset.label && (
                    <span className="truncate">{asset.label}</span>
                  )}
                </div>
                <p className="truncate text-muted-foreground mt-0.5">{asset.url}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1 text-muted-foreground hover:text-destructive"
                onClick={() => handleRemove(i)}
              >
                ✕
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* 添加新参考资产 */}
      <div className="flex flex-col gap-1.5">
        <div className="flex gap-1.5">
          <select
            value={addRole}
            onChange={e => setAddRole(e.target.value as CanvasShotReferenceAsset['role'])}
            className="w-20 rounded-lg border border-input bg-background px-2 py-1.5 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {ROLE_OPTIONS.map(role => (
              <option key={role} value={role}>{ROLE_LABELS[role]}</option>
            ))}
          </select>
          <Input
            value={addUrl}
            onChange={e => setAddUrl(e.target.value)}
            placeholder="输入参考图 URL"
            className="text-xs"
          />
        </div>
        <div className="flex gap-1.5">
          <Input
            value={addLabel}
            onChange={e => setAddLabel(e.target.value)}
            placeholder="标签（可选）"
            className="text-xs"
          />
          <Button
            size="sm"
            onClick={handleAdd}
            disabled={!addUrl.trim() || saving || shot.referenceAssets.length >= 8}
          >
            添加
          </Button>
        </div>
      </div>
    </div>
  )
}
