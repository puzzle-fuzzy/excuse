/**
 * 资产详情弹窗 — 从 Assets.tsx 拆分（原 PreviewModal）
 *
 * 包含：媒体预览、元数据展示、下载/复制链接/跳转 Canvas、编辑（上传文件）、删除/隐藏确认。
 */
import type { AssetLibraryItem, AssetLibraryKind } from '@excuse/shared'
import {
  AudioLines,
  Box,
  Copy,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  ImageIcon,
  MapPin,
  Pencil,
  Trash2,
  Upload,
  User,
  Video,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { hideAsset } from '@/api/asset-library'
import { deleteUploadedFile, updateUploadedFile } from '@/api/client'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { canDeleteAsset, getAssetLibraryPreviewKind, getCanvasAssetUrl, getCanvasSourceLabel, KIND_LABELS, SOURCE_LABELS, STATUS_LABELS } from '@/lib/asset-library'
import { formatCents } from '@/lib/generation-utils'
import { copyToClipboard } from '@/lib/utils'

const KIND_ICON: Partial<Record<AssetLibraryKind, typeof FileText>> = {
  image: ImageIcon,
  video: Video,
  text: FileText,
  subtitle: AudioLines,
  upload: Upload,
  character: User,
  location: MapPin,
  shot: Box,
  project: FolderOpen,
}

interface AssetDetailDialogProps {
  item: AssetLibraryItem
  onClose: () => void
  onAction: () => void
}

export function AssetDetailDialog({ item, onClose, onAction }: AssetDetailDialogProps) {
  const previewKind = getAssetLibraryPreviewKind(item)
  const canvasUrl = getCanvasAssetUrl(item)
  const sourceLabel = getCanvasSourceLabel(item)
  const Icon = KIND_ICON[item.kind] ?? FileText
  const deletable = canDeleteAsset(item)
  const hideable = item.source === 'generation_record' || item.source === 'canvas_asset'
  const editable = item.source === 'uploaded_file'
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editFileName, setEditFileName] = useState(item.title)
  const [editPurpose, setEditPurpose] = useState('')
  const [editLoading, setEditLoading] = useState(false)

  const confirmTitle = deletable ? '确认删除上传文件？' : '确认移出资产中心？'
  const confirmDescription = deletable
    ? '删除后该文件将从资产中心移除，并从存储中删除。已被项目使用的文件不会被删除。'
    : item.source === 'generation_record'
      ? '此操作会将该生成记录从资产中心隐藏，不会删除已保存文件。'
      : '此操作会将该 Canvas 资产从资产中心隐藏，不会影响项目中已使用的镜头或参考图。'
  const confirmText = deletable ? '删除' : '移出'

  async function handleAction() {
    setActionLoading(true)
    try {
      if (deletable) {
        await deleteUploadedFile(item.id)
        toast.success('已删除上传文件')
      }
      else if (hideable) {
        await hideAsset(item.source as 'generation_record' | 'canvas_asset', item.id)
        toast.success('已移出资产中心')
      }
      onAction()
    }
    catch (err) {
      const message = err instanceof Error ? err.message : (deletable ? '删除失败' : '移出失败')
      toast.error(message)
      setConfirmOpen(false)
    }
    finally {
      setActionLoading(false)
    }
  }

  function openEdit() {
    setEditFileName(item.title)
    setEditPurpose('')
    setEditOpen(true)
  }

  async function handleSaveEdit() {
    const trimmedName = editFileName.trim()
    const trimmedPurpose = editPurpose.trim()
    if (!trimmedName) {
      toast.error('文件名不能为空')
      return
    }
    setEditLoading(true)
    try {
      await updateUploadedFile(item.id, {
        fileName: trimmedName,
        purpose: trimmedPurpose || undefined,
      })
      toast.success('已保存修改')
      setEditOpen(false)
      onAction()
    }
    catch (err) {
      const message = err instanceof Error ? err.message : '保存失败'
      toast.error(message)
    }
    finally {
      setEditLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div
        className="relative max-h-[90vh] w-full max-w-2xl space-y-3 overflow-auto rounded-xl bg-background p-4"
        onClick={e => e.stopPropagation()}
      >
        <button
          className="absolute right-2 top-2 z-10 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70"
          onClick={onClose}
          aria-label="关闭"
        >
          <X className="size-4" />
        </button>

        {/* 媒体内容 */}
        {previewKind === 'image' && item.previewUrl && (
          <img src={item.previewUrl} alt="" className="max-h-[60vh] w-full rounded-lg object-contain" />
        )}
        {previewKind === 'video' && item.previewUrl && (
          <video src={item.previewUrl} controls loop className="max-h-[60vh] w-full rounded-lg" />
        )}
        {(previewKind === 'text' || previewKind === 'file' || !item.previewUrl) && (
          <div className="flex h-40 items-center justify-center rounded-lg bg-muted">
            <Icon className="size-12 text-muted-foreground" />
          </div>
        )}

        {/* 信息 */}
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{item.title}</p>
            <Badge variant="secondary" className="text-[10px]">{KIND_LABELS[item.kind]}</Badge>
            <Badge variant="outline" className="text-[10px]">{SOURCE_LABELS[item.source]}</Badge>
            <Badge variant="outline" className="text-[10px]">{STATUS_LABELS[item.status] ?? item.status}</Badge>
          </div>
          {item.model && (
            <p className="text-xs text-muted-foreground">
              模型：
              {item.model}
            </p>
          )}
          {item.prompt && (
            <p className="text-xs text-muted-foreground">
              Prompt：
              {' '}
              {item.prompt.slice(0, 200)}
            </p>
          )}
          {item.costCents != null && (
            <p className="text-xs text-muted-foreground">
              费用：¥
              {formatCents(item.costCents, 4)}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            创建：
            {new Date(item.createdAt).toLocaleString('zh-CN')}
          </p>
        </div>

        {/* 操作 */}
        <div className="flex flex-wrap gap-2">
          {item.downloadUrl && (
            <a href={item.downloadUrl} download target="_blank" rel="noreferrer">
              <Button variant="outline" size="sm">
                <Download className="size-3" />
                下载
              </Button>
            </a>
          )}
          {item.previewUrl && (
            <Button variant="outline" size="sm" onClick={() => copyToClipboard(item.previewUrl!, '已复制链接')}>
              <Copy className="size-3" />
              复制链接
            </Button>
          )}
          {canvasUrl && (
            <Link to={canvasUrl}>
              <Button variant="outline" size="sm">
                <ExternalLink className="size-3" />
                {sourceLabel}
              </Button>
            </Link>
          )}
          {editable && (
            <Button
              variant="outline"
              size="sm"
              disabled={editLoading || actionLoading}
              onClick={openEdit}
            >
              <Pencil className="size-3" />
              编辑
            </Button>
          )}
          {deletable && (
            <Button variant="destructive" size="sm" disabled={actionLoading} onClick={() => setConfirmOpen(true)}>
              <Trash2 className="size-3" />
              删除文件
            </Button>
          )}
          {hideable && (
            <Button variant="outline" size="sm" disabled={actionLoading} onClick={() => setConfirmOpen(true)}>
              <X className="size-3" />
              移出资产中心
            </Button>
          )}
        </div>

        {/* 操作确认弹窗 */}
        {(deletable || hideable) && (
          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
                {confirmDescription && <AlertDialogDescription>{confirmDescription}</AlertDialogDescription>}
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={handleAction}>{confirmText}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {/* 编辑弹窗（仅 uploaded_file） */}
        {editable && (
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>编辑上传文件</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground" htmlFor="edit-file-name">文件名</label>
                  <Input
                    id="edit-file-name"
                    value={editFileName}
                    onChange={e => setEditFileName(e.target.value)}
                    disabled={editLoading}
                    placeholder="文件名"
                    maxLength={500}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground" htmlFor="edit-purpose">用途</label>
                  <Input
                    id="edit-purpose"
                    value={editPurpose}
                    onChange={e => setEditPurpose(e.target.value)}
                    disabled={editLoading}
                    placeholder="如 reference / avatar / first-frame"
                    maxLength={50}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditOpen(false)}
                    disabled={editLoading}
                  >
                    取消
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveEdit}
                    disabled={editLoading || actionLoading}
                  >
                    {editLoading ? '保存中...' : '保存'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </div>
  )
}
