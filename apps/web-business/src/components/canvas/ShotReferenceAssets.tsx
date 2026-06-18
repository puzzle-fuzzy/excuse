import type { ApplyReferenceAssetsMode, AssetLibraryItem, CanvasShotReferenceAsset, ProjectDTO, ReferenceAssetApplyTarget } from '@excuse/shared'
import { recommendCanvasVideoVariant } from '@excuse/shared'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useDebounce } from 'use-debounce'
import { statusTextClass } from '@/lib/status-tokens'
import { applyShotReferenceAssets, fetchAssetLibrary } from '../../api/client'
import {
  assetToShotReferenceAsset,
  isReferenceAssetAdded,
  isReferenceAssetCandidate,
  KIND_LABELS,
  MAX_SHOT_REFERENCE_ASSETS,
  mergeShotReferenceAssets,
  previewApplyReferenceAssets,
  SOURCE_LABELS,
} from '../../lib/asset-library'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

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
  /** 项目内全部镜头 — 用于批量应用。可选，缺省时隐藏批量入口 */
  allShots?: ProjectDTO['shots']
  onSave: (assets: CanvasShotReferenceAsset[]) => Promise<void>
  /** 批量应用成功后回调刷新。可选 */
  onUpdate?: () => void
}

/** 最近一次批量应用的本地撤销快照（仅组件生命周期内有效，非持久化） */
interface ApplyUndoSnapshot {
  mode: ApplyReferenceAssetsMode
  affectedShots: Array<{
    shotId: string
    shotIndex: number
    beforeAssets: CanvasShotReferenceAsset[]
  }>
}

/**
 * 镜头额外参考资产管理（P1-2 v0.5）
 *
 * 主路径：从资产库选择图片资产（自动过滤可用候选、推断 role、去重保存）。
 * 批量路径：应用到其他镜头（append/replace，预览 + toast）。
 * 兜底路径：手动输入 URL（高级入口）。
 */
export function ShotReferenceAssets({
  shot,
  projectId,
  allShots = [],
  onSave,
  onUpdate,
}: ShotReferenceAssetsProps) {
  // ── 手动 URL 添加表单状态 ──────────────────────────
  const [addUrl, setAddUrl] = useState('')
  const [addRole, setAddRole] = useState<CanvasShotReferenceAsset['role']>('other')
  const [addLabel, setAddLabel] = useState('')

  // ── 资产库选择器弹窗状态 ──────────────────────────
  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [debouncedSearch] = useDebounce(search.trim(), 300)
  const [onlyCurrentProject, setOnlyCurrentProject] = useState(true)
  const [items, setItems] = useState<AssetLibraryItem[]>([])
  const [loading, setLoading] = useState(false)

  const [saving, setSaving] = useState(false)

  // ── 批量应用弹窗状态 ──────────────────────────
  const [applyOpen, setApplyOpen] = useState(false)
  const [applyMode, setApplyMode] = useState<ApplyReferenceAssetsMode>('append')
  const [selectedShotIds, setSelectedShotIds] = useState<Set<string>>(() => new Set())

  /** 最近一次批量应用撤销快照 — null 表示无可撤销 */
  const [lastApplyUndo, setLastApplyUndo] = useState<ApplyUndoSnapshot | null>(null)

  const atLimit = shot.referenceAssets.length >= MAX_SHOT_REFERENCE_ASSETS

  const recommendation = useMemo(() =>
    recommendCanvasVideoVariant(shot.referenceAssets.filter(a => a.url)), [shot.referenceAssets])

  const VARIANT_LABEL: Record<string, string> = {
    t2v: 'T2V 文生视频',
    i2v: 'I2V 图生视频',
    r2v: 'R2V 参考生视频',
  }

  // 批量应用：其他镜头（排除当前镜头）
  const otherShots = useMemo(() =>
    allShots.filter(s => s.id !== shot.id), [allShots, shot.id])

  // 批量应用预览
  const applyPreview = useMemo(() => {
    if (selectedShotIds.size === 0)
      return []
    const targets: ReferenceAssetApplyTarget[] = otherShots
      .filter(s => selectedShotIds.has(s.id))
      .map(s => ({ shotId: s.id, title: `镜头 ${s.shotIndex}`, referenceAssets: s.referenceAssets }))
    return previewApplyReferenceAssets(targets, shot.referenceAssets, applyMode)
  }, [selectedShotIds, otherShots, shot.referenceAssets, applyMode])

  // role 分布统计
  const roleDistribution = useMemo(() => {
    const dist: Record<string, number> = {}
    for (const a of shot.referenceAssets)
      dist[a.role] = (dist[a.role] ?? 0) + 1
    return dist
  }, [shot.referenceAssets])

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
      const next = mergeShotReferenceAssets(shot.referenceAssets, [
        { assetId: `manual-${Date.now()}`, url, role: addRole, label: addLabel.trim() || undefined, source: 'manual' },
      ], MAX_SHOT_REFERENCE_ASSETS)
      if (next.length === shot.referenceAssets.length) {
        toast.error('该 URL 已在当前镜头中')
        return
      }
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

  // ── 批量应用提交 ──────────────────────────
  const handleApplySubmit = useCallback(async () => {
    if (selectedShotIds.size === 0)
      return
    setSaving(true)
    try {
      const result = await applyShotReferenceAssets(projectId, {
        sourceShotId: shot.id,
        targetShotIds: [...selectedShotIds],
        referenceAssetsJson: shot.referenceAssets,
        mode: applyMode,
      })
      const totalApplied = result.applied.length
      const truncatedShots = result.applied.filter(r => r.truncatedCount > 0)
      if (truncatedShots.length > 0)
        toast.success(`已应用到 ${totalApplied} 个镜头，部分镜头因上限被截断`)
      else
        toast.success(`已应用到 ${totalApplied} 个镜头`)

      // 只对服务端实际应用的镜头保存撤销快照，避免服务端跳过镜头时错误撤销
      const otherShotById = new Map(otherShots.map(s => [s.id, s]))
      const affectedShots = result.applied
        .map((applied) => {
          const originalShot = otherShotById.get(applied.shotId)
          if (!originalShot)
            return null
          return {
            shotId: applied.shotId,
            shotIndex: originalShot.shotIndex,
            beforeAssets: originalShot.referenceAssets,
          }
        })
        .filter((s): s is ApplyUndoSnapshot['affectedShots'][number] => s !== null)
      if (affectedShots.length > 0)
        setLastApplyUndo({ mode: applyMode, affectedShots })

      setApplyOpen(false)
      setSelectedShotIds(new Set())
      onUpdate?.()
    }
    catch {
      toast.error('批量应用参考资产失败')
    }
    finally {
      setSaving(false)
    }
  }, [selectedShotIds, projectId, shot.id, shot.referenceAssets, applyMode, onUpdate, otherShots])

  // ── 撤销最近一次批量应用 ──────────────────────────
  // 复用现有 applyShotReferenceAssets 接口，对每个受影响镜头以 replace 模式回写原始参考资产。
  // 注意：撤销失败时保留 lastApplyUndo，方便用户重试；空数组 beforeAssets 也应正常清空目标镜头。
  const handleUndoApply = useCallback(async () => {
    if (!lastApplyUndo)
      return
    setSaving(true)
    try {
      await Promise.all(lastApplyUndo.affectedShots.map(snapshot =>
        applyShotReferenceAssets(projectId, {
          targetShotIds: [snapshot.shotId],
          referenceAssetsJson: snapshot.beforeAssets,
          mode: 'replace',
        }),
      ))
      setLastApplyUndo(null)
      toast.success('已撤销最近一次批量应用')
      onUpdate?.()
    }
    catch {
      toast.error('撤销失败，可重试')
    }
    finally {
      setSaving(false)
    }
  }, [lastApplyUndo, projectId, onUpdate])

  // 弹窗打开时 / 搜索 / 仅当前项目变化时拉取资产（debounce 由 use-debounce 提供）
  useEffect(() => {
    if (!pickerOpen)
      return
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const data = await fetchAssetLibrary({
          status: 'succeeded',
          search: debouncedSearch || undefined,
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
    })()
    return () => {
      cancelled = true
    }
  }, [pickerOpen, debouncedSearch, onlyCurrentProject, projectId])

  // 前端过滤：只展示可作为参考资产的候选（注意不能只用 kind=image）
  const candidates = items.filter(isReferenceAssetCandidate)

  // 切换镜头多选
  const toggleShotSelection = useCallback((shotId: string) => {
    setSelectedShotIds((prev) => {
      const next = new Set(prev)
      if (next.has(shotId))
        next.delete(shotId)
      else
        next.add(shotId)
      return next
    })
  }, [])

  // 全选/取消全选其他镜头
  const toggleSelectAll = useCallback(() => {
    if (selectedShotIds.size === otherShots.length)
      setSelectedShotIds(new Set())
    else
      setSelectedShotIds(new Set(otherShots.map(s => s.id)))
  }, [selectedShotIds.size, otherShots])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">
          参考资产
          {' '}
          <span className="font-normal">
            (
            {shot.referenceAssets.length}
            /
            {MAX_SHOT_REFERENCE_ASSETS}
            )
          </span>
          {saving && <span className={statusTextClass('warning', 'ml-2')}>保存中...</span>}
        </label>
        {shot.referenceAssets.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-2 text-[10px]"
            disabled={saving || otherShots.length === 0}
            onClick={() => {
              setSelectedShotIds(new Set())
              setApplyMode('append')
              setApplyOpen(true)
            }}
          >
            应用到...
          </Button>
        )}
      </div>

      {/* 最近一次批量应用撤销入口（仅本地生命周期内有效） */}
      {lastApplyUndo && (
        <div className="flex items-center justify-between text-[10px] text-muted-foreground bg-muted/40 rounded p-1.5">
          <span>
            {`最近一次批量应用影响 ${lastApplyUndo.affectedShots.length} 个镜头，可撤销`}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-5 px-2 text-[10px]"
            disabled={saving}
            onClick={handleUndoApply}
          >
            {saving ? '撤销中...' : '撤销上次应用'}
          </Button>
        </div>
      )}

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
                  <Select
                    value={asset.role}
                    onValueChange={v => handleRoleChange(i, v as CanvasShotReferenceAsset['role'])}
                    disabled={saving}
                  >
                    <SelectTrigger size="sm" className="h-6 w-auto gap-1 px-1.5 text-[10px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.map(role => (
                        <SelectItem key={role} value={role}>{ROLE_LABELS[role]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
          <Select
            value={addRole}
            onValueChange={v => setAddRole(v as CanvasShotReferenceAsset['role'])}
          >
            <SelectTrigger size="sm" className="h-8 w-24 gap-1 px-2 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLE_OPTIONS.map(role => (
                <SelectItem key={role} value={role}>{ROLE_LABELS[role]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
              <Checkbox
                checked={onlyCurrentProject}
                onCheckedChange={c => setOnlyCurrentProject(c === true)}
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

      {/* 批量应用弹窗 */}
      <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>应用参考资产</DialogTitle>
          </DialogHeader>

          {/* 资产摘要 */}
          <div className="text-xs bg-muted/40 rounded p-2 space-y-1">
            <p>
              当前镜头有
              {' '}
              <strong>{shot.referenceAssets.length}</strong>
              {' '}
              个参考资产：
            </p>
            <p className="text-muted-foreground">
              {Object.entries(roleDistribution).map(([role, count]) => `${ROLE_LABELS[role as CanvasShotReferenceAsset['role']] ?? role} ${count}`).join('、')}
            </p>
          </div>

          {/* 应用策略 */}
          <div className="flex gap-2">
            <Button
              variant={applyMode === 'append' ? 'default' : 'outline'}
              size="sm"
              className="flex-1 text-xs"
              onClick={() => setApplyMode('append')}
            >
              追加到已有
            </Button>
            <Button
              variant={applyMode === 'replace' ? 'default' : 'outline'}
              size="sm"
              className="flex-1 text-xs"
              onClick={() => setApplyMode('replace')}
            >
              替换目标
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            {applyMode === 'append' ? '追加：保留目标镜头已有参考资产，新增不重复的资产' : '替换：清除目标镜头已有参考资产，替换为当前镜头的参考资产'}
          </p>

          {/* 选择镜头 */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">选择镜头</label>
              <Button variant="ghost" size="sm" className="h-5 px-2 text-[10px]" onClick={toggleSelectAll}>
                {selectedShotIds.size === otherShots.length ? '取消全选' : '全选'}
              </Button>
            </div>
            <div className="max-h-[30vh] overflow-y-auto space-y-1">
              {otherShots.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-3">项目中没有其他镜头</p>
              )}
              {otherShots.map(s => (
                <label key={s.id} className="flex items-center gap-2 p-1.5 text-xs rounded cursor-pointer hover:bg-muted/30">
                  <Checkbox
                    checked={selectedShotIds.has(s.id)}
                    onCheckedChange={() => toggleShotSelection(s.id)}
                  />
                  <span className="font-medium">
                    镜头
                    {s.shotIndex}
                  </span>
                  <span className="text-muted-foreground">
                    (
                    {s.referenceAssets.length}
                    {' '}
                    个参考资产)
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* 预览 */}
          {applyPreview.length > 0 && (
            <div className="text-xs bg-muted/40 rounded p-2 space-y-1">
              <p>
                将影响
                {' '}
                <strong>{applyPreview.length}</strong>
                {' '}
                个镜头
              </p>
              {applyPreview.some(p => p.truncatedCount > 0) && (
                <p className={statusTextClass('warning')}>
                  部分镜头因 8 个参考资产上限被截断
                </p>
              )}
              <div className="mt-1 space-y-0.5">
                {applyPreview.map(p => (
                  <p key={p.shotId} className="text-muted-foreground">
                    {p.shotId === shot.id ? '当前' : otherShots.find(s => s.id === p.shotId)?.shotIndex}
                    ：
                    {p.beforeCount}
                    {' '}
                    →
                    {' '}
                    {p.afterCount}
                    {`，新增 ${p.addedCount}`}
                    {applyMode === 'append' && Math.max(0, shot.referenceAssets.length - p.addedCount - p.truncatedCount) > 0 && (
                      <span>
                        {`，去重 ${Math.max(0, shot.referenceAssets.length - p.addedCount - p.truncatedCount)}`}
                      </span>
                    )}
                    {p.truncatedCount > 0 && `（截断 ${p.truncatedCount}）`}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* 提交按钮 */}
          <Button
            size="sm"
            className="w-full"
            disabled={selectedShotIds.size === 0 || saving}
            onClick={handleApplySubmit}
          >
            {saving ? '应用中...' : `应用到 ${selectedShotIds.size} 个镜头`}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default ShotReferenceAssets
