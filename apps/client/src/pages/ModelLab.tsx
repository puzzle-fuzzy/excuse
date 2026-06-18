import type { GenerateResponse, GenerationRecord, ModelConfig, ModelParameter } from '@/api/client'
import type { ReferenceFile } from '@/components/generation/ReferenceImageUploader'
import type { ModelLabFormValues } from '@/lib/form-schemas'
import type { Category } from '@/lib/generation-utils'
import { isImageOutput, isTextOutput, isVideoOutput } from '@excuse/shared'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Beaker,
  CheckCircle2,
  Copy,
  FileText,
  ImageIcon,
  Loader2,
  Play,
  Video,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { fetchModels, generate, uploadFile } from '@/api/client'
import OutputPreview from '@/components/generation/OutputPreview'
import ParameterInput from '@/components/generation/ParameterInput'
import ReferenceImageUploader from '@/components/generation/ReferenceImageUploader'
import MediaPreviewDialog from '@/components/MediaPreviewDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { useConfirmNavigation } from '@/hooks/use-confirm-navigation'
import { buildModelLabSchema } from '@/lib/form-schemas'
import { CATEGORY_CONFIG, formatCents } from '@/lib/generation-utils'
import {
  loadCanvasModelDefaults,
  modelToCanvasPreferencePatch,
  saveCanvasModelDefaults,
} from '@/lib/model-lab-presets'
import { copyToClipboard } from '@/lib/utils'

type LabValue = string | number | boolean

interface LabReferenceFile {
  id: string
  url: string
  name: string
}

interface CompareResult {
  modelId: string
  status: 'succeeded' | 'failed'
  record?: GenerationRecord
  error?: string
}

const CATEGORY_ORDER: Category[] = ['text', 'image', 'video', 'subtitle']

function defaultValueFor(param: ModelParameter): LabValue {
  if (typeof param.defaultValue === 'string' || typeof param.defaultValue === 'number' || typeof param.defaultValue === 'boolean')
    return param.defaultValue
  if (param.type === 'number')
    return 0
  if (param.type === 'boolean')
    return false
  return ''
}

function initialValuesFor(model: ModelConfig | undefined): ModelLabFormValues {
  if (!model)
    return {}
  return Object.fromEntries(model.parameters.map(param => [param.name, defaultValueFor(param)]))
}

function hasRequiredValues(model: ModelConfig | undefined, values: ModelLabFormValues): boolean {
  if (!model)
    return false
  return model.parameters.every((param) => {
    if (!param.required)
      return true
    const value = values[param.name]
    return value !== '' && value !== null && value !== undefined && value !== false
  })
}

function parametersForModel(model: ModelConfig, values: ModelLabFormValues): ModelLabFormValues {
  const next: ModelLabFormValues = {}
  for (const param of model.parameters)
    next[param.name] = values[param.name] ?? defaultValueFor(param)
  return next
}

function modelUnitLabel(model: ModelConfig): string {
  switch (model.pricing.unit) {
    case 'token':
      return `输入 ${formatCents(model.pricing.inputPriceCents, 4)} / 百万 tokens${model.pricing.outputPriceCents ? `，输出 ${formatCents(model.pricing.outputPriceCents, 4)} / 百万 tokens` : ''}`
    case 'image':
      return `${formatCents(model.pricing.inputPriceCents)} / 张`
    case 'video':
      return `${formatCents(model.pricing.inputPriceCents)} / 秒（720P）${model.pricing.inputPrice1080Cents ? `，${formatCents(model.pricing.inputPrice1080Cents)} / 秒（1080P）` : ''}`
    case 'audio':
      return `${formatCents(model.pricing.inputPriceCents)} / 单位音频`
    default:
      return '未配置计价单位'
  }
}

function outputSummary(record: GenerationRecord | null): string {
  if (!record)
    return '等待提交实验请求'
  if (record.status !== 'succeeded')
    return `当前状态：${record.status}`
  if (isTextOutput(record.outputResult))
    return `文本输出 ${record.outputResult.text.length} 字`
  if (isImageOutput(record.outputResult))
    return `图片输出 ${record.outputResult.savedUrls.length || record.outputResult.urls?.length || 0} 张`
  if (isVideoOutput(record.outputResult))
    return `视频输出 ${record.outputResult.savedUrls.length || 1} 个`
  return '生成完成'
}

export default function ModelLab() {
  const [models, setModels] = useState<ModelConfig[]>([])
  const [loadingModels, setLoadingModels] = useState(true)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<Category>('text')
  const [selectedModelId, setSelectedModelId] = useState('')
  const [referenceFiles, setReferenceFiles] = useState<LabReferenceFile[]>([])
  const [uploadingParam, setUploadingParam] = useState<string | null>(null)
  const [uploadingRefs, setUploadingRefs] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [compareModelIds, setCompareModelIds] = useState<string[]>([])
  const [compareResults, setCompareResults] = useState<CompareResult[]>([])
  const [result, setResult] = useState<GenerateResponse | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [canvasDefaults, setCanvasDefaults] = useState(() => loadCanvasModelDefaults())
  const didLoadModelsRef = useRef(false)

  const selectedModel = useMemo(
    () => models.find(model => model.id === selectedModelId),
    [models, selectedModelId],
  )
  const categoryModels = useMemo(
    () => models.filter(model => model.category === selectedCategory),
    [models, selectedCategory],
  )

  const resolverSchema = useMemo(
    () => buildModelLabSchema(selectedModel?.parameters ?? []),
    [selectedModel],
  )

  const form = useForm<ModelLabFormValues>({
    defaultValues: initialValuesFor(selectedModel),
    resolver: zodResolver(resolverSchema as never),
  })
  const { reset } = form
  const values = form.watch()

  // 未保存更改时阻止意外离开（beforeunload + 应用内导航链接拦截）
  const isDirty = form.formState.isDirty
  useConfirmNavigation(isDirty, '有未保存的更改，确定要离开吗？')

  useEffect(() => {
    if (didLoadModelsRef.current)
      return
    didLoadModelsRef.current = true
    let cancelled = false
    async function loadModelLabModels() {
      setLoadingModels(true)
      setModelsError(null)
      try {
        const data = await fetchModels()
        if (cancelled)
          return
        setModels(data.models)
        const firstText = data.models.find(model => model.category === 'text') ?? data.models[0]
        if (firstText) {
          setSelectedCategory(firstText.category as Category)
          setSelectedModelId(firstText.id)
          setCompareModelIds([firstText.id])
          reset(initialValuesFor(firstText))
        }
      }
      catch (error) {
        if (!cancelled)
          setModelsError(error instanceof Error ? error.message : '模型列表加载失败')
      }
      finally {
        if (!cancelled)
          setLoadingModels(false)
      }
    }
    loadModelLabModels()
    return () => {
      cancelled = true
    }
  }, [reset])

  function chooseCategory(category: Category) {
    setSelectedCategory(category)
    const nextModel = models.find(model => model.category === category)
    if (!nextModel)
      return
    setSelectedModelId(nextModel.id)
    setCompareModelIds([nextModel.id])
    setCompareResults([])
    setReferenceFiles([])
    setResult(null)
    form.reset(initialValuesFor(nextModel))
  }

  function chooseModel(id: string) {
    const nextModel = models.find(model => model.id === id)
    if (!nextModel)
      return
    setSelectedModelId(id)
    setSelectedCategory(nextModel.category as Category)
    setCompareModelIds([id])
    setCompareResults([])
    setReferenceFiles([])
    setResult(null)
    form.reset(initialValuesFor(nextModel))
  }

  async function uploadParamFile(param: ModelParameter) {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = param.mediaUpload?.accept ?? '*/*'
    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0]
      if (!file)
        return
      setUploadingParam(param.name)
      try {
        const response = await uploadFile(file)
        if (response.success) {
          form.setValue(param.name, response.data.publicUrl, { shouldDirty: true, shouldValidate: true })
          toast.success('素材已上传')
        }
      }
      catch {
        toast.error('素材上传失败')
      }
      finally {
        setUploadingParam(null)
      }
    }
    input.click()
  }

  async function uploadReferenceFiles(files: FileList | null) {
    if (!files?.length)
      return
    setUploadingRefs(true)
    try {
      const uploaded: LabReferenceFile[] = []
      for (const file of Array.from(files)) {
        const response = await uploadFile(file)
        if (response.success) {
          uploaded.push({
            id: response.data.id,
            url: response.data.publicUrl,
            name: response.data.fileName,
          })
        }
      }
      setReferenceFiles(prev => [...prev, ...uploaded].slice(0, 5))
      if (uploaded.length > 0)
        toast.success(`已上传 ${uploaded.length} 个参考素材`)
    }
    catch {
      toast.error('参考素材上传失败')
    }
    finally {
      setUploadingRefs(false)
    }
  }

  async function submit(values: ModelLabFormValues) {
    // zodResolver 已做必填校验；这里只兜底 race condition（selectedModel 在异步过程中被清空）
    if (!selectedModel)
      return
    setSubmitting(true)
    setResult(null)
    try {
      const response = await generate({
        model: selectedModel.id,
        parameters: values,
        referenceFileIds: referenceFiles.length > 0 ? referenceFiles.map(file => file.id) : undefined,
      })
      setResult(response)
      toast.success(response.record.status === 'succeeded' ? '实验完成' : '实验任务已提交')
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : '实验请求失败')
    }
    finally {
      setSubmitting(false)
    }
  }

  function toggleCompareModel(modelId: string) {
    setCompareModelIds((prev) => {
      if (prev.includes(modelId))
        return prev.filter(id => id !== modelId)
      return [...prev, modelId]
    })
  }

  function saveSelectedModelAsCanvasDefault() {
    if (!selectedModel)
      return
    const patch = modelToCanvasPreferencePatch(selectedModel)
    if (Object.keys(patch).length === 0) {
      toast.error('字幕模型暂不支持保存为 Canvas 默认模型')
      return
    }
    const saved = saveCanvasModelDefaults(patch)
    setCanvasDefaults(saved)
    toast.success('已保存，新建 Canvas 项目时将自动应用')
  }

  function applyCanvasDefaultsToLab() {
    if (!canvasDefaults)
      return
    const prefKey = `${selectedCategory}Model` as 'textModel' | 'imageModel' | 'videoModel'
    const defaultModelId = canvasDefaults.preferences[prefKey]
    if (!defaultModelId) {
      toast.error('当前分类还没有保存默认模型')
      return
    }
    const targetModel = models.find(model => model.id === defaultModelId && model.category === selectedCategory)
    if (!targetModel) {
      toast.error('保存的默认模型当前不可用')
      return
    }
    chooseModel(targetModel.id)
    toast.success('已应用 Canvas 默认模型')
  }

  async function runComparison(values: ModelLabFormValues) {
    const selectedModels = compareModelIds
      .map(id => models.find(model => model.id === id))
      .filter((model): model is ModelConfig => Boolean(model))

    if (selectedModels.length < 2) {
      toast.error('至少选择 2 个模型进行对比')
      return
    }

    setComparing(true)
    setCompareResults([])
    const referenceFileIds = referenceFiles.length > 0 ? referenceFiles.map(file => file.id) : undefined

    try {
      const settled = await Promise.all(selectedModels.map(async (model): Promise<CompareResult> => {
        try {
          if (!hasRequiredValues(model, parametersForModel(model, values))) {
            return {
              modelId: model.id,
              status: 'failed',
              error: '缺少必填参数',
            }
          }
          const response = await generate({
            model: model.id,
            parameters: parametersForModel(model, values),
            referenceFileIds,
          })
          return {
            modelId: model.id,
            status: 'succeeded',
            record: response.record,
          }
        }
        catch (error) {
          return {
            modelId: model.id,
            status: 'failed',
            error: error instanceof Error ? error.message : '实验请求失败',
          }
        }
      }))
      setCompareResults(settled)
      toast.success('对比实验已完成')
    }
    finally {
      setComparing(false)
    }
  }

  // 渲染参数输入（委托给共享 ParameterInput 组件）
  function renderParam(param: ModelParameter) {
    return (
      <ParameterInput
        key={param.name}
        param={param}
        value={values[param.name]}
        onChange={val => form.setValue(param.name, val as string | number | boolean, { shouldDirty: true, shouldValidate: true })}
        idPrefix="model-lab-param"
        uploading={uploadingParam === param.name}
        onUpload={param.mediaUpload ? () => uploadParamFile(param) : undefined}
        onClear={param.mediaUpload ? () => form.setValue(param.name, '', { shouldDirty: true }) : undefined}
      />
    )
  }

  const requestPreview = JSON.stringify({
    model: selectedModel?.id ?? '',
    parameters: values,
    referenceFileIds: referenceFiles.map(file => file.id),
  }, null, 2)
  const record = result?.record ?? null
  const hasModel = Boolean(selectedModel)
  const compareRequestPreview = JSON.stringify({
    models: compareModelIds,
    parameters: values,
    referenceFileIds: referenceFiles.map(file => file.id),
  }, null, 2)

  return (
    <div className="mx-auto max-w-7xl p-4">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Beaker className="size-5 text-primary" />
            <h1 className="text-lg font-semibold">Model Lab</h1>
            <Badge variant="secondary">内部实验</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            用真实模型配置验证 prompt、参数、素材输入和成本表现。
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-right text-xs text-muted-foreground">
          <div className="rounded-lg border px-3 py-2">
            <div className="font-medium text-foreground">{models.length}</div>
            <div>可用模型</div>
          </div>
          <div className="rounded-lg border px-3 py-2">
            <div className="font-medium text-foreground">{categoryModels.length}</div>
            <div>当前分类</div>
          </div>
          <div className="rounded-lg border px-3 py-2">
            <div className="font-medium text-foreground">{selectedModel?.async ? '异步' : '同步'}</div>
            <div>调用模式</div>
          </div>
        </div>
      </div>

      {modelsError && (
        <Card className="mb-4 border-destructive/40">
          <CardContent className="p-4 text-sm text-destructive">{modelsError}</CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
        <form className="space-y-4" onSubmit={form.handleSubmit(submit)}>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">实验对象</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {CATEGORY_ORDER.map((category) => {
                  const cfg = CATEGORY_CONFIG[category]
                  const Icon = cfg.icon
                  const disabled = !models.some(model => model.category === category)
                  return (
                    <Button
                      key={category}
                      type="button"
                      variant={selectedCategory === category ? 'default' : 'outline'}
                      className={selectedCategory === category ? cfg.activeColor : ''}
                      disabled={disabled || loadingModels}
                      onClick={() => chooseCategory(category)}
                    >
                      <Icon className="size-4" />
                      {cfg.label}
                    </Button>
                  )
                })}
              </div>

              <div className="grid gap-3 md:grid-cols-[1fr_180px]">
                <Select
                  value={selectedModelId}
                  disabled={loadingModels}
                  onValueChange={chooseModel}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryModels.map(model => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.name}
                        {' '}
                        -
                        {' '}
                        {model.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Badge variant="outline" className="flex h-8 items-center justify-center">
                  {selectedModel?.requestType || '未声明 requestType'}
                </Badge>
              </div>

              {selectedModel && (
                <div className="rounded-lg bg-muted/40 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{selectedModel.name}</span>
                    <Badge variant="secondary">{selectedModel.type}</Badge>
                    <Badge variant="outline">{selectedModel.category}</Badge>
                  </div>
                  <p className="mt-1 text-muted-foreground">{selectedModel.description}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{modelUnitLabel(selectedModel)}</p>
                  {selectedModel.pricing.note && (
                    <p className="mt-1 text-xs text-muted-foreground">{selectedModel.pricing.note}</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {selectedModel?.referenceMediaType && (
            <ReferenceImageUploader
              files={referenceFiles as ReferenceFile[]}
              uploading={uploadingRefs}
              onUpload={uploadReferenceFiles}
              onRemove={id => setReferenceFiles(prev => prev.filter(item => item.id !== id))}
              title="参考素材"
            />
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">参数</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {selectedModel
                ? selectedModel.parameters.map(param => (
                    <div key={param.name} className="space-y-1.5">
                      {param.type !== 'boolean' && (
                        <label htmlFor={`model-lab-param-${param.name}`} className="block text-xs font-medium text-muted-foreground">
                          {param.description || param.name}
                          {param.required && <span className="ml-1 text-destructive">*</span>}
                        </label>
                      )}
                      {renderParam(param)}
                    </div>
                  ))
                : (
                    <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                      {loadingModels ? '模型加载中...' : '暂无可实验模型'}
                    </div>
                  )}
            </CardContent>
          </Card>

          <Button
            type="button"
            size="lg"
            className="w-full"
            disabled={submitting || comparing || !hasModel}
            onClick={form.handleSubmit(submit)}
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            {submitting ? '提交中...' : '运行实验'}
          </Button>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">同 prompt 多模型对比</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2">
                {categoryModels.map(model => (
                  <label key={model.id} className="flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={compareModelIds.includes(model.id)}
                      onChange={() => toggleCompareModel(model.id)}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{model.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{model.id}</span>
                    </span>
                  </label>
                ))}
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={comparing || !hasModel || compareModelIds.length < 2}
                onClick={form.handleSubmit(runComparison)}
              >
                {comparing ? <Loader2 className="size-4 animate-spin" /> : <Beaker className="size-4" />}
                {comparing ? '对比中...' : '运行对比实验'}
              </Button>

              {compareModelIds.length < 2 && (
                <p className="text-xs text-muted-foreground">选择至少 2 个同分类模型后，可用当前 prompt 和参数并行提交对比。</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Canvas 默认配置</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 text-xs text-muted-foreground">
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span>文本模型</span>
                  <code>{canvasDefaults?.preferences.textModel || '未设置'}</code>
                </div>
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span>图片模型</span>
                  <code>{canvasDefaults?.preferences.imageModel || '未设置'}</code>
                </div>
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span>视频模型</span>
                  <code>{canvasDefaults?.preferences.videoModel || '未设置'}</code>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!selectedModel}
                  onClick={saveSelectedModelAsCanvasDefault}
                >
                  保存当前模型
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!canvasDefaults}
                  onClick={applyCanvasDefaultsToLab}
                >
                  应用到当前分类
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                先在 Lab 验证模型，再保存为 Canvas 默认偏好；已接入：新建 Canvas 项目时自动应用（见 Canvas.tsx handleCreate）。
              </p>
            </CardContent>
          </Card>
        </form>

        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-sm">请求预览</CardTitle>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => copyToClipboard(compareRequestPreview)}>
                  <Copy className="size-3" />
                  复制对比
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => copyToClipboard(requestPreview)}>
                  <Copy className="size-3" />
                  复制
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <pre className="max-h-80 overflow-auto rounded-lg bg-muted p-3 text-xs">
                <code>{requestPreview}</code>
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">对比结果</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {compareResults.length === 0 && (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-10 text-muted-foreground">
                  <Beaker className="mb-2 size-7" />
                  <p className="text-sm">运行对比后会按模型展示结果</p>
                </div>
              )}

              {compareResults.map((item) => {
                const model = models.find(m => m.id === item.modelId)
                return (
                  <div key={item.modelId} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{model?.name || item.modelId}</div>
                        <div className="truncate text-xs text-muted-foreground">{item.modelId}</div>
                      </div>
                      <Badge variant={item.status === 'failed' ? 'destructive' : 'secondary'}>
                        {item.record?.status || item.status}
                      </Badge>
                    </div>

                    {item.record && (
                      <div className="mt-2 rounded-lg bg-muted/40 p-2 text-xs">
                        <div>{outputSummary(item.record)}</div>
                        {item.record.cost && (
                          <div className="mt-1 text-muted-foreground">
                            成本：
                            {formatCents(item.record.cost.totalPriceCents)}
                          </div>
                        )}
                      </div>
                    )}

                    {item.error && (
                      <p className="mt-2 text-xs text-destructive">{item.error}</p>
                    )}

                    {item.record?.outputResult && (
                      <div className="mt-2">
                        <OutputPreview output={item.record.outputResult} onPreview={setPreviewUrl} />
                      </div>
                    )}
                  </div>
                )
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">实验结果</CardTitle>
            </CardHeader>
            <CardContent>
              {!record && (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-muted-foreground">
                  <FileText className="mb-2 size-8" />
                  <p className="text-sm">提交后会在这里显示返回记录</p>
                </div>
              )}

              {record && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={record.status === 'failed' ? 'destructive' : 'secondary'}>
                      {record.status}
                    </Badge>
                    <span className="text-sm font-medium">{record.model}</span>
                    <span className="text-xs text-muted-foreground">
                      #
                      {record.id.slice(0, 8)}
                    </span>
                  </div>
                  <div className="rounded-lg bg-muted/40 p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="size-4 text-muted-foreground" />
                      <span>{outputSummary(record)}</span>
                    </div>
                    {record.cost && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        成本：
                        {formatCents(record.cost.totalPriceCents)}
                        {record.cost.estimated ? '（预估）' : ''}
                      </p>
                    )}
                    {record.errorMessage && (
                      <p className="mt-2 text-xs text-destructive">{record.errorMessage}</p>
                    )}
                  </div>

                  {record.outputResult && (
                    <OutputPreview output={record.outputResult} onPreview={setPreviewUrl} />
                  )}

                  <Separator />
                  <ScrollArea className="h-48 rounded-lg border">
                    <pre className="p-3 text-xs">
                      <code>{JSON.stringify(record, null, 2)}</code>
                    </pre>
                  </ScrollArea>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">实验提示</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm text-muted-foreground">
              <div className="flex gap-2">
                <ImageIcon className="mt-0.5 size-4 shrink-0" />
                <span>图片和视频模型通常返回异步记录，可到资产中心或工作台继续观察完成状态。</span>
              </div>
              <div className="flex gap-2">
                <Video className="mt-0.5 size-4 shrink-0" />
                <span>参考图模型会把上传素材作为 referenceFileIds 提交，便于验证真实生成链路。</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <MediaPreviewDialog url={previewUrl} onClose={() => setPreviewUrl(null)} />
    </div>
  )
}
