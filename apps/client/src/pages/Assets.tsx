import type { AssetLibraryItem, AssetLibraryKind, AssetLibrarySort, AssetLibrarySource, AssetLibraryStatusFilter, AssetTagDTO, ProjectDTO } from '@excuse/shared'
import type { AssetDateRangePreset, AssetLibraryFilters } from '@/lib/asset-library'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AudioLines,
  Box,
  Calendar,
  ChevronDown,
  FileText,
  FolderOpen,
  ImageIcon,
  Layers,
  Link2,
  MapPin,
  RotateCcw,
  Search,
  Star,
  Tag,
  Tags,
  Upload,
  User,
  Video,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useDebounce } from 'use-debounce'
import {
  assignAssetTag,
  listAssetTags,
  queryAssetLibrary,
  toggleAssetFavorite,
  unassignAssetTag,
} from '@/api/asset-library'
import { listCanvasProjects } from '@/api/client'
import { assetQueryKeys } from '@/api/query-client'
import { AssetDetailDialog } from '@/components/assets/AssetDetailDialog'
import { AssetTagManager } from '@/components/assets/AssetTagManager'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  buildAssetLibraryStats,
  createAssetLibraryQueryKey,
  DATE_RANGE_OPTIONS,
  DEFAULT_FILTERS,
  formatProjectOptionLabel,
  getAssetLibraryPreviewKind,
  inferDateRangePreset,
  KIND_LABELS,
  normalizeAssetLibraryFiltersFromSearchParams,
  resolveDateRange,
  SOURCE_LABELS,
} from '@/lib/asset-library'
import { cn } from '@/lib/utils'

/** 首屏直接展示的高频类型 chips（其余收进「类型」下拉） */
const PRIMARY_KINDS: AssetLibraryKind[] = ['image', 'video', 'text', 'upload']
/** 收进下拉的低频类型 */
const SECONDARY_KINDS: AssetLibraryKind[] = ['character', 'location', 'shot', 'project']

type SourceFilter = 'all' | AssetLibrarySource
type KindFilter = 'all' | AssetLibraryKind
type StatusFilter = 'all' | AssetLibraryStatusFilter

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

const SORT_OPTIONS: Array<{ value: AssetLibrarySort, label: string }> = [
  { value: 'created_desc', label: '最新优先' },
  { value: 'created_asc', label: '最早优先' },
  { value: 'title_asc', label: '标题 A→Z' },
  { value: 'title_desc', label: '标题 Z→A' },
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

/** 类型 chip 用到的图标 */
const KIND_CHIP_ICON: Record<AssetLibraryKind, typeof ImageIcon> = {
  image: ImageIcon,
  video: Video,
  text: FileText,
  upload: Upload,
  character: User,
  location: MapPin,
  shot: Box,
  project: FolderOpen,
  subtitle: AudioLines,
  audio: AudioLines,
}

// ── URL ↔ 状态同步 ──────────────────────────────────────────────────────────

function syncFiltersToUrl(filters: AssetLibraryFilters, projectId: string | null) {
  const url = new URL(window.location.href)
  for (const key of ['source', 'kind', 'status', 'search', 'model', 'createdFrom', 'createdTo', 'sort', 'favorite', 'tagIds', 'project'])
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
  if (filters.sort !== 'created_desc')
    url.searchParams.set('sort', filters.sort)
  if (filters.favorite)
    url.searchParams.set('favorite', 'true')
  if (filters.tagIds.length > 0)
    url.searchParams.set('tagIds', filters.tagIds.join(','))
  if (projectId)
    url.searchParams.set('project', projectId)
  window.history.replaceState({}, '', url.toString())
}

export default function Assets() {
  const [filters, setFilters] = useState<AssetLibraryFilters>(
    () => normalizeAssetLibraryFiltersFromSearchParams(new URLSearchParams(window.location.search)),
  )
  const [projectId, setProjectId] = useState<string | null>(readProjectIdFromUrl)
  const [previewItem, setPreviewItem] = useState<AssetLibraryItem | null>(null)
  const [projects, setProjects] = useState<ProjectDTO[]>([])
  const [tagManageOpen, setTagManageOpen] = useState(false)
  const [tagPopoverSourceId, setTagPopoverSourceId] = useState<string | null>(null)
  const queryClient = useQueryClient()

  // 加载当前用户全部标签（用于标签管理 modal + 卡片打标 popover + 筛选区下拉）
  const { data: allTags = [] } = useQuery({
    queryKey: assetQueryKeys.tags,
    queryFn: listAssetTags,
  })
  const tagNameToId = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of allTags)
      m.set(t.name, t.id)
    return m
  }, [allTags])

  // 日期预设派生自 filters.createdFrom/To（URL 还原时也能高亮对应预设）
  const datePreset = useMemo(
    () => inferDateRangePreset(filters.createdFrom, filters.createdTo),
    [filters.createdFrom, filters.createdTo],
  )
  function handleDatePresetChange(preset: AssetDateRangePreset) {
    const range = resolveDateRange(preset)
    setFilters(f => ({ ...f, createdFrom: range.createdFrom, createdTo: range.createdTo }))
  }

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
    || filters.search || filters.model || filters.createdFrom || filters.createdTo || filters.favorite
    || filters.tagIds.length > 0 || projectId

  function clearFilters() {
    setFilters(DEFAULT_FILTERS)
    setProjectId(null)
  }

  function toggleFilterTagId(tagId: string) {
    setFilters(f => ({
      ...f,
      tagIds: f.tagIds.includes(tagId)
        ? f.tagIds.filter(t => t !== tagId)
        : [...f.tagIds, tagId],
    }))
  }

  // 切换资产上的标签（POST assign / DELETE unassign），完成后失效查询
  async function toggleAssetTag(source: AssetLibrarySource, id: string, tagName: string, currentlyAssigned: boolean) {
    const tagId = tagNameToId.get(tagName)
    if (!tagId) {
      toast.error('标签不存在，请刷新')
      return
    }
    try {
      if (currentlyAssigned)
        await unassignAssetTag(source, id, tagId)
      else
        await assignAssetTag(source, id, tagId)
      await queryClient.invalidateQueries({ queryKey: assetQueryKeys.library })
    }
    catch (err) {
      const message = err instanceof Error ? err.message : '打标签失败'
      toast.error(message)
    }
  }

  function updateFilter<K extends keyof AssetLibraryFilters>(key: K, value: AssetLibraryFilters[K]) {
    setFilters(f => ({ ...f, [key]: value }))
  }

  // 切换收藏状态：POST/DELETE 后失效当前 query，让 useQuery 重新拉取以拿到权威 isFavorite
  async function toggleFavorite(source: AssetLibrarySource, id: string, currentFavorite: boolean) {
    const next = !currentFavorite
    // 乐观更新：直接 mutate 当前 query cache 的对应 item.isFavorite
    const optimisticKey = createAssetLibraryQueryKey(debouncedFilters, projectId, 200)
    queryClient.setQueriesData<{ items: AssetLibraryItem[] }>({ queryKey: optimisticKey }, (old) => {
      if (!old)
        return old
      return {
        ...old,
        items: old.items.map(i =>
          i.source === source && i.id === id ? { ...i, isFavorite: next } : i,
        ),
      }
    })
    try {
      await toggleAssetFavorite(source, id, next)
      // 服务端权威刷新（favorite=true 过滤下，取消收藏后该项应消失）
      await queryClient.invalidateQueries({ queryKey: assetQueryKeys.library })
    }
    catch (err) {
      // 回滚：重新拉取覆盖乐观更新
      await queryClient.invalidateQueries({ queryKey: assetQueryKeys.library })
      const message = err instanceof Error ? err.message : '收藏操作失败'
      toast.error(message)
    }
  }

  return (
    <div className="product-page flex flex-col gap-4">
      {/* 顶部工具栏 — 资产计数 + 项目筛选 + 标签管理 */}
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
            <FolderOpen className="size-4.5" />
          </span>
          <span className="text-sm font-medium tabular-nums text-foreground">
            {isLoading ? '同步中…' : `${allItems.length}`}
          </span>
          <span className="text-sm text-muted-foreground">个资产</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={projectId ?? '__all__'}
            onValueChange={v => setProjectId(v === '__all__' ? null : v)}
          >
            <SelectTrigger aria-label="项目筛选" className="h-9 w-[200px] gap-2 text-sm">
              <FolderOpen className="size-3.5 text-muted-foreground" />
              <SelectValue placeholder="全部项目" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部项目</SelectItem>
              {projects.map(p => (
                <SelectItem key={p.id} value={p.id}>{formatProjectOptionLabel(p)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-9" onClick={() => setTagManageOpen(true)}>
            <Tags className="size-3.5" />
            标签管理
          </Button>
        </div>
      </section>

      {projectId && !projects.some(p => p.id === projectId) && (
        <Badge variant="secondary" className="w-fit gap-1">
          <Link2 className="size-3" />
          当前链接项目：
          {projectId.slice(0, 8)}
          …
        </Badge>
      )}

      {/* 类型统计条 — 高频类型 chips（带计数）+ 低频类型下拉 */}
      <section className="flex flex-wrap items-center gap-1.5">
        {/* 全部 */}
        <KindChip
          active={filters.kind === 'all'}
          count={stats.total}
          label="全部"
          onClick={() => updateFilter('kind', 'all')}
        />
        {PRIMARY_KINDS.map(kind => (
          <KindChip
            key={kind}
            kind={kind}
            active={filters.kind === kind}
            count={stats.byKind[kind] ?? 0}
            label={KIND_LABELS[kind]}
            onClick={() => updateFilter('kind', kind)}
          />
        ))}
        {/* 低频类型收纳进下拉 */}
        <Select
          value={SECONDARY_KINDS.includes(filters.kind as AssetLibraryKind) ? filters.kind : '__primary__'}
          onValueChange={v => updateFilter('kind', (v === '__primary__' ? 'all' : v) as KindFilter)}
        >
          <SelectTrigger size="sm" aria-label="更多类型" className="h-8 w-auto gap-1.5 rounded-full px-3 text-xs">
            <ChevronDown className="size-3.5 text-muted-foreground" />
            {SECONDARY_KINDS.includes(filters.kind as AssetLibraryKind)
              ? KIND_LABELS[filters.kind as AssetLibraryKind]
              : '更多类型'}
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__primary__">全部类型</SelectItem>
            {SECONDARY_KINDS.map(kind => (
              <SelectItem key={kind} value={kind}>
                {KIND_LABELS[kind]}
                （
                {stats.byKind[kind] ?? 0}
                ）
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>

      {/* 筛选条 — 搜索 / 来源 / 状态 / 模型 / 日期预设 / 标签 / 排序 / 收藏 */}
      <section className="rounded-xl border bg-card p-3">
        <div className="mb-2.5 flex items-center justify-end gap-2">
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={clearFilters}>
              <RotateCcw className="size-3" />
              清空筛选
            </Button>
          )}
        </div>

        {/* 第一行：搜索 + 下拉维度 */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex min-w-56 flex-1 items-center sm:max-w-xs">
            <Search className="absolute left-2.5 size-3.5 text-muted-foreground" />
            <Input
              value={filters.search}
              onChange={e => updateFilter('search', e.target.value)}
              placeholder="搜索文件名、Prompt、模型..."
              className="h-9 pl-8 pr-8"
            />
            {filters.search && (
              <button
                type="button"
                onClick={() => updateFilter('search', '')}
                className="absolute right-2 text-muted-foreground hover:text-foreground"
                aria-label="清空搜索"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          <FilterSelect
            label="来源"
            value={filters.source}
            options={SOURCE_OPTIONS}
            onChange={v => updateFilter('source', v as SourceFilter)}
          />
          <FilterSelect
            label="状态"
            value={filters.status}
            options={STATUS_OPTIONS}
            onChange={v => updateFilter('status', v as StatusFilter)}
          />
          <Input
            value={filters.model}
            onChange={e => updateFilter('model', e.target.value)}
            placeholder="模型精确匹配"
            className="h-9 w-36 text-xs"
          />

          {/* 日期预设区间 */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  'h-9 gap-1.5 rounded-lg px-3 text-xs',
                  datePreset && datePreset !== 'all' && 'border-primary/50 bg-primary/5',
                )}
                aria-label="创建时间"
              >
                <Calendar className="size-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">时间</span>
                <span className="font-medium">
                  {datePreset ? DATE_RANGE_OPTIONS.find(o => o.value === datePreset)?.label ?? '全部' : '全部'}
                </span>
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-44 p-1" align="start">
              {DATE_RANGE_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => handleDatePresetChange(value)}
                  className={cn(
                    'flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-accent',
                    datePreset === value && 'bg-accent font-medium',
                  )}
                >
                  {label}
                </button>
              ))}
            </PopoverContent>
          </Popover>

          {/* 标签筛选 */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  'h-9 gap-1.5 rounded-lg px-3 text-xs',
                  filters.tagIds.length > 0 && 'border-primary/50 bg-primary/5',
                )}
                aria-label="标签筛选"
              >
                <Tag className="size-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">标签</span>
                <span className="font-medium">{filters.tagIds.length > 0 ? filters.tagIds.length : '全部'}</span>
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-1" align="start">
              {allTags.length === 0
                ? (
                    <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                      还没有标签，前往
                      <button type="button" className="mx-1 underline" onClick={() => setTagManageOpen(true)}>
                        标签管理
                      </button>
                      创建
                    </p>
                  )
                : (
                    <div className="max-h-60 overflow-y-auto">
                      {allTags.map(tag => (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => toggleFilterTagId(tag.id)}
                          className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-accent"
                        >
                          <span className="truncate">{tag.name}</span>
                          {filters.tagIds.includes(tag.id) && <X className="size-3" />}
                        </button>
                      ))}
                    </div>
                  )}
            </PopoverContent>
          </Popover>
        </div>

        {/* 第二行：排序 + 仅看收藏 + 已选标签 chip */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
          <FilterSelect
            label="排序"
            value={filters.sort}
            options={SORT_OPTIONS}
            onChange={v => updateFilter('sort', v as AssetLibrarySort)}
            className="w-36"
          />
          <label className="flex h-9 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm">
            <Switch
              checked={filters.favorite}
              onCheckedChange={c => updateFilter('favorite', c)}
              aria-label="仅看收藏"
            />
            <Star className={cn('size-3.5', filters.favorite && 'fill-[color:var(--status-warning-fg)] text-[color:var(--status-warning-fg)]')} />
            <span className="text-muted-foreground">仅看收藏</span>
          </label>

          {/* 已选标签 chip 行 */}
          {filters.tagIds.length > 0 && (
            <div className="flex flex-1 flex-wrap items-center justify-end gap-1">
              {filters.tagIds.map((tagId) => {
                const tag = allTags.find(t => t.id === tagId)
                if (!tag)
                  return null
                return (
                  <Badge key={tagId} variant="secondary" className="gap-1 text-[10px]">
                    {tag.name}
                    <button
                      type="button"
                      aria-label={`移除标签 ${tag.name}`}
                      onClick={() => toggleFilterTagId(tagId)}
                      className="hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* 加载状态 */}
      {isLoading && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 10 }, (_, index) => (
            <Card key={index} className="overflow-hidden bg-card">
              <div className="aspect-video animate-pulse bg-muted" />
              <CardContent className="space-y-2 p-3">
                <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 错误状态 */}
      {error && !isLoading && (
        <div className="rounded-xl border bg-card p-8 text-center">
          <FolderOpen className="mx-auto mb-2 size-10 text-muted-foreground" />
          <p className="text-sm font-medium">加载失败</p>
          <p className="mt-1 text-sm text-muted-foreground">资产库暂时没有返回数据，请检查网络或稍后重试。</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
            <RotateCcw className="size-3.5" />
            重试
          </Button>
        </div>
      )}

      {/* 资产网格（服务端已筛选，直接展示） */}
      {!isLoading && !error && allItems.length === 0 && (
        <div className="rounded-xl border border-dashed bg-card p-10 text-center">
          <FolderOpen className="mx-auto mb-3 size-10 text-muted-foreground" />
          <p className="text-sm font-semibold">暂无资产</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            {hasActiveFilters ? '当前筛选条件下没有资产，清空筛选后再看看。' : '完成生成、上传文件或推进 Canvas 项目后，资产会自动沉淀到这里。'}
          </p>
          {hasActiveFilters && (
            <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>
              清空筛选
            </Button>
          )}
        </div>
      )}

      {!isLoading && !error && allItems.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {allItems.map(item => (
            <AssetCard
              key={`${item.source}-${item.id}`}
              item={item}
              onClick={() => setPreviewItem(item)}
              onToggleFavorite={toggleFavorite}
              allTags={allTags}
              onToggleTag={toggleAssetTag}
              tagPopoverKey={`${item.source}:${item.id}`}
              tagPopoverOpen={tagPopoverSourceId === `${item.source}:${item.id}`}
              onTagPopoverOpenChange={(open) => {
                setTagPopoverSourceId(open ? `${item.source}:${item.id}` : null)
              }}
            />
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
        <AssetDetailDialog
          item={previewItem}
          onClose={() => setPreviewItem(null)}
          onAction={() => {
            setPreviewItem(null)
            refetch()
          }}
        />
      )}

      {/* 标签管理 modal */}
      <AssetTagManager
        open={tagManageOpen}
        onOpenChange={setTagManageOpen}
        tags={allTags}
      />
    </div>
  )
}

// ── 筛选条辅助组件 ──────────────────────────────────────────────────────────

/** 类型统计 chip — 紧凑的圆角按钮，带图标 + 计数 */
function KindChip({
  kind,
  active,
  count,
  label,
  onClick,
}: {
  kind?: AssetLibraryKind
  active: boolean
  count: number
  label: string
  onClick: () => void
}) {
  const Icon = kind ? KIND_CHIP_ICON[kind] : Layers
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground',
      )}
    >
      <Icon className="size-3.5" />
      {label}
      <span className={cn('tabular-nums', active ? 'text-primary/80' : 'text-muted-foreground/70')}>{count}</span>
    </button>
  )
}

/**
 * 筛选条统一下拉 — 承载来源 / 状态 / 排序等多选项维度。
 *
 * 必须使用 Radix 的 <SelectValue /> 作为 trigger 子元素 —— 它不只是显示文本，
 * 还参与 Radix Select 的选中态映射与 content 定位计算。用裸 span 替代会导致
 * 点击后下拉不展开（item-aligned 定位失效）。
 */
function FilterSelect({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string
  value: string
  options: Array<{ value: string, label: string }>
  onChange: (v: string) => void
  className?: string
}) {
  // Radix SelectValue 显示的是"当前选中 item 的文本"，但筛选条希望同时显示维度名。
  // 解法：把维度名塞进 SelectValue 的 placeholder（仅未选中时显示），选中后只显示值；
  // 维度名改为 trigger 内一个常驻的 muted 前缀 span，但它不参与 Radix 逻辑。
  const current = options.find(o => o.value === value)
  const isActive = current && value !== 'all'
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label={label}
        className={cn(
          'px-3 text-xs',
          isActive && 'border-primary/50 bg-primary/5',
          className,
        )}
      >
        <span className="shrink-0 text-muted-foreground">{label}</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(o => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function AssetCard({
  item,
  onClick,
  onToggleFavorite,
  allTags,
  onToggleTag,
  tagPopoverKey,
  tagPopoverOpen,
  onTagPopoverOpenChange,
}: {
  item: AssetLibraryItem
  onClick: () => void
  onToggleFavorite: (source: AssetLibrarySource, id: string, currentFavorite: boolean) => void
  allTags: AssetTagDTO[]
  onToggleTag: (source: AssetLibrarySource, id: string, tagName: string, currentlyAssigned: boolean) => void
  tagPopoverKey: string
  tagPopoverOpen: boolean
  onTagPopoverOpenChange: (open: boolean) => void
}) {
  const previewKind = getAssetLibraryPreviewKind(item)
  const Icon = KIND_ICON[item.kind] ?? FileText
  const visibleTagNames = item.tagNames.slice(0, 3)
  const overflowCount = Math.max(0, item.tagNames.length - 3)
  const hasMedia = (previewKind === 'image' || previewKind === 'video') && item.previewUrl

  return (
    <Card
      className={cn(
        'group relative cursor-pointer overflow-hidden bg-card py-0 transition-all duration-200',
        'hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5',
      )}
      onClick={onClick}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-muted/50">
        {previewKind === 'image' && item.previewUrl && (
          <img
            src={item.previewUrl}
            alt=""
            className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
        )}
        {previewKind === 'video' && item.previewUrl && (
          <div className="relative size-full">
            <video src={item.previewUrl} className="size-full object-cover transition-transform duration-300 group-hover:scale-105" muted />
            <div className="absolute inset-0 flex items-center justify-center bg-black/15 transition-colors group-hover:bg-black/25">
              <span className="grid size-10 place-items-center rounded-full bg-white/90 text-foreground shadow-lg">
                <Video className="size-4" />
              </span>
            </div>
          </div>
        )}
        {(previewKind === 'text' || previewKind === 'file' || !item.previewUrl) && (
          <div className="flex size-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-muted/40 to-muted/80">
            <span className="grid size-11 place-items-center rounded-2xl bg-background/70 text-muted-foreground shadow-sm">
              <Icon className="size-5" />
            </span>
          </div>
        )}

        {/* 顶部渐变遮罩 + 类型标识 */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-black/45 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
        <Badge
          variant="secondary"
          className={cn(
            'absolute left-2 top-2 gap-1 border-0 text-[10px] backdrop-blur-md',
            hasMedia ? 'bg-black/45 text-white' : 'bg-background/85 text-foreground',
          )}
        >
          <Icon className="size-3" />
          {KIND_LABELS[item.kind]}
        </Badge>

        {/* 悬停浮现的收藏按钮 */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            onToggleFavorite(item.source, item.id, item.isFavorite)
          }}
          aria-label={item.isFavorite ? '取消收藏' : '收藏'}
          aria-pressed={item.isFavorite}
          className={cn(
            'absolute right-2 top-2 grid size-7 place-items-center rounded-full shadow-sm backdrop-blur-md transition-all',
            item.isFavorite
              ? 'bg-white/90 text-[color:var(--status-warning-fg)] opacity-100'
              : 'bg-black/40 text-white opacity-0 hover:bg-black/60 group-hover:opacity-100',
          )}
        >
          <Star className={cn('size-3.5', item.isFavorite && 'fill-[color:var(--status-warning-fg)]')} />
        </button>
        <Popover open={tagPopoverOpen} onOpenChange={onTagPopoverOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              onClick={(e) => {
                // 阻止冒泡到 Card（避免打开 PreviewModal），让 Radix Popover 自己处理 open 状态
                e.stopPropagation()
              }}
              aria-label="加标签"
              data-testid={`asset-tag-trigger-${tagPopoverKey}`}
              className={cn(
                'absolute bottom-2 left-2 grid size-7 place-items-center rounded-full bg-black/40 text-white shadow-sm backdrop-blur-md transition-all hover:bg-black/60',
                tagPopoverOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
              )}
            >
              <Tag className="size-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-48 p-1"
            onClick={e => e.stopPropagation()}
            onOpenAutoFocus={(e) => {
              e.preventDefault()
              return false
            }}
          >
            {allTags.length === 0
              ? (
                  <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                    还没有标签
                  </p>
                )
              : (
                  <div className="max-h-60 overflow-y-auto">
                    {allTags.map((tag) => {
                      const assigned = item.tagNames.includes(tag.name)
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          data-testid={`asset-tag-option-${tagPopoverKey}-${tag.id}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            e.preventDefault()
                            onToggleTag(item.source, item.id, tag.name, assigned)
                          }}
                          className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-accent"
                        >
                          <span className="truncate">{tag.name}</span>
                          {assigned && <span aria-hidden>✓</span>}
                        </button>
                      )
                    })}
                  </div>
                )}
          </PopoverContent>
        </Popover>
      </div>
      <CardContent className="p-3">
        <p className="truncate text-sm font-medium leading-5">{item.title}</p>
        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted/50 px-1.5 py-0.5 font-medium">
            {SOURCE_LABELS[item.source]}
          </span>
          <span className="truncate">{item.model ?? '—'}</span>
          <span className="ml-auto shrink-0 tabular-nums">{new Date(item.createdAt).toLocaleDateString('zh-CN')}</span>
        </div>
        {item.tagNames.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {visibleTagNames.map(name => (
              <Badge key={name} variant="secondary" className="px-1.5 py-0 text-[10px] font-normal">
                {name}
              </Badge>
            ))}
            {overflowCount > 0 && (
              <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
                +
                {overflowCount}
              </Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function readProjectIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search)
  const project = params.get('project')
  return project && project.length > 0 ? project : null
}
