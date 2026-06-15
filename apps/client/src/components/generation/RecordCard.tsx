import type { CostDetail } from '@excuse/shared'
import type { GenerationRecord, ModelConfig } from '@/api/client'
import type { Category } from '@/lib/generation-utils'
import { isImageOutput, isVideoOutput } from '@excuse/shared'
import {
  Copy,
  Download,
  FileText,
  RotateCw,
  Trash2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { CATEGORY_CONFIG, formatDuration, formatTime, getAssetUrls, HIDDEN_PARAMS, STATUS_CONFIG } from '@/lib/generation-utils'
import CostDetailPanel from './CostDetailPanel'
import OutputPreview from './OutputPreview'
import ReferenceMedia from './ReferenceMedia'

interface RecordCardProps {
  record: GenerationRecord
  models: ModelConfig[]
  expanded: boolean
  copied: boolean
  onToggleExpand: (id: string) => void
  onCopyPrompt: (id: string, text: string) => void
  onRegenerate: (record: GenerationRecord) => void
  onDelete: (id: string) => void
  onPreview: (url: string) => void
}

export default function RecordCard({
  record,
  models,
  expanded,
  copied,
  onToggleExpand,
  onCopyPrompt,
  onRegenerate,
  onDelete,
  onPreview,
}: RecordCardProps) {
  const statusCfg = STATUS_CONFIG[record.status] || STATUS_CONFIG.pending
  const StatusIcon = statusCfg.icon
  const catCfg = CATEGORY_CONFIG[record.category as Category]
  const CatIcon = catCfg?.icon || FileText
  const modelConfig = models.find(m => m.id === record.model)
  const modelDisplayName = modelConfig?.name || record.model
  const prompt = String(record.inputParams?.prompt || '')
  const visibleParams = Object.entries(record.inputParams || {}).filter(
    ([k, v]) => !HIDDEN_PARAMS.has(k) && v != null && v !== '' && v !== undefined,
  )
  const isPending = record.status === 'pending' || record.status === 'submitting' || record.status === 'processing' || record.status === 'saving_output'
  const duration = formatDuration(record.createdAt, isPending ? null : record.updatedAt)
  const providerCancelLabel = {
    no_task: '本地已取消，尚未提交到 provider',
    requested: '已请求 provider 取消',
    succeeded: 'provider 已确认取消',
    failed: 'provider 取消失败，后续结果会被忽略',
    not_requested: null,
  }[record.providerCancelStatus ?? 'not_requested']

  // 获取下载用的 URLs（image 或 video 输出）
  const downloadUrls = record.outputResult
    && (isImageOutput(record.outputResult) || isVideoOutput(record.outputResult))
    ? getAssetUrls(record.outputResult)
    : null

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-3">
        {/* 头部：模型名 + 状态 + 时间 */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <CatIcon className={`size-4 shrink-0 ${catCfg?.color?.replace('bg-', 'text-')}`} />
            <span className="text-sm font-medium truncate">{modelDisplayName}</span>
            <Badge variant="secondary" className={`text-[10px] shrink-0 ${statusCfg.color}`}>
              <StatusIcon className={`mr-1 size-3 ${['submitting', 'processing', 'saving_output'].includes(record.status) ? 'animate-spin' : ''}`} />
              {statusCfg.label}
            </Badge>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {(isPending || record.status === 'succeeded') && (
              <span className={`text-[10px] text-muted-foreground ${isPending ? 'animate-pulse' : ''}`}>
                {duration}
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {formatTime(record.createdAt)}
            </span>
          </div>
        </div>

        {/* Prompt */}
        {prompt && (
          <div className="mt-2">
            <div className="flex items-center gap-1">
              <p className={`flex-1 text-xs text-muted-foreground ${expanded ? '' : 'line-clamp-2'}`}>
                {prompt}
              </p>
              <div className="flex shrink-0 gap-0.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-6 p-0 text-muted-foreground hover:text-foreground"
                  onClick={() => onCopyPrompt(record.id, prompt)}
                  title="复制提示词"
                >
                  <Copy className="size-3" />
                </Button>
                {prompt.length > 80 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="size-6 p-0 text-muted-foreground hover:text-foreground"
                    onClick={() => onToggleExpand(record.id)}
                  >
                    {expanded ? '收起' : '展开'}
                  </Button>
                )}
              </div>
            </div>
            {copied && (
              <p className="text-[10px] text-green-600">已复制</p>
            )}
          </div>
        )}

        {/* 参数标签 */}
        {visibleParams.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {visibleParams.map(([key, val]) => (
              <Badge key={key} variant="outline" className="text-[10px]">
                {key}
                :
                {String(val).slice(0, 30)}
              </Badge>
            ))}
          </div>
        )}

        {/* 费用明细 */}
        {record.cost && (
          <div className="mt-1.5">
            <CostDetailPanel cost={record.cost as CostDetail} />
          </div>
        )}

        {/* 参考素材 */}
        <ReferenceMedia inputParams={record.inputParams} />

        {/* 输出预览 */}
        {record.outputResult && (
          <div className="mt-2">
            <OutputPreview output={record.outputResult} onPreview={onPreview} />
          </div>
        )}

        {/* 错误信息 */}
        {record.status === 'failed' && record.errorMessage && (
          <p className="mt-2 text-xs text-destructive">{record.errorMessage}</p>
        )}

        {record.status === 'cancelled' && providerCancelLabel && (
          <p className="mt-2 text-xs text-muted-foreground">{providerCancelLabel}</p>
        )}

        {/* 操作按钮 */}
        <div className="mt-2 flex gap-2">
          {downloadUrls && downloadUrls.map((url, i) => (
            <Button key={url} variant="outline" size="sm" asChild>
              <a href={url} download>
                <Download className="size-3" />
                {downloadUrls.length > 1 ? `下载 ${i + 1}` : '下载'}
              </a>
            </Button>
          ))}
          {record.status === 'failed' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onRegenerate(record)}
            >
              <RotateCw className="size-3" />
              重新生成
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(record.id)}
          >
            <Trash2 className="size-3" />
            删除
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
