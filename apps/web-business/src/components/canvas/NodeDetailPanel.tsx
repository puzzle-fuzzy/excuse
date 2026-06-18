/**
 * Canvas 节点详情面板 — 按选中节点类型路由到对应子面板
 *
 * 原 565 行单文件揉合 shot/character/location/project 四面板，
 * 现拆分为 ShotDetailPanel / CharacterDetailPanel / LocationDetailPanel / ProjectDetailPanel。
 * 本文件退化为路由层：查找实体 + 渲染对应子面板 + 共享 confirm 对话框。
 */
import type { ProjectDTO } from '@excuse/shared'
import { useCallback, useState } from 'react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../ui/alert-dialog'
import { CharacterDetailPanel } from './CharacterDetailPanel'
import { LocationDetailPanel } from './LocationDetailPanel'
import { ProjectDetailPanel } from './ProjectDetailPanel'
import { ShotDetailPanel } from './ShotDetailPanel'

interface NodeDetailPanelProps {
  selectedNode: { id: string, type: string }
  project: ProjectDTO
  onUpdate: () => void
}

export default function NodeDetailPanel({ selectedNode, project, onUpdate }: NodeDetailPanelProps) {
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
  const isProjectNode = selectedNode.type === 'storyInput' || selectedNode.type === 'analysis'

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
        <ShotDetailPanel
          shot={shot}
          project={project}
          onUpdate={onUpdate}
          confirm={confirm}
        />
      )}

      {character && (
        <CharacterDetailPanel
          character={character}
          onUpdate={onUpdate}
          confirm={confirm}
        />
      )}

      {location && (
        <LocationDetailPanel
          location={location}
          onUpdate={onUpdate}
          confirm={confirm}
        />
      )}

      {!shot && !character && !location && isProjectNode && (
        <ProjectDetailPanel
          project={project}
          onUpdate={onUpdate}
        />
      )}

      {!shot && !character && !location && !isProjectNode && (
        <p className="text-xs text-muted-foreground">
          选中故事输入、分析、角色、场景或镜头节点可查看和编辑详细信息。
        </p>
      )}

      <AlertDialog open={confirmState.open} onOpenChange={open => !open && setConfirmState(prev => ({ ...prev, open: false }))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmState.title}</AlertDialogTitle>
            {confirmState.description && <AlertDialogDescription>{confirmState.description}</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmState.onConfirm}>确认</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
