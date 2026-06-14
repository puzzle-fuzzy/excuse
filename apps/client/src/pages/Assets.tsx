import type { AssetLibraryItem, AssetLibraryKind, AssetLibrarySource, AssetLibraryStatusFilter } from '@excuse/shared'
import type { AssetLibraryFilters } from '@/lib/asset-library'
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
  Upload,
  User,
  Video,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { fetchAssetLibrary } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  buildAssetLibraryStats,
  filterAssetLibraryItems,
  getAssetLibraryPreviewKind,
  getCanvasProjectUrl,
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

const KIND_LABELS: Record<AssetLibraryKind, string> = {
  image: '图片',
  video: '视频',
  text: '文本',
  subtitle: '字幕',
  upload: '上传',
  character: '角色',
  location: '场景',
  shot: '镜头',
  project: '项目',
}

const SOURCE_LABELS: Record<AssetLibrarySource, string> = {
  generation_record: '生成',
  canvas_asset: 'Canvas',
  uploaded_file: '上传',
}

const STATUS_LABELS: Record<string, string> = {
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
  running: '运行中',
  queued: '排队中',
  pending: '等待中',
  submitting: '提交中',
  processing: '处理中',
  saving_output: '保存中',
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
  const [items, setItems] = useState<AssetLibraryItem[]>([])
  const [filters, setFilters] = useState<AssetLibraryFilters>({
    source: 'all',
    kind: 'all',
    status: 'all',
  })
  const [projectId, setProjectId] = useState<string | null>(null)
  const [previewItem, setPreviewItem] = useState<AssetLibraryItem | null>(null)

  const loadAssets = useCallback(async () => {
    try {
      const data = await fetchAssetLibrary({ limit: 200, projectId: projectId ?? undefined })
      setItems(data.items)
    }
    catch {
      toast.error('加载资产列表失败')
    }
  }, [projectId])

  useEffect(() => {
    // 支持 ?project=<uuid> 按 Canvas 项目过滤
    const params = new URLSearchParams(window.location.search)
    const project = params.get('project')
    setProjectId(project && project.length > 0 ? project : null)
  }, [])

  useEffect(() => {
    loadAssets()
  }, [loadAssets])

  const stats = useMemo(() => buildAssetLibraryStats(items), [items])
  const filtered = useMemo(() => filterAssetLibraryItems(items, filters), [items, filters])

  return (
    <div className="mx-auto max-w-7xl p-4 space-y-6">
      {/* 标题 */}
      <div className="flex items-center gap-2">
        <FolderOpen className="size-5" />
        <h1 className="text-lg font-semibold">资产库</h1>
        {projectId && (
          <Badge variant="secondary" className="gap-1">
            <Link2 className="size-3" />
            项目:
            {' '}
            {projectId.slice(0, 8)}
            …
            <button
              type="button"
              onClick={() => {
                setProjectId(null)
                const url = new URL(window.location.href)
                url.searchParams.delete('project')
                window.history.replaceState({}, '', url.toString())
              }}
              className="ml-1 hover:text-foreground"
              aria-label="清除项目筛选"
            >
              <X className="size-3" />
            </button>
          </Badge>
        )}
      </div>

      {/* 来源筛选 */}
      <div className="flex flex-wrap gap-2">
        {SOURCE_OPTIONS.map(({ value, label }) => (
          <Button
            key={value}
            variant={filters.source === value ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilters(f => ({ ...f, source: value }))}
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
            onClick={() => setFilters(f => ({ ...f, status: value }))}
          >
            {label}
          </Button>
        ))}
      </div>

      {/* 统计卡片（按 kind，点击切换 kind 筛选） */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-9">
        {KIND_CARDS.map(({ value, label, icon: Icon }) => {
          const count = value === 'all' ? stats.total : stats.byKind[value]
          return (
            <Card
              key={value}
              className={`cursor-pointer transition-colors ${filters.kind === value ? 'ring-2 ring-primary' : ''}`}
              onClick={() => setFilters(f => ({ ...f, kind: value }))}
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

      {/* 资产网格 */}
      {filtered.length === 0
        ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <FolderOpen className="mb-2 size-10" />
              <p>暂无资产</p>
            </div>
          )
        : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {filtered.map(item => (
                <AssetCard key={`${item.source}-${item.id}`} item={item} onClick={() => setPreviewItem(item)} />
              ))}
            </div>
          )}

      {/* 预览弹窗 */}
      {previewItem && (
        <PreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />
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

function PreviewModal({ item, onClose }: { item: AssetLibraryItem, onClose: () => void }) {
  const previewKind = getAssetLibraryPreviewKind(item)
  const canvasUrl = getCanvasProjectUrl(item)
  const Icon = KIND_ICON[item.kind] ?? FileText

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
                打开 Canvas 项目
              </Button>
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
