import type { GenerationRecord, ModelParameter } from '@/api/client'
import type { ReferenceFile } from '@/components/generation/ReferenceImageUploader'
import type { WorkspaceParameters } from '@/lib/generation-form-utils'
import type { Category } from '@/lib/generation-utils'
import {
  FileText,
  Loader2,
  Sparkles,
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
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { buildInitialParameters, checkCanGenerate } from '@/lib/generation-form-utils'
import { CATEGORY_CONFIG } from '@/lib/generation-utils'
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
  }, [selectedModel]) // 仅模型首次加载时触发

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

  async function confirmDelete() {
    await handleRemoveRecord(deleteConfirm.id)
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
                  onClick={() => handleCategoryChange(key)}
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
                onValueChange={handleModelChange}
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
            <ReferenceImageUploader
              files={referenceFiles as ReferenceFile[]}
              uploading={uploadingRefs}
              onUpload={uploadReferenceFiles}
              onRemove={id => useWorkspaceStore.getState().removeReferenceFile(id)}
            />
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
            className="brand-cta w-full"
            size="lg"
            disabled={loading || !canGenerate}
            onClick={handleSubmit}
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
          <h3 className="text-title text-muted-foreground">生成记录</h3>
          <ScrollArea className="h-[calc(100vh-8rem)]">
            <div className="space-y-3 pr-2">
              {loadingRecords && records.length === 0
                ? <RecordCardSkeletonList count={3} />
                : records.length === 0
                  ? (
                      <EmptyState
                        icon={FileText}
                        title="暂无生成记录"
                        description="← 在左侧输入 Prompt 开始生成"
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
