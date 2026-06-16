import type { ModelParameter } from '@/api/client'
import type { Category } from '@/lib/generation-utils'
import {
  FileText,
  Loader2,
  Sparkles,
  Upload,
  Video,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import RecordCard from '@/components/generation/RecordCard'
import MediaPreviewDialog from '@/components/MediaPreviewDialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { CATEGORY_CONFIG } from '@/lib/generation-utils'
import { useGenerationStore } from '@/stores/generation'
import { checkCanGenerate, useWorkspaceStore } from '@/stores/workspace'

export default function Workspace() {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [expandedPrompts, setExpandedPrompts] = useState<Set<string>>(() => new Set())
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean, id: string }>({ open: false, id: '' })

  // Workspace store — form state, models, submission logic
  const selectedCategory = useWorkspaceStore(s => s.selectedCategory)
  const selectedModelId = useWorkspaceStore(s => s.selectedModelId)
  const parameters = useWorkspaceStore(s => s.parameters)
  const loading = useWorkspaceStore(s => s.loading)
  const uploadingRefs = useWorkspaceStore(s => s.uploadingRefs)
  const referenceFiles = useWorkspaceStore(s => s.referenceFiles)
  const mediaUploadState = useWorkspaceStore(s => s.mediaUploadState)
  const models = useWorkspaceStore(s => s.models)

  const setCategory = useWorkspaceStore(s => s.setCategory)
  const setModelId = useWorkspaceStore(s => s.setModelId)
  const setParameter = useWorkspaceStore(s => s.setParameter)
  const loadModels = useWorkspaceStore(s => s.loadModels)
  const submit = useWorkspaceStore(s => s.submit)
  const regenerate = useWorkspaceStore(s => s.regenerate)
  const removeRecord = useWorkspaceStore(s => s.removeRecord)
  const uploadReferenceFiles = useWorkspaceStore(s => s.uploadReferenceFiles)
  const uploadMediaParam = useWorkspaceStore(s => s.uploadMediaParam)
  const clearMediaUpload = useWorkspaceStore(s => s.clearMediaUpload)

  const categoryModels = useMemo(() => models.filter(m => m.category === selectedCategory), [models, selectedCategory])
  const selectedModel = useMemo(() => models.find(m => m.id === selectedModelId), [models, selectedModelId])
  const canGenerate = useMemo(() => selectedModel ? checkCanGenerate(selectedModel, parameters) : false, [selectedModel, parameters])
  const showReferenceUpload = useMemo(() => selectedModel?.referenceMediaType != null, [selectedModel])

  // Generation store — records
  const records = useGenerationStore(s => s.records)
  const fetchRecords = useGenerationStore(s => s.fetchRecords)

  useEffect(() => {
    loadModels()
  }, [loadModels])
  useEffect(() => {
    fetchRecords()
  }, [fetchRecords])

  // 渲染媒体上传控件
  function renderMediaUpload(param: ModelParameter) {
    const state = mediaUploadState[param.name]
    const currentUrl = String(parameters[param.name] || '')
    const hasUrl = currentUrl.trim() !== ''
    const isImage = param.mediaUpload?.accept.startsWith('image/')
    const isVideo = param.mediaUpload?.accept.startsWith('video/')
    const isAudio = param.mediaUpload?.accept.startsWith('audio/')

    return (
      <div key={param.name} className="space-y-2">
        {hasUrl && (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2">
            {isImage && (
              <img src={currentUrl} alt={param.description || ''} className="size-12 rounded border object-cover" />
            )}
            {isVideo && (
              <div className="flex size-12 items-center justify-center rounded border bg-muted">
                <Video className="size-5 text-muted-foreground" />
              </div>
            )}
            {isAudio && (
              <div className="flex size-12 items-center justify-center rounded border bg-muted">
                <FileText className="size-5 text-muted-foreground" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="truncate text-xs text-muted-foreground">
                {state?.uploadedName || currentUrl}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="size-7 p-0 text-muted-foreground hover:text-destructive"
              onClick={() => clearMediaUpload(param.name)}
            >
              <X className="size-4" />
            </Button>
          </div>
        )}

        {!hasUrl && (
          <button
            type="button"
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/25 p-3 text-sm text-muted-foreground transition-colors hover:border-muted-foreground/50 hover:bg-muted/30"
            onClick={() => uploadMediaParam(param.name, param.mediaUpload!.accept)}
            disabled={state?.uploading}
          >
            {state?.uploading
              ? <Loader2 className="size-4 animate-spin" />
              : <Upload className="size-4" />}
            {state?.uploading ? '上传中...' : `点击上传${isImage ? '图片' : isVideo ? '视频' : isAudio ? '音频' : '文件'}`}
          </button>
        )}
      </div>
    )
  }

  // 渲染参数输入
  function renderParamInput(param: ModelParameter) {
    const value = parameters[param.name]

    switch (param.type) {
      case 'text':
        if (param.mediaUpload)
          return renderMediaUpload(param)
        if (param.name === 'prompt' || param.name === 'negative_prompt') {
          return (
            <Textarea
              key={param.name}
              placeholder={param.description || param.name}
              value={String(value || '')}
              onChange={e => setParameter(param.name, e.target.value)}
              rows={param.name === 'prompt' ? 4 : 2}
              className="resize-none"
            />
          )
        }
        return (
          <Input
            key={param.name}
            placeholder={param.description || param.name}
            value={String(value || '')}
            onChange={e => setParameter(param.name, e.target.value)}
          />
        )
      case 'number':
        return (
          <Input
            key={param.name}
            type="number"
            placeholder={param.description || param.name}
            value={String(value ?? param.defaultValue ?? '')}
            min={param.min}
            max={param.max}
            onChange={e => setParameter(param.name, Number(e.target.value))}
          />
        )
      case 'select':
        return (
          <Select
            key={param.name}
            value={String(value ?? param.defaultValue ?? '')}
            onValueChange={val => setParameter(param.name, val)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {param.options?.map(o => (
                <SelectItem key={String(o.value)} value={String(o.value)}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      case 'boolean':
        return (
          <label key={param.name} className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(value ?? param.defaultValue ?? false)}
              onChange={e => setParameter(param.name, e.target.checked)}
              className="rounded border-input"
            />
            <span className="text-sm text-muted-foreground">{param.description || param.name}</span>
          </label>
        )
    }
  }

  function togglePrompt(id: string) {
    setExpandedPrompts((prev) => {
      const next = new Set(prev)
      if (next.has(id))
        next.delete(id)
      else next.add(id)
      return next
    })
  }

  function copyPrompt(id: string, text: string) {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(setCopiedId, 1500, null)
  }

  async function confirmDelete() {
    await removeRecord(deleteConfirm.id)
    setDeleteConfirm({ open: false, id: '' })
  }

  return (
    <div className="mx-auto max-w-7xl p-4">
      <div className="grid gap-6 lg:grid-cols-2">
        {/* 左栏 — 生成控制区 */}
        <div className="space-y-4">
          <div className="flex gap-2">
            {(Object.entries(CATEGORY_CONFIG) as [Category, typeof CATEGORY_CONFIG[Category]][]).map(([key, cfg]) => {
              const Icon = cfg.icon
              return (
                <Button
                  key={key}
                  variant={selectedCategory === key ? 'default' : 'outline'}
                  className={selectedCategory === key ? cfg.activeColor : ''}
                  onClick={() => setCategory(key)}
                >
                  <Icon className="size-4" />
                  {cfg.label}
                </Button>
              )
            })}
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">模型选择</CardTitle>
            </CardHeader>
            <CardContent>
              <Select
                value={selectedModelId}
                onValueChange={setModelId}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categoryModels.map(m => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                      {' '}
                      —
                      {' '}
                      {m.description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedModel?.pricing.note && (
                <p className="mt-2 text-xs text-muted-foreground">{selectedModel.pricing.note}</p>
              )}
            </CardContent>
          </Card>

          {showReferenceUpload && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">参考图片</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <label className="flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 p-4 transition-colors hover:border-muted-foreground/50">
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={e => e.target.files?.length && uploadReferenceFiles(e.target.files)}
                      disabled={uploadingRefs}
                    />
                    {uploadingRefs
                      ? <Loader2 className="size-5 animate-spin text-muted-foreground" />
                      : <span className="text-sm text-muted-foreground">点击上传参考图片（最多 5 张）</span>}
                  </label>
                  {referenceFiles.length > 0 && (
                    <div className="flex gap-2 flex-wrap">
                      {referenceFiles.map(file => (
                        <div key={file.id} className="relative size-16 overflow-hidden rounded-lg border">
                          <img src={file.url} alt={file.name} className="size-full object-cover" />
                          <button
                            className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-destructive text-white text-xs"
                            onClick={() => useWorkspaceStore.getState().removeReferenceFile(file.id)}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {selectedModel && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">参数设置</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {selectedModel.parameters.map(param => (
                  <div key={param.name}>
                    {param.type !== 'boolean' && (
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">
                        {param.description || param.name}
                        {param.required && <span className="ml-1 text-destructive">*</span>}
                      </label>
                    )}
                    {renderParamInput(param)}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Button
            className="w-full"
            size="lg"
            disabled={loading || !canGenerate}
            onClick={submit}
          >
            {loading
              ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    生成中...
                  </>
                )
              : (
                  <>
                    <Sparkles className="size-4" />
                    开始生成
                  </>
                )}
          </Button>
        </div>

        {/* 右栏 — 生成记录 */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">生成记录</h3>
          <ScrollArea className="h-[calc(100vh-8rem)]">
            <div className="space-y-3 pr-2">
              {records.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <FileText className="mb-2 size-8" />
                  <p className="text-sm">暂无生成记录</p>
                </div>
              )}

              {records.map(record => (
                <RecordCard
                  key={record.id}
                  record={record}
                  models={useWorkspaceStore.getState().models}
                  expanded={expandedPrompts.has(record.id)}
                  copied={copiedId === record.id}
                  onToggleExpand={togglePrompt}
                  onCopyPrompt={copyPrompt}
                  onRegenerate={regenerate}
                  onDelete={id => setDeleteConfirm({ open: true, id })}
                  onPreview={setPreviewUrl}
                  onCopyDiagnostics={(text) => { navigator.clipboard.writeText(text).catch(() => {}) }}
                />
              ))}
            </div>
          </ScrollArea>
        </div>
      </div>

      <MediaPreviewDialog url={previewUrl} onClose={() => setPreviewUrl(null)} />

      <AlertDialog open={deleteConfirm.open} onOpenChange={open => !open && setDeleteConfirm({ open: false, id: '' })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确定要删除这条记录吗？</AlertDialogTitle>
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
