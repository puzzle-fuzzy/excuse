import type { GenerationRecord, ModelConfig } from '@/api/client'
import type { ModelLabFormValues } from '@/lib/form-schemas'
import { isImageOutput, isTextOutput, isVideoOutput } from '@excuse/shared'
import { Beaker, Copy, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { generate } from '@/api/client'
import OutputPreview from '@/components/generation/OutputPreview'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { formatCents } from '@/lib/generation-utils'
import { copyToClipboard } from '@/lib/utils'

interface CompareResult {
  modelId: string
  status: 'succeeded' | 'failed'
  record?: GenerationRecord
  error?: string
}

interface LabReferenceFile {
  id: string
  url: string
  name: string
}

interface Props {
  models: ModelConfig[]
  categoryModels: ModelConfig[]
  selectedModelId: string
  values: ModelLabFormValues
  referenceFiles: LabReferenceFile[]
  onPreview: (url: string | null) => void
  onComparingChange?: (comparing: boolean) => void
}

function defaultValue(value: unknown, type: string): string | number | boolean {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return value
  if (type === 'number')
    return 0
  if (type === 'boolean')
    return false
  return ''
}

function hasRequiredValues(model: ModelConfig, values: ModelLabFormValues): boolean {
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
    next[param.name] = values[param.name] ?? defaultValue(param.defaultValue, param.type)
  return next
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

export default function ModelComparisonSection({
  models,
  categoryModels,
  selectedModelId,
  values,
  referenceFiles,
  onPreview,
  onComparingChange,
}: Props) {
  const [compareModelIds, setCompareModelIds] = useState<string[]>([])
  const [compareResults, setCompareResults] = useState<CompareResult[]>([])
  const [comparing, setComparing] = useState(false)

  // Reset comparison state when selected model changes
  useEffect(() => {
    setCompareModelIds([selectedModelId])
    setCompareResults([])
  }, [selectedModelId])

  // Notify parent when comparing state changes
  useEffect(() => {
    onComparingChange?.(comparing)
  }, [comparing, onComparingChange])

  const compareRequestPreview = useMemo(() => JSON.stringify({
    models: compareModelIds,
    parameters: values,
    referenceFileIds: referenceFiles.map(file => file.id),
  }, null, 2), [compareModelIds, values, referenceFiles])

  const hasModel = Boolean(selectedModelId)

  function toggleCompareModel(modelId: string) {
    setCompareModelIds((prev) => {
      if (prev.includes(modelId))
        return prev.filter(id => id !== modelId)
      return [...prev, modelId]
    })
  }

  async function runComparison() {
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

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">同 prompt 多模型对比</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {categoryModels.map(model => (
              <label key={model.id} className="flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm">
                <Checkbox
                  className="mt-1"
                  checked={compareModelIds.includes(model.id)}
                  onCheckedChange={() => toggleCompareModel(model.id)}
                />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{model.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{model.id}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={comparing || !hasModel || compareModelIds.length < 2}
              onClick={() => runComparison()}
            >
              {comparing ? <Loader2 className="size-4 animate-spin" /> : <Beaker className="size-4" />}
              {comparing ? '对比中...' : '运行对比实验'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={compareModelIds.length < 2}
              onClick={() => copyToClipboard(compareRequestPreview)}
            >
              <Copy className="size-3" />
            </Button>
          </div>

          {compareModelIds.length < 2 && (
            <p className="text-xs text-muted-foreground">选择至少 2 个同分类模型后，可用当前 prompt 和参数并行提交对比。</p>
          )}
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
                    <OutputPreview output={item.record.outputResult} onPreview={onPreview} />
                  </div>
                )}
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}
