import type { ProjectDTO } from '@excuse/shared'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { createCanvasProject, deleteCanvasProject, listCanvasProjects, updateCanvasModelPreferences } from '../api/client'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../components/ui/alert-dialog'
import { loadCanvasModelDefaults } from '../lib/model-lab-presets'

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

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-200 text-gray-700',
  analyzed: 'bg-blue-100 text-blue-700',
  characters_ready: 'bg-blue-100 text-blue-700',
  locations_ready: 'bg-blue-100 text-blue-700',
  refs_ready: 'bg-indigo-100 text-indigo-700',
  refs_all_ready: 'bg-indigo-100 text-indigo-700',
  storyboard_ready: 'bg-purple-100 text-purple-700',
  continuity_checked: 'bg-purple-100 text-purple-700',
  prompts_ready: 'bg-teal-100 text-teal-700',
  generating: 'bg-yellow-100 text-yellow-700',
  partial_failed: 'bg-orange-100 text-orange-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
}

export default function Canvas() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<ProjectDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [storyText, setStoryText] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean, id: string }>({ open: false, id: '' })

  useEffect(() => {
    loadProjects()
  }, [])

  async function loadProjects() {
    try {
      const res = await listCanvasProjects()
      setProjects(res.items)
    }
    catch {
      toast.error('加载项目列表失败')
    }
    finally {
      setLoading(false)
    }
  }

  async function handleCreate() {
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
        console.warn('Failed to apply Model Lab defaults to new canvas project:', err)
      }

      navigate(`/canvas/${projectId}`)
    }
    catch {
      toast.error('创建项目失败')
    }
    finally {
      setCreating(false)
    }
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setDeleteConfirm({ open: true, id })
  }

  async function confirmDelete() {
    try {
      await deleteCanvasProject(deleteConfirm.id)
      setProjects(prev => prev.filter(p => p.id !== deleteConfirm.id))
    }
    catch {
      toast.error('删除项目失败')
    }
    finally {
      setDeleteConfirm({ open: false, id: '' })
    }
  }

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground">加载中...</div>
  }

  return (
    <div className="mx-auto max-w-5xl p-6 space-y-8">
      {/* 创建区 */}
      <Card>
        <CardHeader>
          <CardTitle>新建创意项目</CardTitle>
          <CardDescription>输入故事文本，自动生成完整的创意流水线</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <input
            type="text"
            placeholder="项目标题（可选）"
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <textarea
            placeholder="在此粘贴故事文本..."
            value={storyText}
            onChange={e => setStoryText(e.target.value)}
            rows={6}
            className="w-full rounded-lg border px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <Button onClick={handleCreate} disabled={creating || !storyText.trim()}>
            {creating ? '创建中...' : '创建并开始分析'}
          </Button>
        </CardContent>
      </Card>

      {/* 项目列表 */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">我的项目</h2>
        {projects.length === 0
          ? (
              <p className="text-sm text-muted-foreground py-8 text-center">暂无项目，请创建一个新项目开始创作</p>
            )
          : (
              <div className="grid gap-3">
                {projects.map(project => (
                  <Card
                    key={project.id}
                    className="cursor-pointer hover:border-primary/50 transition-colors"
                    onClick={() => navigate(`/canvas/${project.id}`)}
                  >
                    <CardContent className="flex items-center justify-between p-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{project.title || '未命名项目'}</span>
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[project.status] || 'bg-gray-200 text-gray-700'}`}>
                            {STATUS_LABELS[project.status] || project.status}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {project.storyText.slice(0, 100)}
                          {project.storyText.length > 100 ? '...' : ''}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          创建于
                          {' '}
                          {new Date(project.createdAt).toLocaleString('zh-CN')}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={e => handleDelete(project.id, e)}
                      >
                        删除
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
      </div>

      <AlertDialog open={deleteConfirm.open} onOpenChange={open => !open && setDeleteConfirm({ open: false, id: '' })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除该项目？</AlertDialogTitle>
            <AlertDialogDescription>删除后项目数据将无法恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>确认</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
