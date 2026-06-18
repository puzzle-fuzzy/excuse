/**
 * 标签管理 modal — 从 Assets.tsx 拆分
 *
 * 列出当前用户全部标签，支持创建 / 删除。
 * 删除使用 AlertDialog 二次确认（删除会级联取消所有打标）。
 */
import type { AssetTagDTO } from '@excuse/shared'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { createAssetTag as createAssetTagApi, deleteAssetTag as deleteAssetTagApi } from '@/api/asset-library'
import { assetQueryKeys } from '@/api/query-client'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

interface AssetTagManagerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tags: AssetTagDTO[]
}

export function AssetTagManager({ open, onOpenChange, tags }: AssetTagManagerProps) {
  const queryClient = useQueryClient()
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AssetTagDTO | null>(null)

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = newName.trim()
    if (!trimmed)
      return
    setCreating(true)
    try {
      await createAssetTagApi(trimmed)
      setNewName('')
      await queryClient.invalidateQueries({ queryKey: assetQueryKeys.tags })
      await queryClient.invalidateQueries({ queryKey: assetQueryKeys.library })
      toast.success('已创建标签')
    }
    catch (err) {
      const message = err instanceof Error ? err.message : '创建失败'
      toast.error(message)
    }
    finally {
      setCreating(false)
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget)
      return
    try {
      await deleteAssetTagApi(deleteTarget.id)
      await queryClient.invalidateQueries({ queryKey: assetQueryKeys.tags })
      await queryClient.invalidateQueries({ queryKey: assetQueryKeys.library })
      toast.success('已删除标签')
      setDeleteTarget(null)
    }
    catch (err) {
      const message = err instanceof Error ? err.message : '删除失败'
      toast.error(message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>标签管理</DialogTitle>
        </DialogHeader>
        <form className="flex gap-2" onSubmit={handleCreate}>
          <Input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="标签名（最多 32 字符）"
            maxLength={32}
            disabled={creating}
            aria-label="新标签名"
          />
          <Button type="submit" size="sm" disabled={creating || !newName.trim()}>
            <Plus className="size-3" />
            创建
          </Button>
        </form>
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {tags.length === 0
            ? (
                <p className="py-8 text-center text-xs text-muted-foreground">
                  还没有标签
                </p>
              )
            : tags.map(tag => (
                <div key={tag.id} className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-accent">
                  <span className="truncate text-sm">{tag.name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`删除标签 ${tag.name}`}
                    onClick={() => setDeleteTarget(tag)}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              ))}
        </div>
      </DialogContent>
      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              删除标签「
              {deleteTarget?.name ?? ''}
              」？
            </AlertDialogTitle>
            <AlertDialogDescription>该标签下的所有打标将一并取消，且无法恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}
