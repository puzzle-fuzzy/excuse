import type { AssetLibraryItem, CanvasShotReferenceAsset, ProjectDTO } from '@excuse/shared'
import { recommendCanvasVideoVariant } from '@excuse/shared'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { fetchAssetLibrary } from '../../api/client'
import {
  assetToShotReferenceAsset,
  isReferenceAssetAdded,
  isReferenceAssetCandidate,
  KIND_LABELS,
  MAX_SHOT_REFERENCE_ASSETS,
  mergeShotReferenceAssets,
  SOURCE_LABELS,
} from '../../lib/asset-library'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'

// ── 参考资产 role 中文标签 ────────────────────────────
const ROLE_LABELS: Record<CanvasShotReferenceAsset['role'], string> = {
  character: '角色图',
  location: '场景图',
  style: '风格图',
  firstFrame: '首帧图',
  other: '其他',
}

const ROLE_OPTIONS: CanvasShotReferenceAsset['role'][] = ['character', 'location', 'style', 'firstFrame', 'other']

interface ShotReferenceAssetsProps {
  shot: ProjectDTO['shots'][number]
  projectId: string
  onSave: (assets: CanvasShotReferenceAsset[]) => Promise<void>
}

/**
 * 镜头额外参考资产管理（P1-2 v0.2）
 *
 * 主路径：从资产库选择图片资产（自动过滤可用候选、推断 role、去重保存）。
 * 兜底路径：手动输入 URL（高级入口）。
 * 已选参考资产支持调整 role，沿用 v0.1 的视频生成链路。
 */
export function ShotReferenceAssets({ shot, projectId, onSave }: ShotReferenceAssetsProps) {
  // ── 手动 URL 添加表单状态 ──────────────────────────
  const [addUrl, setAddUrl] = useState('')
  const [addRole, setAddRole] = useState<CanvasShotReferenceAsset['role']>('other')
  const [addLabel, setAddLabel] = useState('')

  // ── 资产库选择器弹窗状态 ──────────────────────────
  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [onlyCurrentProject, setOnlyCurrentProject] = useState(true)
  const [items, setItems] = useState<AssetLibraryItem[]>([])
  const [loading, setLoading] = useState(false)

  const [saving, setSaving] = useState(false)

  const atLimit = shot.referenceAssets.length >= MAX_SHOT_REFERENCE_ASSETS

  const recommendation = useMemo(() =>
    recommendCanvasVideoVariant(shot.referenceAssets.filter(a => a.url)), [shot.referenceAssets])

  const VARIANT_LABEL: Record<string, string> = {
    t2v: 'T2V 文生视频',
    i2v: 'I2V 图生视频',
    r2v: 'R2V 参考生视频',
  }

  const handleAddManual = useCallback(async () => {
    const url = addUrl.trim()
    if (!url)
      return
    if (atLimit) {
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
  }, [addUrl, addRole, addLabel, atLimit, shot.referenceAssets, onSave])

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

  // ── 第四阶段：调整已有参考资产 role ──────────────
  const handleRoleChange = useCallback(async (index: number, role: CanvasShotReferenceAsset['role']) => {
    setSaving(true)
    try {
      const next = shot.referenceAssets.map((asset, i) => i === index ? { ...asset, role } : asset)
      await onSave(next)
    }
    catch {
      toast.error('更新参考资产失败')
    }
    finally {
      setSaving(false)
    }
  }, [shot.referenceAssets, onSave])

  // ── 第三阶段：从资产库添加 ──────────────────────────
  const handleAddFromLibrary = useCallback(async (item: AssetLibraryItem) => {
    const ref = assetToShotReferenceAsset(item)
    if (!ref)
      return
    if (atLimit) {
      toast.error('最多 8 个参考资产')
      return
    }
    setSaving(true)
    try {
      const next = mergeShotReferenceAssets(shot.referenceAssets, [ref], MAX_SHOT_REFERENCE_ASSETS)
      if (next.length === shot.referenceAssets.length) {
        toast.error('该资产已添加')
        return
      }
      await onSave(next)
    }
    catch {
      toast.error('添加参考资产失败')
    }
    finally {
      setSaving(false)
    }
  }, [atLimit, shot.referenceAssets, onSave])

  // 弹窗打开时 / 搜索 / 仅当前项目变化时拉取资产（300ms debounce）
  useEffect(() => {
    if (!pickerOpen)
      return
    let cancelled = false
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const data = await fetchAssetLibrary({
          status: 'succeeded',
          search: search.trim() || undefined,
          projectId: onlyCurrentProject ? projectId : undefined,
          limit: 80,
        })
        if (!cancelled)
          setItems(data.items)
      }
      catch {
        if (!cancelled)
          toast.error('加载资产失败')
      }
      finally {
        if (!cancelled)
          setLoading(false)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [pickerOpen, search, onlyCurrentProject, projectId])

  // 前端过滤：只展示可作为参考资产的候选（注意不能只用 kind=image）
  const candidates = items.filter(isReferenceAssetCandidate)

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-muted-foreground">
        参考资产
        {saving && <span className="ml-2 text-yellow-600">保存中...</span>}
      </label>

      {/* 已有参考资产列表（每行支持 role 调整） */}
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
                  <select
                    value={asset.role}
                    onChange={e => handleRoleChange(i, e.target.value as CanvasShotReferenceAsset['role'])}
                    disabled={saving}
                    className="rounded border border-input bg-background px-1 py-0.5 text-[10px] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {ROLE_OPTIONS.map(role => (
                      <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                    ))}
                  </select>
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

      {/* 视频生成模式推荐 */}
      <p className="text-[10px] text-muted-foreground">
        当前推荐：
        {VARIANT_LABEL[recommendation.variant]}
        {' '}
        —
        {' '}
        {recommendation.reason}
      </p>

      {/* 从资产库选择（主路径） */}
      <Button
        variant="outline"
        size="sm"
        className="w-full text-xs"
        disabled={atLimit}
        onClick={() => setPickerOpen(true)}
      >
        从资产库选择
      </Button>

      {/* 手动输入 URL（兜底入口） */}
      <div className="space-y-1.5 pt-1 border-t border-border/60">
        <p className="text-[10px] text-muted-foreground">或手动输入 URL（高级）</p>
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
            onClick={handleAddManual}
            disabled={!addUrl.trim() || saving || atLimit}
          >
            添加
          </Button>
        </div>
      </div>

      {/* 资产库选择器弹窗 */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>选择参考资产</DialogTitle>
          </DialogHeader>

          <div className="flex items-center gap-2">
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索资产、Prompt、文件名..."
              className="text-sm"
            />
            <label className="flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground">
              <input
                type="checkbox"
                checked={onlyCurrentProject}
                onChange={e => setOnlyCurrentProject(e.target.checked)}
              />
              仅当前项目
            </label>
          </div>

          <div className="max-h-[60vh] overflow-y-auto space-y-1.5">
            {loading && (
              <p className="text-xs text-muted-foreground text-center py-4">加载中...</p>
            )}

            {!loading && candidates.length === 0 && (
              <div className="text-center py-6 text-xs text-muted-foreground space-y-1">
                <p>没有可用图片资产</p>
                <p>可以先在资产库上传图片，或使用下方手动 URL</p>
              </div>
            )}

            {!loading && candidates.map((item) => {
              const ref = assetToShotReferenceAsset(item)
              const added = isReferenceAssetAdded(shot.referenceAssets, item)
              return (
                <div key={item.id} className="flex items-center gap-2 text-xs bg-muted/40 rounded p-1.5">
                  {item.previewUrl && (
                    <img
                      src={item.previewUrl}
                      alt=""
                      className="w-10 h-10 rounded object-cover bg-muted"
                      loading="lazy"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium">{item.title}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Badge variant="secondary" className="text-[10px]">{KIND_LABELS[item.kind]}</Badge>
                      <Badge variant="outline" className="text-[10px]">{SOURCE_LABELS[item.source]}</Badge>
                      {ref && (
                        <span className="truncate text-muted-foreground">{`→ ${ROLE_LABELS[ref.role]}`}</span>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={added ? 'secondary' : 'default'}
                    disabled={added || saving || atLimit}
                    onClick={() => handleAddFromLibrary(item)}
                  >
                    {added ? '已添加' : '添加'}
                  </Button>
                </div>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default ShotReferenceAssets
