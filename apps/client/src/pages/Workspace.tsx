import type { GenerationRecord, ModelParameter } from '@/api/client'
import type { ReferenceFile } from '@/components/generation/ReferenceImageUploader'
import type { WorkspaceParameters } from '@/lib/generation-form-utils'
import type { Category } from '@/lib/generation-utils'
import {
  CheckCircle2,
  FileText,
  ImageIcon,
  Loader2,
  PanelRight,
  SlidersHorizontal,
  Sparkles,
  Video,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import EmptyState from '@/components/EmptyState'
import ParameterInput from '@/components/generation/ParameterInput'
import RecordCard from '@/components/generation/RecordCard'
import { RecordCardSkeletonList } from '@/components/generation/RecordCardSkeleton'
import ReferenceImageUploader from '@/components/generation/ReferenceImageUploader'
import MediaPreviewDialog from '@/components/MediaPreviewDialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { buildInitialParameters, checkCanGenerate } from '@/lib/generation-form-utils'
import { CATEGORY_CONFIG } from '@/lib/generation-utils'
import { statusDotClass, statusTextClass } from '@/lib/status-tokens'
import { cn } from '@/lib/utils'
import { useGenerationStore } from '@/stores/generation'
import { useModelsStore } from '@/stores/models-store'
import { useWorkspaceStore } from '@/stores/workspace'
import { clearDraft, guardBeforeUnload, loadDraft, saveDraft } from '../lib/draft-storage'

export default function Workspace() {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [expandedPrompts, setExpandedPrompts] = useState<Set<string>>(() => new Set())
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean, id: string }>({ open: false, id: '' })

  // Models store — 模型/分类/模型选择
  const models = useModelsStore(s => s.models)
  const selectedCategory = useModelsStore(s => s.selectedCategory)
  const selectedModelId = useModelsStore(s => s.selectedModelId)
  const setCategory = useModelsStore(s => s.setCategory)
  const setModelId = useModelsStore(s => s.setModelId)
  const loadModels = useModelsStore(s => s.loadModels)

  // Workspace store — 表单状态/文件上传/提交
  const parameters = useWorkspaceStore(s => s.parameters)
  const loading = useWorkspaceStore(s => s.loading)
  const uploadingRefs = useWorkspaceStore(s => s.uploadingRefs)
  const referenceFiles = useWorkspaceStore(s => s.referenceFiles)
  const mediaUploadState = useWorkspaceStore(s => s.mediaUploadState)
  const setParameter = useWorkspaceStore(s => s.setParameter)
  const setParameters = useWorkspaceStore(s => s.setParameters)
  const resetForm = useWorkspaceStore(s => s.resetForm)
  const submitAction = useWorkspaceStore(s => s.submit)
  const regenerateAction = useWorkspaceStore(s => s.regenerate)
  const removeRecordAction = useWorkspaceStore(s => s.removeRecord)
  const uploadReferenceFiles = useWorkspaceStore(s => s.uploadReferenceFiles)
  const uploadMediaParam = useWorkspaceStore(s => s.uploadMediaParam)
  const clearMediaUpload = useWorkspaceStore(s => s.clearMediaUpload)

  // Generation store — 生成记录
  const records = useGenerationStore(s => s.records)
  const loadingRecords = useGenerationStore(s => s.loadingRecords)
  const fetchRecords = useGenerationStore(s => s.fetchRecords)
  const addRecord = useGenerationStore(s => s.addRecord)
  const removeRecord = useGenerationStore(s => s.removeRecord)

  // 派生值
  const categoryModels = useMemo(() => models.filter(m => m.category === selectedCategory), [models, selectedCategory])
  const selectedModel = useMemo(() => models.find(m => m.id === selectedModelId), [models, selectedModelId])
  const canGenerate = useMemo(() => selectedModel ? checkCanGenerate(selectedModel, parameters) : false, [selectedModel, parameters])
  const showReferenceUpload = useMemo(() => selectedModel?.referenceMediaType != null, [selectedModel])
  const activeRecords = useMemo(
    () => records.filter(record => ['pending', 'submitting', 'processing', 'saving_output'].includes(record.status)),
    [records],
  )
  const completedRecords = useMemo(
    () => records.filter(record => record.status === 'succeeded'),
    [records],
  )
  const failedRecords = useMemo(
    () => records.filter(record => record.status === 'failed' || record.status === 'cancelled'),
    [records],
  )
  const primaryPromptParam = useMemo(
    () => selectedModel?.parameters.find(param => param.name === 'prompt' || param.name === 'text'),
    [selectedModel],
  )
  const advancedParams = useMemo(
    () => selectedModel?.parameters.filter(param => param !== primaryPromptParam) ?? [],
    [primaryPromptParam, selectedModel],
  )
  const selectedCategoryConfig = CATEGORY_CONFIG[selectedCategory]
  const SelectedCategoryIcon = selectedCategoryConfig.icon

  useEffect(() => {
    loadModels()
  }, [loadModels])
  useEffect(() => {
    fetchRecords()
  }, [fetchRecords])

  // §1.4(b) 草稿保护：prompt 持久化到 sessionStorage + beforeunload 拦截
  const promptValue = String(parameters.prompt || parameters.text || '')
  const promptDirtyRef = useRef(false)

  // 还原草稿（当模型加载后 prompt 为空时）
  useEffect(() => {
    if (!selectedModel || promptValue)
      return
    const saved = loadDraft('workspace_prompt')
    if (saved) {
      setParameter('prompt', saved)
    }
  }, [selectedModel, promptValue, setParameter])

  // 同步 prompt 变更到 sessionStorage
  useEffect(() => {
    saveDraft('workspace_prompt', promptValue)
    promptDirtyRef.current = promptValue.trim().length > 0
  }, [promptValue])

  // beforeunload 拦截（prompt 非空时阻止误关闭）
  useEffect(() => {
    return guardBeforeUnload(() => promptDirtyRef.current)
  }, [])

  // 分类切换时同时重置表单参数
  const handleCategoryChange = useCallback((category: Category) => {
    setCategory(category)
    const nextModels = models.filter(m => m.category === category)
    if (nextModels.length > 0)
      setParameters(buildInitialParameters(nextModels[0]))
  }, [models, setCategory, setParameters])

  // 模型切换时重置表单参数
  const handleModelChange = useCallback((id: string) => {
    setModelId(id)
    const model = models.find(m => m.id === id)
    if (model)
      resetForm(model)
  }, [models, setModelId, resetForm])

  // 提交生成 — React 层编排
  const handleSubmit = useCallback(async () => {
    if (!selectedModel)
      return
    const record = await submitAction(selectedModel)
    if (record) {
      clearDraft('workspace_prompt')
      addRecord(record)
      toast.success('生成请求已提交')
    }
  }, [selectedModel, submitAction, addRecord])

  // 重新生成
  const handleRegenerate = useCallback(async (record: GenerationRecord) => {
    const refIds = Array.isArray(record.inputParams?.referenceFileIds)
      ? record.inputParams.referenceFileIds as string[]
      : undefined
    const newRecord = await regenerateAction(record.model, record.inputParams as WorkspaceParameters, refIds)
    if (newRecord) {
      addRecord(newRecord)
      toast.success('重新生成请求已提交')
    }
  }, [regenerateAction, addRecord])

  // 删除记录
  const handleRemoveRecord = useCallback(async (id: string) => {
    await removeRecordAction(id)
    removeRecord(id)
  }, [removeRecordAction, removeRecord])

  // 渲染参数输入（委托给共享 ParameterInput 组件）
  function renderParamInput(param: ModelParameter) {
    const state = param.mediaUpload ? mediaUploadState[param.name] : undefined
    return (
      <ParameterInput
        key={param.name}
        param={param}
        value={parameters[param.name]}
        onChange={val => setParameter(param.name, val as string | number | boolean)}
        idPrefix="workspace"
        uploading={state?.uploading}
        onUpload={param.mediaUpload ? () => uploadMediaParam(param.name, param.mediaUpload!.accept) : undefined}
        onClear={param.mediaUpload ? () => clearMediaUpload(param.name) : undefined}
        uploadedName={state?.uploadedName}
      />
    )
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

  async function confirmRecordDeletion() {
    await handleRemoveRecord(deleteConfirm.id)
    setDeleteConfirm({ open: false, id: '' })
  }

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <section className="rounded-2xl border bg-card p-5">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
              <span className={statusDotClass(activeRecords.length > 0 ? 'info' : 'neutral', 'size-2 rounded-full')} />
              {activeRecords.length > 0 ? `${activeRecords.length} 个生成任务正在处理` : '创作台已准备好'}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Create production</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              先写清楚创作意图，再按需要展开模型和参数。生成结果会进入右侧队列，并沉淀为可追溯资产。
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 rounded-xl border bg-muted/30 p-2 text-center">
            <div className="min-w-20 px-3 py-2">
              <div className="text-lg font-semibold">{activeRecords.length}</div>
              <div className="text-[11px] text-muted-foreground">运行中</div>
            </div>
            <div className="min-w-20 border-x px-3 py-2">
              <div className="text-lg font-semibold">{completedRecords.length}</div>
              <div className="text-[11px] text-muted-foreground">已完成</div>
            </div>
            <div className="min-w-20 px-3 py-2">
              <div className={cn('text-lg font-semibold', failedRecords.length > 0 && statusTextClass('danger'))}>{failedRecords.length}</div>
              <div className="text-[11px] text-muted-foreground">需处理</div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.78fr)]">
        <section className="space-y-4">
          <div className="rounded-xl border bg-card">
            <div className="border-b p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-base font-semibold tracking-tight">生成类型</h2>
                  <p className="mt-1 text-sm text-muted-foreground">选择输出方向，系统会带出对应模型和参数。</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(Object.entries(CATEGORY_CONFIG) as [Category, typeof CATEGORY_CONFIG[Category]][]).map(([key, cfg]) => {
                    const Icon = cfg.icon
                    const active = selectedCategory === key
                    return (
                      <button
                        key={key}
                        type="button"
                        className={cn(
                          'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                          active
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                        )}
                        onClick={() => handleCategoryChange(key)}
                      >
                        <Icon className="size-4" />
                        {cfg.label.replace('生成', '')}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="space-y-5 p-4 sm:p-5">
              <div className="rounded-xl border bg-background p-4">
                <div className="mb-3 flex items-center gap-2">
                  <SelectedCategoryIcon className={cn('size-4', selectedCategoryConfig.color)} />
                  <div>
                    <h3 className="text-sm font-semibold">创作输入</h3>
                    <p className="text-xs text-muted-foreground">描述你要生成的内容，越具体越容易得到稳定结果。</p>
                  </div>
                </div>

                {primaryPromptParam
                  ? (
                      <div>
                        {renderParamInput(primaryPromptParam)}
                      </div>
                    )
                  : (
                      <EmptyState
                        icon={FileText}
                        title="当前模型没有 prompt 输入"
                        description="请切换模型或在高级参数中填写该模型需要的字段。"
                      />
                    )}
              </div>

              {showReferenceUpload && (
                <div className="rounded-xl border bg-background p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <ImageIcon className="size-4 text-[color:var(--brand-image)]" />
                    <div>
                      <h3 className="text-sm font-semibold">参考素材</h3>
                      <p className="text-xs text-muted-foreground">上传参考图或素材，生成时会随请求一起提交。</p>
                    </div>
                  </div>
                  <ReferenceImageUploader
                    files={referenceFiles as ReferenceFile[]}
                    uploading={uploadingRefs}
                    onUpload={uploadReferenceFiles}
                    onRemove={id => useWorkspaceStore.getState().removeReferenceFile(id)}
                  />
                </div>
              )}

              <div className="rounded-xl border bg-background">
                <div className="flex items-center justify-between gap-3 border-b p-4">
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal className="size-4 text-muted-foreground" />
                    <div>
                      <h3 className="text-sm font-semibold">模型与高级参数</h3>
                      <p className="text-xs text-muted-foreground">默认配置可直接生成，需要精调时再修改。</p>
                    </div>
                  </div>
                  <Badge variant="secondary">{selectedModel?.requestType || 'standard'}</Badge>
                </div>

                <div className="space-y-4 p-4">
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px]">
                    <Select
                      value={selectedModelId}
                      onValueChange={handleModelChange}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="选择模型" />
                      </SelectTrigger>
                      <SelectContent>
                        {categoryModels.map(m => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.name}
                            {' - '}
                            {m.description}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex items-center rounded-lg border bg-muted/35 px-3 text-xs text-muted-foreground">
                      {selectedModel ? selectedModel.id : '未选择模型'}
                    </div>
                  </div>

                  {selectedModel?.pricing.note && (
                    <div className="rounded-lg border bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
                      {selectedModel.pricing.note}
                    </div>
                  )}

                  {selectedModel && advancedParams.length > 0 && (
                    <div className="grid gap-3 md:grid-cols-2">
                      {advancedParams.map(param => (
                        <div key={param.name}>
                          {param.type !== 'boolean' && (
                            <label htmlFor={`workspace-${param.name}`} className="mb-1 block text-xs font-medium text-muted-foreground">
                              {param.description || param.name}
                              {param.required && <span className="ml-1 text-destructive">*</span>}
                            </label>
                          )}
                          {renderParamInput(param)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="sticky bottom-4 z-10 rounded-xl border bg-background/95 p-3 shadow-sm backdrop-blur">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
                      {canGenerate ? <CheckCircle2 className="size-4" /> : <PanelRight className="size-4" />}
                    </span>
                    <div>
                      <div className="text-sm font-medium">{canGenerate ? '可以提交生成' : '补全必填字段后提交'}</div>
                      <p className="text-xs text-muted-foreground">
                        {selectedModel ? `当前模型：${selectedModel.name}` : '模型加载后会自动选择默认项'}
                      </p>
                    </div>
                  </div>
                  <Button
                    className="brand-cta sm:min-w-40"
                    size="lg"
                    disabled={loading || !canGenerate}
                    onClick={handleSubmit}
                  >
                    {loading
                      ? (
                          <>
                            <Loader2 className="size-4 animate-spin" />
                            提交中
                          </>
                        )
                      : (
                          <>
                            <Sparkles className="size-4" />
                            提交生成
                          </>
                        )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-xl border bg-card">
            <div className="flex items-center justify-between gap-3 border-b p-4">
              <div>
                <h2 className="text-base font-semibold tracking-tight">生产队列</h2>
                <p className="mt-1 text-sm text-muted-foreground">查看状态、预览结果、重试失败任务。</p>
              </div>
              <Badge variant="outline">
                {records.length}
                {' '}
                records
              </Badge>
            </div>

            <ScrollArea className="h-[calc(100vh-15rem)] min-h-[520px]">
              <div className="space-y-3 p-4">
                {loadingRecords && records.length === 0
                  ? <RecordCardSkeletonList count={3} />
                  : records.length === 0
                    ? (
                        <EmptyState
                          icon={Video}
                          title="还没有生产记录"
                          description="左侧提交一次生成后，任务进度和结果会出现在这里。"
                        />
                      )
                    : (
                        records.map(record => (
                          <RecordCard
                            key={record.id}
                            record={record}
                            models={models}
                            expanded={expandedPrompts.has(record.id)}
                            copied={copiedId === record.id}
                            onToggleExpand={togglePrompt}
                            onCopyPrompt={copyPrompt}
                            onRegenerate={handleRegenerate}
                            onDelete={id => setDeleteConfirm({ open: true, id })}
                            onPreview={setPreviewUrl}
                            onCopyDiagnostics={(text) => { navigator.clipboard.writeText(text).catch(() => {}) }}
                          />
                        ))
                      )}
              </div>
            </ScrollArea>
          </div>
        </aside>
      </div>

      <MediaPreviewDialog url={previewUrl} onClose={() => setPreviewUrl(null)} />

      <AlertDialog open={deleteConfirm.open} onOpenChange={open => !open && setDeleteConfirm({ open: false, id: '' })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确定要删除这条记录吗？</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRecordDeletion}>确认</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
