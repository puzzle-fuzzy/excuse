import type { AssetLibraryItem, AssetLibraryKind, AssetLibrarySource, AssetLibraryStatusFilter, ProjectDTO } from '@excuse/shared'
import type { AssetLibraryFilters } from '@/lib/asset-library'
import { useQuery } from '@tanstack/react-query'
import {
  AudioLines,
  Box,
  Copy,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  ImageIcon,
  Layers,
  Link2,
  MapPin,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  User,
  Video,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { useDebounce } from 'use-debounce'
import { hideAsset, queryAssetLibrary } from '@/api/asset-library'
import { deleteUploadedFile, listCanvasProjects } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  buildAssetLibraryStats,
  canDeleteAsset,
  createAssetLibraryQueryKey,
  DEFAULT_FILTERS,
  formatProjectOptionLabel,
  getAssetLibraryPreviewKind,
  getCanvasAssetUrl,
  getCanvasSourceLabel,
  KIND_LABELS,
  normalizeAssetLibraryFiltersFromSearchParams,
  SOURCE_LABELS,
  STATUS_LABELS,
} from '@/lib/asset-library'
import { formatCents } from '@/lib/generation-utils'

type SourceFilter = 'all' | AssetLibrarySource
type KindFilter = 'all' | AssetLibraryKind
type StatusFilter = 'all' | AssetLibraryStatusFilter

const KIND_CARDS: Array<{ value: KindFilter, label: string, icon: typeof Layers }> = [
  { value: 'all', label: '全部', icon: Layers },
  { value: 'image', label: '图片', icon: ImageIcon },
  { value: 'video', label: '视频', icon: Video },
  { value: 'character', label: '角色', icon: User },
  { value: 'location', label: '场景', icon: MapPin },
  { value: 'shot', label: '镜头', icon: Box },
  { value: 'text', label: '文本', icon: FileText },
  { value: 'project', label: '项目', icon: FolderOpen },
  { value: 'upload', label: '上传', icon: Upload },
]

const SOURCE_OPTIONS: Array<{ value: SourceFilter, label: string }> = [
  { value: 'all', label: '全部来源' },
  { value: 'generation_record', label: '生成' },
  { value: 'canvas_asset', label: 'Canvas' },
  { value: 'uploaded_file', label: '上传' },
]

const STATUS_OPTIONS: Array<{ value: StatusFilter, label: string }> = [
  { value: 'all', label: '全部状态' },
  { value: 'succeeded', label: '已完成' },
  { value: 'running', label: '运行中' },
  { value: 'failed', label: '失败' },
  { value: 'queued', label: '排队中' },
]

// 预览图标映射（按 kind 选 lucide 图标，避免裸文本时无图标）
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

// ── URL ↔ 状态同步 ──────────────────────────────────────────────────────────

function syncFiltersToUrl(filters: AssetLibraryFilters, projectId: string | null) {
  const url = new URL(window.location.href)
  for (const key of ['source', 'kind', 'status', 'search', 'model', 'createdFrom', 'createdTo', 'project'])
    url.searchParams.delete(key)
  if (filters.source !== 'all')
    url.searchParams.set('source', filters.source)
  if (filters.kind !== 'all')
    url.searchParams.set('kind', filters.kind)
  if (filters.status !== 'all')
    url.searchParams.set('status', filters.status)
  if (filters.search)
    url.searchParams.set('search', filters.search)
  if (filters.model)
    url.searchParams.set('model', filters.model)
  if (filters.createdFrom)
    url.searchParams.set('createdFrom', filters.createdFrom)
  if (filters.createdTo)
    url.searchParams.set('createdTo', filters.createdTo)
  if (projectId)
    url.searchParams.set('project', projectId)
  window.history.replaceState({}, '', url.toString())
}

async function copyLink(url: string) {
  try {
    await navigator.clipboard.writeText(url)
    toast.success('已复制链接')
  }
  catch {
    toast.error('复制链接失败')
  }
}

export default function Assets() {
  const [filters, setFilters] = useState<AssetLibraryFilters>(
    () => normalizeAssetLibraryFiltersFromSearchParams(new URLSearchParams(window.location.search)),
  )
  const [projectId, setProjectId] = useState<string | null>(readProjectIdFromUrl)
  const [previewItem, setPreviewItem] = useState<AssetLibraryItem | null>(null)
  const [projects, setProjects] = useState<ProjectDTO[]>([])

  // Debounce search term to avoid firing API on every keystroke
  const [debouncedSearch] = useDebounce(filters.search, 300)

  // Build debounced filters: swap live search for debounced search
  const debouncedFilters: AssetLibraryFilters = useMemo(
    () => ({ ...filters, search: debouncedSearch }),
    [filters, debouncedSearch],
  )

  // 加载 Canvas 项目列表（用于项目选择器）
  useEffect(() => {
    listCanvasProjects()
      .then(data => setProjects(data.items ?? []))
      .catch(() => {})
  }, [])

  // 筛选变更 → URL 同步（sync live filters, not debounced)
  useEffect(() => {
    syncFiltersToUrl(filters, projectId)
  }, [filters, projectId])

  // 主查询：资产列表（用 React Query 承接 loading/error/data）
  const queryKey = createAssetLibraryQueryKey(debouncedFilters, projectId, 200)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: () => queryAssetLibrary({
      filters: debouncedFilters,
      projectId,
      limit: 200,
      offset: 0,
    }),
  })

  const items = useMemo(() => data?.items ?? [], [data?.items])
  const hasMore = data?.hasMore ?? false

  // 加载更多（轻量分页 Plan A：offset 推进，hasMore 启发式）
  const [extraItems, setExtraItems] = useState<AssetLibraryItem[]>([])
  const loadMore = useCallback(async () => {
    try {
      const more = await queryAssetLibrary({
        filters: debouncedFilters,
        projectId,
        limit: 200,
        offset: items.length + extraItems.length,
      })
      setExtraItems(prev => [...prev, ...more.items])
      if (!more.hasMore)
        toast.info('已加载全部资产')
    }
    catch {
      toast.error('加载更多失败')
    }
  }, [debouncedFilters, projectId, items.length, extraItems.length])

  // 清空 extra items when filters/projectId change
  useEffect(() => {
    setExtraItems([])
  }, [debouncedFilters, projectId])

  const allItems = useMemo(() => [...items, ...extraItems], [items, extraItems])
  const stats = useMemo(() => buildAssetLibraryStats(allItems), [allItems])

  const hasActiveFilters = filters.source !== 'all' || filters.kind !== 'all' || filters.status !== 'all'
    || filters.search || filters.model || filters.createdFrom || filters.createdTo || projectId

  function clearFilters() {
    setFilters(DEFAULT_FILTERS)
    setProjectId(null)
  }

  function updateFilter<K extends keyof AssetLibraryFilters>(key: K, value: AssetLibraryFilters[K]) {
    setFilters(f => ({ ...f, [key]: value }))
  }

  return (
    <div className="mx-auto max-w-7xl p-4 space-y-6">
      {/* 标题 + 项目选择器 */}
      <div className="flex items-center gap-2">
        <FolderOpen className="size-5" />
        <h1 className="text-lg font-semibold">资产库</h1>
        <select
          value={projectId ?? ''}
          onChange={e => setProjectId(e.target.value || null)}
          className="h-7 rounded-md border bg-background px-2 text-xs"
        >
          <option value="">全部项目</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{formatProjectOptionLabel(p)}</option>
          ))}
        </select>
        {projectId && !projects.some(p => p.id === projectId) && (
          <Badge variant="secondary" className="gap-1">
            <Link2 className="size-3" />
            {projectId.slice(0, 8)}
            …
          </Badge>
        )}
      </div>

      {/* 来源 + 状态筛选 */}
      <div className="flex flex-wrap gap-2">
        {/* 搜索框 */}
        <div className="relative flex items-center">
          <Search className="absolute left-2 size-3.5 text-muted-foreground" />
          <input
            type="text"
            value={filters.search}
            onChange={e => updateFilter('search', e.target.value)}
            placeholder="搜索文件名、Prompt、模型、项目内容..."
            className="h-8 w-56 rounded-md border bg-background pl-7 pr-7 text-xs"
          />
          {filters.search && (
            <button
              type="button"
              onClick={() => updateFilter('search', '')}
              className="absolute right-1.5 text-muted-foreground hover:text-foreground"
              aria-label="清空搜索"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
        <span className="mx-1 self-center text-muted-foreground">·</span>
        {SOURCE_OPTIONS.map(({ value, label }) => (
          <Button
            key={value}
            variant={filters.source === value ? 'default' : 'outline'}
            size="sm"
            onClick={() => updateFilter('source', value)}
          >
            {label}
          </Button>
        ))}
        <span className="mx-1 self-center text-muted-foreground">·</span>
        {STATUS_OPTIONS.map(({ value, label }) => (
          <Button
            key={value}
            variant={filters.status === value ? 'default' : 'outline'}
            size="sm"
            onClick={() => updateFilter('status', value)}
          >
            {label}
          </Button>
        ))}
      </div>

      {/* 统计卡片（按 kind，点击切换 kind 筛选） */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-9">
        {KIND_CARDS.map(({ value, label, icon: Icon }) => {
          const count = value === 'all' ? stats.total : (stats.byKind[value] ?? 0)
          return (
            <Card
              key={value}
              className={`cursor-pointer transition-colors ${filters.kind === value ? 'ring-2 ring-primary' : ''}`}
              onClick={() => updateFilter('kind', value)}
            >
              <CardContent className="flex flex-col items-center gap-1 p-3 text-center">
                <Icon className="size-4 text-muted-foreground" />
                <p className="text-xl font-bold">{count}</p>
                <p className="text-[10px] text-muted-foreground">{label}</p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* 模型 + 时间筛选 + 清空 */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-muted-foreground">模型</label>
          <input
            type="text"
            value={filters.model}
            onChange={e => updateFilter('model', e.target.value)}
            placeholder="精确匹配"
            className="h-8 w-32 rounded-md border bg-background px-2 text-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-muted-foreground">开始日期</label>
          <input
            type="date"
            value={filters.createdFrom}
            onChange={e => updateFilter('createdFrom', e.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-muted-foreground">结束日期</label>
          <input
            type="date"
            value={filters.createdTo}
            onChange={e => updateFilter('createdTo', e.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-xs"
          />
        </div>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <RotateCcw className="size-3" />
            清空筛选
          </Button>
        )}
      </div>

      {/* 加载状态 */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <FolderOpen className="mb-2 size-10 animate-pulse" />
          <p>加载中...</p>
        </div>
      )}

      {/* 错误状态 */}
      {error && !isLoading && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <FolderOpen className="mb-2 size-10" />
          <p>加载失败</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RotateCcw className="size-3" />
            重试
          </Button>
        </div>
      )}

      {/* 资产网格（服务端已筛选，直接展示） */}
      {!isLoading && !error && allItems.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <FolderOpen className="mb-2 size-10" />
          <p>暂无资产</p>
        </div>
      )}

      {!isLoading && !error && allItems.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {allItems.map(item => (
            <AssetCard key={`${item.source}-${item.id}`} item={item} onClick={() => setPreviewItem(item)} />
          ))}
        </div>
      )}

      {/* 加载更多（轻量分页 Plan A） */}
      {!isLoading && !error && hasMore && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadMore}>加载更多</Button>
        </div>
      )}

      {/* 预览弹窗 */}
      {previewItem && (
        <PreviewModal
          item={previewItem}
          onClose={() => setPreviewItem(null)}
          onAction={() => {
            setPreviewItem(null)
            refetch()
          }}
        />
      )}
    </div>
  )
}

function AssetCard({ item, onClick }: { item: AssetLibraryItem, onClick: () => void }) {
  const previewKind = getAssetLibraryPreviewKind(item)
  const Icon = KIND_ICON[item.kind] ?? FileText

  return (
    <Card
      className="group cursor-pointer overflow-hidden transition-shadow hover:shadow-md"
      onClick={onClick}
    >
      <div className="relative aspect-video bg-muted">
        {previewKind === 'image' && item.previewUrl && (
          <img src={item.previewUrl} alt="" className="size-full object-cover" loading="lazy" />
        )}
        {previewKind === 'video' && item.previewUrl && (
          <div className="relative size-full">
            <video src={item.previewUrl} className="size-full object-cover" muted />
            <div className="absolute inset-0 flex items-center justify-center bg-black/20">
              <Video className="size-6 text-white" />
            </div>
          </div>
        )}
        {(previewKind === 'text' || previewKind === 'file' || !item.previewUrl) && (
          <div className="flex size-full items-center justify-center">
            <Icon className="size-8 text-muted-foreground" />
          </div>
        )}
        <Badge variant="secondary" className="absolute left-1.5 top-1.5 gap-1 text-[10px]">
          <Icon className="size-3" />
          {KIND_LABELS[item.kind]}
        </Badge>
        <Badge variant="outline" className="absolute right-1.5 top-1.5 bg-background/80 text-[10px]">
          {SOURCE_LABELS[item.source]}
        </Badge>
      </div>
      <CardContent className="p-2">
        <p className="text-xs font-medium truncate">{item.title}</p>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="truncate">{item.model ?? '—'}</span>
          <span>{new Date(item.createdAt).toLocaleDateString('zh-CN')}</span>
        </div>
      </CardContent>
    </Card>
  )
}

function PreviewModal({ item, onClose, onAction }: { item: AssetLibraryItem, onClose: () => void, onAction: () => void }) {
  const previewKind = getAssetLibraryPreviewKind(item)
  const canvasUrl = getCanvasAssetUrl(item)
  const sourceLabel = getCanvasSourceLabel(item)
  const Icon = KIND_ICON[item.kind] ?? FileText
  const deletable = canDeleteAsset(item)
  const hideable = item.source === 'generation_record' || item.source === 'canvas_asset'
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  // 确认弹窗文案
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
            <Button variant="outline" size="sm" onClick={() => copyLink(item.previewUrl!)}>
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
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title={confirmTitle}
            description={confirmDescription}
            confirmText={confirmText}
            onConfirm={handleAction}
          />
        )}
      </div>
    </div>
  )
}

function readProjectIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search)
  const project = params.get('project')
  return project && project.length > 0 ? project : null
}
