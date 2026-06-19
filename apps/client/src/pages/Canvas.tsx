import type { CanvasProjectStatus, ProjectDTO } from '@excuse/shared'
import {
  AlertTriangle,
  CheckCircle2,
  Clapperboard,
  Clock3,
  FileText,
  Film,
  FolderKanban,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { createCanvasProject, deleteCanvasProject, listCanvasProjects, updateCanvasModelPreferences } from '../api/client'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../components/ui/alert-dialog'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Skeleton } from '../components/ui/skeleton'
import { Textarea } from '../components/ui/textarea'
import { clientLogger } from '../lib/client-logger'
import { clearDraft, guardBeforeUnload, loadDraft, saveDraft } from '../lib/draft-storage'
import { loadCanvasModelDefaults } from '../lib/model-lab-presets'
import { CANVAS_PROJECT_STATUS_TONES, statusBadgeClass, statusDotClass, statusTextClass } from '../lib/status-tokens'
import { cn, handleApiError } from '../lib/utils'

const STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  analyzed: '已分析',
  characters_ready: '角色就绪',
  locations_ready: '场景就绪',
  refs_ready: '角色参考图就绪',
  refs_all_ready: '参考图就绪',
  storyboard_ready: '分镜就绪',
  continuity_checked: '连续性已检查',
  prompts_ready: 'Prompt 就绪',
  generating: '生成中',
  partial_failed: '部分失败',
  completed: '已完成',
  failed: '失败',
}

const PROJECT_FILTERS = [
  { key: 'all', label: '全部项目' },
  { key: 'active', label: '进行中' },
  { key: 'recovery', label: '需处理' },
  { key: 'completed', label: '已完成' },
] as const

type ProjectFilter = typeof PROJECT_FILTERS[number]['key']

function isActiveProject(status: CanvasProjectStatus) {
  return !['draft', 'completed', 'failed'].includes(status)
}

function projectProgress(status: CanvasProjectStatus) {
  const map: Record<CanvasProjectStatus, number> = {
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
  return map[status] ?? 0
}

function projectNextStep(status: CanvasProjectStatus) {
  const map: Record<CanvasProjectStatus, string> = {
    draft: '进入项目后开始故事分析。',
    analyzed: '下一步生成角色档案。',
    characters_ready: '下一步生成场景档案。',
    locations_ready: '下一步生成角色与场景参考图。',
    refs_ready: '继续补全全部参考图。',
    refs_all_ready: '下一步生成分镜。',
    storyboard_ready: '下一步检查连续性。',
    continuity_checked: '下一步重建视频 Prompt。',
    prompts_ready: '下一步生成镜头视频。',
    generating: '视频任务运行中，可进入项目查看进度。',
    partial_failed: '部分任务失败，进入项目处理失败项。',
    completed: '项目已完成，可查看或导出成片。',
    failed: '项目失败，进入项目查看原因并恢复。',
  }
  return map[status] ?? '进入项目继续处理。'
}

export default function Canvas() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<ProjectDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [storyText, setStoryText] = useState(() => loadDraft('canvas_story'))
  const [filter, setFilter] = useState<ProjectFilter>('all')
  const [search, setSearch] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean, id: string }>({ open: false, id: '' })

  // 草稿持久化 + beforeunload 拦截
  const storyDirtyRef = useRef(storyText.trim().length > 0)
  useEffect(() => {
    saveDraft('canvas_story', storyText)
    storyDirtyRef.current = storyText.trim().length > 0
  }, [storyText])

  useEffect(() => {
    return guardBeforeUnload(() => storyDirtyRef.current)
  }, [])

  useEffect(() => {
    async function loadCanvasProjects() {
      try {
        const res = await listCanvasProjects()
        setProjects(res.items)
      }
      catch (err) {
        handleApiError(err, '加载项目列表失败')
      }
      finally {
        setLoading(false)
      }
    }
    loadCanvasProjects()
  }, [])

  async function createProjectFromStory() {
    if (!storyText.trim())
      return
    setCreating(true)
    try {
      const res = await createCanvasProject({
        title: title.trim() || undefined,
        storyText: storyText.trim(),
      })
      const projectId = res.data.id

      // 应用 Model Lab 保存的默认模型偏好（best-effort，失败不阻塞创建流程）
      try {
        const saved = loadCanvasModelDefaults()
        if (saved?.preferences) {
          const p = saved.preferences
          const patch: { textModel?: string, imageModel?: string, videoModel?: string, autoProgress?: boolean } = {}
          if (p.textModel)
            patch.textModel = p.textModel
          if (p.imageModel)
            patch.imageModel = p.imageModel
          if (p.videoModel)
            patch.videoModel = p.videoModel
          if (p.autoProgress !== undefined)
            patch.autoProgress = p.autoProgress
          if (Object.keys(patch).length > 0)
            await updateCanvasModelPreferences(projectId, patch)
        }
      }
      catch (err) {
        clientLogger.warn(`Failed to apply Model Lab defaults to new canvas project: ${String(err)}`, { route: 'Canvas', action: 'createProject' })
      }

      navigate(`/canvas/${projectId}`)
      clearDraft('canvas_story')
      toast.success('项目已创建')
    }
    catch (err) {
      handleApiError(err, '创建项目失败')
    }
    finally {
      setCreating(false)
    }
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setDeleteConfirm({ open: true, id })
  }

  async function confirmProjectDeletion() {
    try {
      await deleteCanvasProject(deleteConfirm.id)
      setProjects(prev => prev.filter(p => p.id !== deleteConfirm.id))
    }
    catch (err) {
      handleApiError(err, '删除项目失败')
    }
    finally {
      setDeleteConfirm({ open: false, id: '' })
    }
  }

  const projectStats = useMemo(() => {
    const active = projects.filter(project => isActiveProject(project.status)).length
    const completed = projects.filter(project => project.status === 'completed').length
    const recovery = projects.filter(project => project.status === 'failed' || project.status === 'partial_failed').length
    return { active, completed, recovery, total: projects.length }
  }, [projects])

  const filteredProjects = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return projects.filter((project) => {
      const matchesFilter = filter === 'all'
        || (filter === 'active' && isActiveProject(project.status))
        || (filter === 'recovery' && (project.status === 'failed' || project.status === 'partial_failed'))
        || (filter === 'completed' && project.status === 'completed')
      if (!matchesFilter)
        return false
      if (!keyword)
        return true
      return `${project.title ?? ''} ${project.storyText}`.toLowerCase().includes(keyword)
    })
  }, [filter, projects, search])

  if (loading) {
    return (
      <div className="mx-auto flex max-w-[1440px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <Skeleton className="h-44 w-full rounded-2xl" />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.92fr)_minmax(420px,1fr)]">
          <Skeleton className="h-96 rounded-xl" />
          <div className="space-y-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <section className="rounded-2xl border bg-card p-5 sm:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
              <span className={statusDotClass(projectStats.active > 0 ? 'info' : 'neutral', 'size-2 rounded-full')} />
              {projectStats.active > 0 ? `${projectStats.active} 个 Canvas 项目正在推进` : '导演台已准备好'}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Canvas 导演台</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              把故事文本推进成可检查的生产流水线：角色、场景、分镜、视频和最终成片都能被追踪和恢复。
            </p>
          </div>

          <div className="grid grid-cols-4 gap-2 rounded-xl border bg-muted/30 p-2 text-center">
            <div className="min-w-20 px-3 py-2">
              <div className="text-lg font-semibold">{projectStats.total}</div>
              <div className="text-[11px] text-muted-foreground">项目</div>
            </div>
            <div className="min-w-20 border-l px-3 py-2">
              <div className="text-lg font-semibold">{projectStats.active}</div>
              <div className="text-[11px] text-muted-foreground">进行中</div>
            </div>
            <div className="min-w-20 border-l px-3 py-2">
              <div className={cn('text-lg font-semibold', projectStats.recovery > 0 && statusTextClass('warning'))}>{projectStats.recovery}</div>
              <div className="text-[11px] text-muted-foreground">需处理</div>
            </div>
            <div className="min-w-20 border-l px-3 py-2">
              <div className="text-lg font-semibold">{projectStats.completed}</div>
              <div className="text-[11px] text-muted-foreground">完成</div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.88fr)_minmax(460px,1fr)]">
        <section className="rounded-xl border bg-card">
          <div className="border-b p-4">
            <div className="flex items-center gap-2">
              <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
                <Clapperboard className="size-4" />
              </span>
              <div>
                <h2 className="text-base font-semibold tracking-tight">新建 Canvas 项目</h2>
                <p className="mt-1 text-sm text-muted-foreground">输入故事或创意梗概，先创建项目，再进入导演台推进阶段。</p>
              </div>
            </div>
          </div>

          <div className="space-y-4 p-4 sm:p-5">
            <div className="rounded-xl border bg-background p-4">
              <label htmlFor="canvas-title" className="mb-1 block text-xs font-medium text-muted-foreground">项目标题</label>
              <Input
                id="canvas-title"
                placeholder="例如：雨夜便利店短片"
                value={title}
                onChange={e => setTitle(e.target.value)}
              />
            </div>

            <div className="rounded-xl border bg-background p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <label htmlFor="canvas-story" className="block text-sm font-semibold">故事文本</label>
                  <p className="mt-1 text-xs text-muted-foreground">可以是完整故事、剧情梗概或镜头方向，后续阶段会逐步补全。</p>
                </div>
                <Badge variant="outline">
                  {storyText.trim().length}
                  {' '}
                  字符
                </Badge>
              </div>
              <Textarea
                id="canvas-story"
                placeholder="在此粘贴故事文本..."
                value={storyText}
                onChange={e => setStoryText(e.target.value)}
                rows={10}
                className="min-h-56 resize-y"
              />
            </div>

            <div className="rounded-xl border bg-muted/30 p-4">
              <div className="flex items-start gap-3">
                <span className="grid size-9 place-items-center rounded-lg bg-background text-primary">
                  <Sparkles className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">模型默认配置会自动应用</div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    如果你在 Model Lab 保存过文本、图像或视频默认模型，新项目创建后会自动带入。失败不会阻塞项目创建。
                  </p>
                </div>
              </div>
            </div>

            <Button className="brand-cta w-full" size="lg" onClick={createProjectFromStory} disabled={creating || !storyText.trim()}>
              {creating
                ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      创建项目中
                    </>
                  )
                : (
                    <>
                      <Plus className="size-4" />
                      创建并开始分析
                    </>
                  )}
            </Button>
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-xl border bg-card">
            <div className="border-b p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-base font-semibold tracking-tight">项目库</h2>
                  <p className="mt-1 text-sm text-muted-foreground">继续推进、恢复失败项或查看已完成项目。</p>
                </div>
                <div className="relative w-full lg:w-72">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                    placeholder="搜索项目或故事"
                    className="pl-9"
                  />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {PROJECT_FILTERS.map(item => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setFilter(item.key)}
                    className={cn(
                      'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                      filter === item.key
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3 p-4">
              {projects.length === 0
                ? (
                    <div className="rounded-xl border border-dashed bg-background p-8 text-center">
                      <FolderKanban className="mx-auto size-9 text-muted-foreground" />
                      <h3 className="mt-3 text-sm font-semibold">还没有 Canvas 项目</h3>
                      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                        在左侧粘贴故事，创建第一个可追踪的创意流水线。
                      </p>
                    </div>
                  )
                : filteredProjects.length === 0
                  ? (
                      <div className="rounded-xl border border-dashed bg-background p-8 text-center">
                        <Search className="mx-auto size-9 text-muted-foreground" />
                        <h3 className="mt-3 text-sm font-semibold">没有匹配的项目</h3>
                        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">调整筛选或搜索关键词后再试。</p>
                      </div>
                    )
                  : filteredProjects.map((project) => {
                      const progress = projectProgress(project.status)
                      const tone = CANVAS_PROJECT_STATUS_TONES[project.status] ?? 'neutral'
                      return (
                        <article
                          key={project.id}
                          className="group rounded-xl border bg-background p-4 transition-colors hover:bg-muted/35"
                        >
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <button
                              type="button"
                              className="min-w-0 flex-1 text-left"
                              onClick={() => navigate(`/canvas/${project.id}`)}
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="truncate text-sm font-semibold">{project.title || '未命名 Canvas 项目'}</span>
                                <span className={statusBadgeClass(tone)}>
                                  {STATUS_LABELS[project.status] || project.status}
                                </span>
                              </div>
                              <p className="mt-2 line-clamp-2 text-sm leading-5 text-muted-foreground">
                                {project.storyText}
                              </p>
                              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                                <span className="inline-flex items-center gap-1">
                                  <Clock3 className="size-3.5" />
                                  更新于
                                  {' '}
                                  {new Date(project.updatedAt).toLocaleString('zh-CN')}
                                </span>
                                <span className="inline-flex items-center gap-1">
                                  <Film className="size-3.5" />
                                  {project.shots.length}
                                  {' '}
                                  镜头
                                </span>
                                <span className="inline-flex items-center gap-1">
                                  <FileText className="size-3.5" />
                                  {project.characters.length}
                                  {' '}
                                  角色
                                </span>
                              </div>
                            </button>

                            <div className="flex shrink-0 items-center gap-2">
                              {(project.status === 'failed' || project.status === 'partial_failed') && (
                                <span className={cn('inline-flex items-center gap-1 text-xs font-medium', statusTextClass('warning'))}>
                                  <AlertTriangle className="size-3.5" />
                                  需恢复
                                </span>
                              )}
                              {project.status === 'completed' && (
                                <span className={cn('inline-flex items-center gap-1 text-xs font-medium', statusTextClass('success'))}>
                                  <CheckCircle2 className="size-3.5" />
                                  可导出
                                </span>
                              )}
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={event => handleDelete(project.id, event)}
                                aria-label="删除项目"
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => navigate(`/canvas/${project.id}`)}
                            className="mt-4 w-full text-left"
                          >
                            <div className="flex items-center justify-between gap-3 text-xs">
                              <span className="text-muted-foreground">{projectNextStep(project.status)}</span>
                              <span className="font-medium text-foreground">
                                {progress}
                                %
                              </span>
                            </div>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                            </div>
                          </button>
                        </article>
                      )
                    })}
            </div>
          </div>
        </section>
      </div>

      <AlertDialog open={deleteConfirm.open} onOpenChange={open => !open && setDeleteConfirm({ open: false, id: '' })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除该项目？</AlertDialogTitle>
            <AlertDialogDescription>删除后项目数据将无法恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmProjectDeletion}>确认</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
