/**
 * 场景详情编辑面板 — 从 NodeDetailPanel.tsx 拆分
 *
 * 包含：名称/类型字段、场景 Prompt 展示、参考图上传、
 * 重新生成/删除操作、资产历史。
 */
import type { ProjectDTO } from '@excuse/shared'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { deleteCanvasLocation, regenerateCanvasLocation, updateCanvasLocation, uploadFile } from '../../api/client'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import AssetHistory from './AssetHistory'
import { ReferenceUploadZone } from './ReferenceUploadZone'

interface LocationDetailPanelProps {
  location: ProjectDTO['locations'][number]
  onUpdate: () => void
  confirm: (title: string, description: string, onConfirm: () => void) => void
}

export function LocationDetailPanel({ location, onUpdate, confirm }: LocationDetailPanelProps) {
  const [editLocName, setEditLocName] = useState(location.name ?? '')
  const [editLocType, setEditLocType] = useState<string>(location.type ?? '')

  const handleLocationFieldUpdate = useCallback(async (patch: { name?: string, type?: string }) => {
    try {
      await updateCanvasLocation(location.id, patch)
      onUpdate()
    }
    catch {
      toast.error('更新场景失败')
    }
  }, [location.id, onUpdate])

  const handleLocationUpload = useCallback(async (file: File) => {
    const res = await uploadFile(file)
    await updateCanvasLocation(location.id, { referenceImageUrl: res.data.publicUrl })
    onUpdate()
    return res.data.publicUrl
  }, [location.id, onUpdate])

  return (
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
        label="场景参考图"
        confirmRemove="确认删除场景参考图？"
      />

      <Button
        size="sm"
        onClick={() => { regenerateCanvasLocation(location.id).then(() => { toast.success('正在重新生成场景...'); onUpdate() }) }}
      >
        重新生成
      </Button>

      <AssetHistory targetEntityType="location" targetEntityId={location.id} category="locationRef" onUpdate={onUpdate} />

      <Button
        variant="destructive"
        size="sm"
        onClick={() => { confirm(`确认删除场景「${location.name}」？`, '关联的镜头将移除该场景引用。', () => deleteCanvasLocation(location.id).then(onUpdate)) }}
      >
        删除场景
      </Button>
    </>
  )
}
