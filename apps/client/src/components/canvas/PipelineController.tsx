/**
 * Canvas 管线控制器 — 渲染层
 *
 * 原 753 行单文件中"恢复 + auto + trigger"逻辑与渲染混在一起。
 * 现已将状态管理与业务逻辑抽取至 usePipelineController hook（~350 行），
 * 本文件退化为纯渲染层（~180 行）。
 */
import type { CanvasModelPreferences, ModelConfig, ProjectDTO } from '@excuse/shared'
import type { PhaseDoneEvent, RunningPhaseInfo } from './usePipelineController'
import { Play, Square } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { statusTextClass, statusToneClass } from '@/lib/status-tokens'
import { cn } from '@/lib/utils'
import { usePipelineController } from './usePipelineController'

// Re-export for backward compatibility (consumed by CanvasEditor, nodes, RunningOverlay)
export type { PhaseDoneEvent, RunningPhaseInfo }

interface Props {
  projectId: string
  project: ProjectDTO
  modelPreferences: CanvasModelPreferences | null
  onPhaseComplete: (project?: ProjectDTO) => void
  onPhaseChange?: (info: RunningPhaseInfo | null) => void
  phaseDone: PhaseDoneEvent | null
  onPhaseDoneConsumed: () => void
}

export default function PipelineController(props: Props) {
  const ctrl = usePipelineController(props)

  const { projectStatus, showShotStats, shotStats, hasFailedShots } = ctrl

  return (
    <div className="border-t bg-background/95 px-4 py-3 shadow-[var(--shadow-docked)] backdrop-blur-sm">
      {/* Shot statistics */}
      {showShotStats && shotStats && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border bg-muted/25 px-3 py-2 text-xs">
          <span className="text-muted-foreground">
            总镜头:
            {' '}
            {shotStats.total}
          </span>
          <span className={statusTextClass('success')}>
            已完成:
            {' '}
            {shotStats.completed}
          </span>
          <span className={statusTextClass('danger')}>
            失败:
            {' '}
            {shotStats.failed}
          </span>
          <span className={statusTextClass('warning')}>
            生成中:
            {' '}
            {shotStats.generating}
          </span>
          {projectStatus === 'partial_failed' && hasFailedShots && (
            <button
              onClick={ctrl.handleRetryAllFailed}
              disabled={ctrl.running}
              className={statusToneClass('warning', 'rounded-md border px-2 py-1 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60')}
            >
              重试全部失败镜头
            </button>
          )}
        </div>
      )}

      {/* Model selectors */}
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
        <ModelSelect
          label="文本模型"
          models={ctrl.textModels}
          value={ctrl.prefs.textModel || ''}
          onChange={v => ctrl.handleModelChange('textModel', v)}
          disabled={ctrl.running}
        />
        <ModelSelect
          label="图像模型"
          models={ctrl.imageModels}
          value={ctrl.prefs.imageModel || ''}
          onChange={v => ctrl.handleModelChange('imageModel', v)}
          disabled={ctrl.running}
        />
      </div>

      {/* Phase progress bar */}
      <div className="mb-3 flex items-center gap-1">
        {ctrl.PHASES.map((phase, idx) => {
          const isCompleted = idx < ctrl.startIdx
          const isCurrent = idx === ctrl.currentPhase
          const isFailed = idx === ctrl.failedPhaseIdx && ctrl.failedPhaseIdx >= 0
          const isPending = idx >= ctrl.startIdx && !isCurrent && !isFailed

          return (
            <div
              key={phase.key}
              className={cn(
                'h-2 flex-1 rounded-full transition-colors',
                isCompleted && 'bg-[color:var(--status-success-fg)]',
                isCurrent && 'animate-pulse bg-[color:var(--status-info-fg)]',
                isFailed && 'animate-pulse bg-[color:var(--status-danger-fg)]',
                isPending && 'bg-muted',
              )}
              title={phase.label}
            />
          )
        })}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-1 flex-wrap gap-1.5">
          {ctrl.PHASES.map((phase, idx) => {
            const isCompleted = idx < ctrl.startIdx
            const isCurrent = idx === ctrl.currentPhase
            const isFailed = idx === ctrl.failedPhaseIdx && ctrl.failedPhaseIdx >= 0
            const canRun = idx === ctrl.startIdx || isCurrent || isFailed

            return (
              <button
                key={phase.key}
                onClick={() => canRun && ctrl.handleRunFrom(idx)}
                disabled={ctrl.running || (!canRun && !isCompleted)}
                className={cn(
                  'rounded-lg border px-2.5 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-65',
                  isCompleted && statusToneClass('success'),
                  isCurrent && statusToneClass('info', 'font-medium'),
                  isFailed && statusToneClass('danger', 'font-medium'),
                  !isCompleted && !isCurrent && !isFailed && 'border-border bg-muted/50 text-muted-foreground',
                  canRun && !ctrl.running && 'cursor-pointer hover:bg-accent',
                )}
              >
                {phase.label}
                {phase.pauseBefore && ' · 确认'}
              </button>
            )
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {ctrl.pendingConfirmIdx >= 0 && !ctrl.running && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-[color:var(--status-warning-bg)] px-3 py-2 text-sm">
              <span className={statusTextClass('warning', 'font-medium')}>
                准备执行
                {ctrl.PHASES[ctrl.pendingConfirmIdx]?.label}
                ，请确认继续
              </span>
              <button
                onClick={ctrl.handleConfirmPausePhase}
                className="rounded-md bg-[color:var(--status-warning-fg)] px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
              >
                确认继续
                {ctrl.PHASES[ctrl.pendingConfirmIdx]?.label}
              </button>
              <button
                onClick={ctrl.handleCancelPausePhase}
                className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-background hover:text-foreground"
              >
                暂不执行
              </button>
            </div>
          )}

          {ctrl.running && ctrl.currentPhaseInfo && (
            <span className={statusTextClass('info', 'text-xs font-medium animate-pulse')}>
              正在
              {ctrl.currentPhaseInfo.label}
              {ctrl.currentPhaseInfo.modelName && ` · ${ctrl.currentPhaseInfo.modelName}`}
              ...
            </span>
          )}
          {ctrl.running && ctrl.currentPhaseInfo && ctrl.elapsed > 0 && (
            <span className="text-xs text-muted-foreground">
              已耗时
              {' '}
              {ctrl.elapsed}
              s
            </span>
          )}
          {ctrl.running && !ctrl.currentPhaseInfo && (
            <span className="text-xs text-muted-foreground">
              执行中...
            </span>
          )}
          {ctrl.running && (
            <button
              onClick={ctrl.handleCancelActive}
              className={statusToneClass('danger', 'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs hover:opacity-90')}
            >
              <Square className="size-3.5" />
              终止当前阶段
            </button>
          )}

          {ctrl.error && (
            <div className="flex items-center gap-2">
              <span className={statusTextClass('danger', 'text-xs max-w-50 truncate')} title={ctrl.error}>
                {ctrl.error}
              </span>
              <button
                onClick={() => ctrl.handleRunFrom(ctrl.failedPhaseIdx >= 0 ? ctrl.failedPhaseIdx : ctrl.startIdx)}
                className={statusToneClass('warning', 'rounded-lg border px-2.5 py-1.5 text-xs hover:opacity-90')}
              >
                重试
              </button>
              {ctrl.startIdx + 1 < ctrl.PHASES.length && (
                <button
                  onClick={ctrl.handleSkipAndContinue}
                  className={statusToneClass('info', 'rounded-lg border px-2.5 py-1.5 text-xs hover:opacity-90')}
                >
                  跳过继续
                </button>
              )}
            </div>
          )}

          {!ctrl.running && ctrl.pendingConfirmIdx < 0 && !ctrl.error && (
            <button
              onClick={ctrl.handleAutoRun}
              className="brand-cta inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
            >
              <Play className="size-3.5" />
              自动执行全部
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── ModelSelect 子组件 ──────────────────────────────────────

function ModelSelect({ label, models, value, onChange, disabled }: {
  label: string
  models: ModelConfig[]
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  return (
    <label className="flex items-center gap-1.5 text-muted-foreground">
      <span>{label}</span>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger size="sm" className="h-7 max-w-45 gap-1 border-border px-2 text-xs text-foreground">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">默认</SelectItem>
          {models.map(m => (
            <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}
