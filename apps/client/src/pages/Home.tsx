import type { ProjectDTO } from '@excuse/shared'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { GenerationRecord } from '@/api/client'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  FileText,
  FolderOpen,
  ImageIcon,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Subtitles,
  Video,
  Wallet,
} from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { Link } from 'react-router'
import { getBillingStatistics } from '@/api/billing'
import { fetchBillingBalance, listCanvasProjects } from '@/api/client'
import { billingQueryKeys } from '@/api/query-client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatCents, formatTime, getAssetUrls, STATUS_CONFIG } from '@/lib/generation-utils'
import { CANVAS_PROJECT_STATUS_TONES, GENERATION_STATUS_TONES, statusBadgeClass, statusDotClass, statusTextClass } from '@/lib/status-tokens'
import { cn } from '@/lib/utils'
import { useGenerationStore } from '@/stores/generation'

const ACTIVE_RECORD_STATUSES = new Set(['pending', 'submitting', 'processing', 'saving_output'])
const ACTIVE_PROJECT_STATUSES = new Set(['analyzed', 'characters_ready', 'locations_ready', 'refs_ready', 'refs_all_ready', 'storyboard_ready', 'continuity_checked', 'prompts_ready', 'generating', 'partial_failed'])

const QUICK_ACTIONS: Array<{
  title: string
  description: string
  to: string
  icon: LucideIcon
  tone: string
  action: string
}> = [
  {
    title: '快速生成',
    description: '输入 prompt，生成文本、图片或视频产物。',
    to: '/create',
    icon: Sparkles,
    tone: 'text-primary bg-primary/10',
    action: '开始创作',
  },
  {
    title: '创建 Canvas 项目',
    description: '把故事拆成角色、场景、分镜和成片任务。',
    to: '/canvas',
    icon: Video,
    tone: 'text-[color:var(--brand-video)] bg-[color:var(--status-accent-bg)]',
    action: '打开 Canvas',
  },
  {
    title: '处理字幕',
    description: '上传视频，转写语音并烧录字幕版本。',
    to: '/subtitle',
    icon: Subtitles,
    tone: 'text-[color:var(--status-info-fg)] bg-[color:var(--status-info-bg)]',
    action: '处理字幕',
  },
]

function isActiveRecord(record: GenerationRecord) {
  return ACTIVE_RECORD_STATUSES.has(record.status)
}

function isActiveProject(project: ProjectDTO) {
  return ACTIVE_PROJECT_STATUSES.has(project.status)
}

function isFailedRecord(record: GenerationRecord) {
  return record.status === 'failed' || record.status === 'cancelled'
}

function getProjectProgress(project: ProjectDTO) {
  const map: Record<ProjectDTO['status'], number> = {
    draft: 5,
    analyzed: 15,
    characters_ready: 25,
    locations_ready: 35,
    refs_ready: 45,
    refs_all_ready: 52,
    storyboard_ready: 62,
    continuity_checked: 70,
    prompts_ready: 78,
    generating: 86,
    partial_failed: 86,
    completed: 100,
    failed: 0,
  }
  return map[project.status] ?? 0
}

function projectStatusLabel(status: ProjectDTO['status']) {
  const labels: Record<ProjectDTO['status'], string> = {
    draft: '草稿',
    analyzed: '故事已分析',
    characters_ready: '角色完成',
    locations_ready: '场景完成',
    refs_ready: '参考图生成中',
    refs_all_ready: '参考图完成',
    storyboard_ready: '分镜完成',
    continuity_checked: '连续性完成',
    prompts_ready: 'Prompt 完成',
    generating: '视频生成中',
    partial_failed: '部分失败',
    completed: '已完成',
    failed: '失败',
  }
  return labels[status] ?? status
}

function MetricTile({ label, value, detail, icon: Icon, loading }: {
  label: string
  value: string
  detail: string
  icon: LucideIcon
  loading?: boolean
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">{label}</span>
        <Icon className="size-4 text-muted-foreground" />
      </div>
      {loading
        ? (
            <div className="mt-3 space-y-2">
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-3 w-28" />
            </div>
          )
        : (
            <>
              <div className="mt-3 text-2xl font-semibold tracking-tight">{value}</div>
              <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
            </>
          )}
    </div>
  )
}

function SectionHeader({ title, description, action }: { title: string, description: string, action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  )
}

function EmptyPanel({ icon: Icon, title, description, action }: {
  icon: LucideIcon
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-dashed bg-card/60 p-6 text-center">
      <Icon className="mx-auto size-8 text-muted-foreground" />
      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

function GenerationStatusBadge({ record }: { record: GenerationRecord }) {
  const config = STATUS_CONFIG[record.status] ?? STATUS_CONFIG.pending
  const tone = GENERATION_STATUS_TONES[record.status] ?? 'neutral'
  const Icon = config.icon
  return (
    <Badge variant="secondary" className={statusBadgeClass(tone)}>
      <Icon className={cn('mr-1 size-3', ACTIVE_RECORD_STATUSES.has(record.status) && 'animate-spin')} />
      {config.label}
    </Badge>
  )
}

function RecoveryQueue({ records }: { records: GenerationRecord[] }) {
  if (records.length === 0) {
    return (
      <EmptyPanel
        icon={CheckCircle2}
        title="没有待处理失败"
        description="失败和取消的任务会出现在这里，方便你直接重试或查看原因。"
      />
    )
  }

  return (
    <div className="space-y-2">
      {records.map(record => (
        <Link
          key={record.id}
          to="/create"
          className="flex items-start gap-3 rounded-xl border bg-card p-3 transition-colors hover:bg-muted/45"
        >
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-[color:var(--status-danger-bg)] text-[color:var(--status-danger-fg)]">
            <AlertTriangle className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{record.model}</span>
              <GenerationStatusBadge record={record} />
            </span>
            <span className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {record.recovery?.suggestion ?? record.errorMessage ?? '打开生成页查看失败原因并重新提交。'}
            </span>
          </span>
          <ArrowRight className="mt-2 size-4 text-muted-foreground" />
        </Link>
      ))}
    </div>
  )
}

function RunningWork({ records, projects }: { records: GenerationRecord[], projects: ProjectDTO[] }) {
  const workItems = [
    ...projects.slice(0, 3).map(project => ({ type: 'project' as const, project })),
    ...records.slice(0, 3).map(record => ({ type: 'record' as const, record })),
  ].slice(0, 5)

  if (workItems.length === 0) {
    return (
      <EmptyPanel
        icon={Clock}
        title="当前没有运行中的任务"
        description="提交生成或启动 Canvas 阶段后，进度、连接状态和下一步动作会集中显示在这里。"
        action={(
          <Button asChild size="sm">
            <Link to="/create">
              <Plus className="size-3.5" />
              创建生成任务
            </Link>
          </Button>
        )}
      />
    )
  }

  return (
    <div className="space-y-3">
      {workItems.map((item) => {
        if (item.type === 'project') {
          const progress = getProjectProgress(item.project)
          return (
            <Link key={`project-${item.project.id}`} to={`/canvas/${item.project.id}`} className="block rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{item.project.title || '未命名 Canvas 项目'}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{projectStatusLabel(item.project.status)}</div>
                </div>
                <Badge variant="secondary" className={statusBadgeClass(CANVAS_PROJECT_STATUS_TONES[item.project.status] ?? 'neutral')}>
                  {progress}
                  %
                </Badge>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
              </div>
            </Link>
          )
        }

        return (
          <Link key={`record-${item.record.id}`} to="/create" className="block rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{item.record.model}</div>
                <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                  {String(item.record.inputParams?.prompt ?? '生成任务正在处理')}
                </div>
              </div>
              <GenerationStatusBadge record={item.record} />
            </div>
          </Link>
        )
      })}
    </div>
  )
}

function RecentAssets({ records }: { records: GenerationRecord[] }) {
  const assetRecords = records
    .filter(record => record.status === 'succeeded' && record.outputResult)
    .slice(0, 6)

  if (assetRecords.length === 0) {
    return (
      <EmptyPanel
        icon={FolderOpen}
        title="资产库等待第一批产物"
        description="完成生成后，图片、视频、文本和字幕会沉淀到这里，方便你追溯和复用。"
        action={(
          <Button asChild variant="outline" size="sm">
            <Link to="/assets">打开资产库</Link>
          </Button>
        )}
      />
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {assetRecords.map((record) => {
        const urls = getAssetUrls(record.outputResult)
        const previewUrl = urls[0]
        const isImage = record.category === 'image' && previewUrl
        const isVideo = record.category === 'video' && previewUrl
        const Icon = record.category === 'video' ? Video : record.category === 'image' ? ImageIcon : FileText

        return (
          <Link key={record.id} to="/assets" className="group overflow-hidden rounded-xl border bg-card transition-colors hover:bg-muted/40">
            <div className="aspect-[16/10] bg-muted">
              {isImage
                ? <img src={previewUrl} alt="" className="size-full object-cover" loading="lazy" />
                : isVideo
                  ? <video src={previewUrl} className="size-full object-cover" muted playsInline />
                  : (
                      <div className="flex size-full items-center justify-center">
                        <Icon className="size-8 text-muted-foreground" />
                      </div>
                    )}
            </div>
            <div className="p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{record.model}</span>
                <span className={statusDotClass('success', 'size-2 rounded-full')} />
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{formatTime(record.createdAt)}</div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}

export default function Home() {
  const records = useGenerationStore(s => s.records)
  const loadingRecords = useGenerationStore(s => s.loadingRecords)
  const fetchRecords = useGenerationStore(s => s.fetchRecords)

  useEffect(() => {
    fetchRecords()
  }, [fetchRecords])

  const { data: balance, isLoading: balanceLoading } = useQuery({
    queryKey: billingQueryKeys.balance,
    queryFn: fetchBillingBalance,
  })

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: billingQueryKeys.statistics,
    queryFn: getBillingStatistics,
  })

  const { data: projectsData, isLoading: projectsLoading, refetch: refetchProjects, isFetching: projectsFetching } = useQuery({
    queryKey: ['canvas', 'projects'],
    queryFn: listCanvasProjects,
  })

  const projects = useMemo(() => projectsData?.items ?? [], [projectsData?.items])
  const activeRecords = useMemo(() => records.filter(isActiveRecord), [records])
  const failedRecords = useMemo(() => records.filter(isFailedRecord).slice(0, 4), [records])
  const activeProjects = useMemo(() => projects.filter(isActiveProject), [projects])
  const recentProjects = useMemo(() => projects.slice(0, 4), [projects])
  const balanceData = balance?.data
  const showLowBalanceNotice = !!balanceData && balanceData.availableCents < 500

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      {showLowBalanceNotice && (
        <section className="rounded-xl border border-[color:var(--status-warning-border)] bg-[color:var(--status-warning-bg)] px-4 py-3 text-[color:var(--status-warning-fg)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div>
                <div className="text-sm font-semibold">余额即将不足</div>
                <p className="mt-1 text-sm leading-5">
                  当前可用余额 ¥
                  {formatCents(balanceData.availableCents)}
                  ，开始长视频或 Canvas 阶段前建议先确认预算。
                </p>
              </div>
            </div>
            <Button asChild variant="outline" size="sm" className="border-current bg-background/70 text-current hover:bg-background">
              <Link to="/billing">查看账单</Link>
            </Button>
          </div>
        </section>
      )}

      <section className="rounded-2xl border bg-card p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border bg-muted/45 px-3 py-1 text-xs text-muted-foreground">
              <span className={statusDotClass(activeRecords.length + activeProjects.length > 0 ? 'success' : 'neutral', 'size-2 rounded-full')} />
              {activeRecords.length + activeProjects.length > 0
                ? `${activeRecords.length + activeProjects.length} 个生产任务正在推进`
                : '生产台已准备好'}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              把创意任务放进一个可追踪的生产系统。
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              从 prompt、故事和素材开始，追踪生成进度、成本和失败恢复，最终把产物沉淀到资产库。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild className="brand-cta">
              <Link to="/create">
                <Sparkles className="size-4" />
                开始生成
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/canvas">
                <Video className="size-4" />
                新建 Canvas
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label="可用余额"
          value={balanceData ? `¥${formatCents(balanceData.availableCents)}` : '待同步'}
          detail={balanceData ? `冻结 ¥${formatCents(balanceData.frozenCents)}` : '余额接口未返回'}
          icon={Wallet}
          loading={balanceLoading}
        />
        <MetricTile
          label="本月消耗"
          value={stats ? `¥${formatCents(stats.monthCents)}` : '待同步'}
          detail={stats ? `今日 ¥${formatCents(stats.todayCents)}` : '成本统计未返回'}
          icon={Play}
          loading={statsLoading}
        />
        <MetricTile
          label="运行中"
          value={`${activeRecords.length + activeProjects.length}`}
          detail={`${activeProjects.length} 个 Canvas，${activeRecords.length} 个生成任务`}
          icon={Loader2}
          loading={loadingRecords || projectsLoading}
        />
        <MetricTile
          label="需要处理"
          value={`${failedRecords.length}`}
          detail="失败、取消和部分失败的任务"
          icon={AlertTriangle}
          loading={loadingRecords}
        />
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        {QUICK_ACTIONS.map((action) => {
          const Icon = action.icon
          return (
            <Link key={action.to} to={action.to} className="group rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40">
              <div className="flex items-start gap-3">
                <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', action.tone)}>
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{action.title}</span>
                  <span className="mt-1 block text-sm leading-5 text-muted-foreground">{action.description}</span>
                  <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">
                    {action.action}
                    <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </span>
              </div>
            </Link>
          )
        })}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <section>
          <SectionHeader
            title="继续推进"
            description="运行中的生成和 Canvas 阶段会集中显示在这里。"
            action={(
              <Button variant="ghost" size="sm" onClick={() => refetchProjects()} disabled={projectsFetching}>
                <RefreshCw className={cn('size-3.5', projectsFetching && 'animate-spin')} />
                刷新
              </Button>
            )}
          />
          <RunningWork records={activeRecords} projects={activeProjects} />
        </section>

        <section>
          <SectionHeader
            title="恢复队列"
            description="失败任务不再只是提示，下一步动作会保留在这里。"
          />
          <RecoveryQueue records={failedRecords} />
        </section>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(360px,0.85fr)_minmax(0,1.15fr)]">
        <section>
          <SectionHeader
            title="最近 Canvas 项目"
            description="从最近的故事项目继续进入导演台。"
            action={(
              <Button asChild variant="ghost" size="sm">
                <Link to="/canvas">查看全部</Link>
              </Button>
            )}
          />
          {recentProjects.length === 0
            ? (
                <EmptyPanel
                  icon={Video}
                  title="还没有 Canvas 项目"
                  description="粘贴故事文本，创建角色、场景、分镜和最终视频流水线。"
                  action={(
                    <Button asChild size="sm">
                      <Link to="/canvas">创建 Canvas 项目</Link>
                    </Button>
                  )}
                />
              )
            : (
                <div className="space-y-2">
                  {recentProjects.map(project => (
                    <Link key={project.id} to={`/canvas/${project.id}`} className="flex items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:bg-muted/40">
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground">
                        <Video className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{project.title || '未命名 Canvas 项目'}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">{formatTime(project.updatedAt)}</span>
                      </span>
                      <Badge variant="secondary" className={statusBadgeClass(CANVAS_PROJECT_STATUS_TONES[project.status] ?? 'neutral')}>
                        {projectStatusLabel(project.status)}
                      </Badge>
                    </Link>
                  ))}
                </div>
              )}
        </section>

        <section>
          <SectionHeader
            title="最近产物"
            description="完成的生成结果会沉淀为可追溯、可复用的资产。"
            action={(
              <Button asChild variant="ghost" size="sm">
                <Link to="/assets">打开资产库</Link>
              </Button>
            )}
          />
          <RecentAssets records={records} />
        </section>
      </div>

      <p className={cn('text-center text-xs', statusTextClass('neutral'))}>
        生产进度、成本和失败恢复会持续保留，方便你随时回到创作现场。
      </p>
    </div>
  )
}
