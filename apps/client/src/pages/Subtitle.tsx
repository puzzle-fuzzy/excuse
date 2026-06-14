import { FileVideo, Loader2, RefreshCcw, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { uploadFile } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useSubtitleStore } from '@/stores/subtitle'

/** 状态中文标签 */
const STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  extracting_audio: '提取音频中',
  asr_processing: 'ASR 识别中',
  subtitle_editing: '字幕编辑',
  exporting: '导出中',
  completed: '已完成',
  failed: '失败',
}

/** 状态颜色 */
const STATUS_COLORS: Record<string, string> = {
  draft: 'text-muted-foreground',
  extracting_audio: 'text-blue-500',
  asr_processing: 'text-blue-500',
  subtitle_editing: 'text-green-600',
  exporting: 'text-yellow-600',
  completed: 'text-green-600',
  failed: 'text-destructive',
}

export default function Subtitle() {
  const projects = useSubtitleStore(s => s.projects)
  const loadProjects = useSubtitleStore(s => s.loadProjects)
  const createProject = useSubtitleStore(s => s.createProject)
  const deleteProject = useSubtitleStore(s => s.deleteProject)
  const retryProject = useSubtitleStore(s => s.retryProject)

  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean, id: string }>({ open: false, id: '' })

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  async function handleUploadAndCreate() {
    setCreating(true)
    setUploading(true)
    try {
      // 弹出文件选择器
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'video/*'
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (!file) {
          setUploading(false)
          setCreating(false)
          return
        }

        try {
          const uploadResult = await uploadFile(file)
          if (uploadResult.success) {
            await createProject(uploadResult.data.id)
            const newProject = useSubtitleStore.getState().currentProject
            if (newProject) {
              navigate(`/subtitle/${newProject.id}`)
            }
          }
          else {
            toast.error('上传视频失败')
          }
        }
        catch (err) {
          toast.error(err instanceof Error ? err.message : '创建字幕项目失败')
        }
        finally {
          setUploading(false)
          setCreating(false)
        }
      }
      input.click()
    }
    catch {
      setUploading(false)
      setCreating(false)
    }
  }

  async function confirmDelete() {
    await deleteProject(deleteConfirm.id)
    setDeleteConfirm({ open: false, id: '' })
  }

  async function handleRetry(projectId: string) {
    await retryProject(projectId)
    // retry 在同一项目上操作，刷新列表同步状态
    await loadProjects()
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="mx-auto max-w-5xl p-6 space-y-8">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">视频加字幕</h1>
          <p className="text-sm text-muted-foreground mt-1">
            上传视频 → AI 识别对白 → 生成时间轴字幕 → 样式编辑 → 导出带字幕视频
          </p>
        </div>
        <Button onClick={handleUploadAndCreate} disabled={creating || uploading}>
          {uploading
            ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  上传中...
                </>
              )
            : creating
              ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    创建中...
                  </>
                )
              : (
                  <>
                    <Upload className="size-4" />
                    上传视频
                  </>
                )}
        </Button>
      </div>

      {/* 项目列表 */}
      {projects.length === 0 && !creating && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <FileVideo className="mb-4 size-12 text-muted-foreground" />
            <p className="text-lg font-medium text-muted-foreground">还没有加字幕项目</p>
            <p className="text-sm text-muted-foreground mt-1">
              点击上方"上传视频"按钮，开始给视频自动加字幕
            </p>
          </CardContent>
        </Card>
      )}

      {projects.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map(project => (
            <Card
              key={project.id}
              className="cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => navigate(`/subtitle/${project.id}`)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium truncate">
                    {project.videoUrl.split('/').pop() || '字幕项目'}
                  </CardTitle>
                  <span className={`text-xs ${STATUS_COLORS[project.status] || 'text-muted-foreground'}`}>
                    {STATUS_LABELS[project.status] || project.status}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{formatDate(project.createdAt)}</span>
                  {project.videoDurationMs && (
                    <span>
                      {Math.round(project.videoDurationMs / 1000)}
                      秒
                    </span>
                  )}
                </div>
                {project.errorMessage && (
                  <p className="mt-2 text-xs text-destructive truncate">{project.errorMessage}</p>
                )}
                <div className="flex gap-1 mt-2">
                  {project.status === 'failed' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-muted-foreground hover:text-green-600"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRetry(project.id)
                      }}
                    >
                      <RefreshCcw className="size-3" />
                      重试
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-muted-foreground hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteConfirm({ open: true, id: project.id })
                    }}
                  >
                    删除
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteConfirm.open}
        onOpenChange={open => !open && setDeleteConfirm({ open: false, id: '' })}
        title="确定要删除这个字幕项目吗？"
        onConfirm={confirmDelete}
      />
    </div>
  )
}
