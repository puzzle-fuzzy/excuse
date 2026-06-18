/**
 * Canvas 管线控制器 — 渲染层
 *
 * 原 753 行单文件中"恢复 + auto + trigger"逻辑与渲染混在一起。
 * 现已将状态管理与业务逻辑抽取至 usePipelineController hook（~350 行），
 * 本文件退化为纯渲染层（~180 行）。
 */
import type { CanvasModelPreferences, ModelConfig, ProjectDTO } from '@excuse/shared'
import { statusToneClass, statusTextClass } from '@/lib/status-tokens'
import { usePipelineController } from './usePipelineController'
import type { PhaseDoneEvent, RunningPhaseInfo } from './usePipelineController'

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
    <div className="border-t bg-background/95 backdrop-blur-sm px-4 py-3">
      {/* Shot statistics */}
      {showShotStats && shotStats && (
        <div className="flex items-center gap-3 mb-2 text-xs">
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
              className={statusToneClass('warning', 'rounded border px-2 py-0.5 hover:opacity-90')}
            >
              重试全部失败镜头
            </button>
          )}
        </div>
      )}

      {/* Model selectors */}
      <div className="flex items-center gap-3 mb-2 text-xs">
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
      <div className="flex items-center gap-1 mb-2">
        {ctrl.PHASES.map((phase, idx) => {
          const isCompleted = idx < ctrl.startIdx
          const isCurrent = idx === ctrl.currentPhase
          const isFailed = idx === ctrl.failedPhaseIdx && ctrl.failedPhaseIdx >= 0
          const isPending = idx >= ctrl.startIdx && !isCurrent && !isFailed

          return (
            <div
              key={phase.key}
              className={`
                flex-1 h-2 rounded-full transition-colors
                ${isCompleted ? 'bg-[color:var(--status-success-fg)]' : ''}
                ${isCurrent ? 'bg-[color:var(--status-info-fg)] animate-pulse' : ''}
                ${isFailed ? 'bg-[color:var(--status-danger-fg)] animate-pulse' : ''}
                ${isPending ? 'bg-muted' : ''}
              `}
              title={phase.label}
            />
          )
        })}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 flex-wrap flex-1">
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
                className={`
                  text-xs px-2 py-1 rounded border transition-colors
                  ${isCompleted ? statusToneClass('success') : ''}
                  ${isCurrent ? statusToneClass('info', 'font-medium') : ''}
                  ${isFailed ? statusToneClass('danger', 'font-medium') : ''}
                  ${!isCompleted && !isCurrent && !isFailed ? 'bg-muted/50 border-border text-muted-foreground' : ''}
                  ${canRun && !ctrl.running ? 'hover:bg-accent cursor-pointer' : ''}
                `}
              >
                {phase.label}
                {phase.pauseBefore && ' ⏸'}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-2">
          {ctrl.pendingConfirmIdx >= 0 && !ctrl.running && (
            <div className="flex items-center gap-2 text-sm">
              <span className={statusTextClass('warning', 'font-medium')}>
                ⏸ 准备执行
                {ctrl.PHASES[ctrl.pendingConfirmIdx]?.label}
                ，请确认继续
              </span>
              <button
                onClick={ctrl.handleConfirmPausePhase}
                className="text-xs px-3 py-1.5 rounded bg-[color:var(--status-warning-fg)] text-primary-foreground hover:opacity-90 font-medium"
              >
                确认继续 →
                {ctrl.PHASES[ctrl.pendingConfirmIdx]?.label}
              </button>
              <button
                onClick={ctrl.handleCancelPausePhase}
                className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
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
              className={statusToneClass('danger', 'rounded border px-2 py-1 text-xs hover:opacity-90')}
            >
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
                className={statusToneClass('warning', 'rounded border px-2 py-1 text-xs hover:opacity-90')}
              >
                重试
              </button>
              {ctrl.startIdx + 1 < ctrl.PHASES.length && (
                <button
                  onClick={ctrl.handleSkipAndContinue}
                  className={statusToneClass('info', 'rounded border px-2 py-1 text-xs hover:opacity-90')}
                >
                  跳过继续
                </button>
              )}
            </div>
          )}

          {!ctrl.running && ctrl.pendingConfirmIdx < 0 && !ctrl.error && (
            <button
              onClick={ctrl.handleAutoRun}
              className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 font-medium"
            >
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
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="text-xs px-1.5 py-0.5 rounded border border-border bg-background text-foreground max-w-45"
      >
        <option value="">默认</option>
        {models.map(m => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>
    </label>
  )
}
