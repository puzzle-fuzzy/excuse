import type { RunningPhaseInfo } from './PipelineController'
import { statusBadgeClass } from '@/lib/status-tokens'

interface RunningOverlayProps {
  label?: string
  runningPhaseInfo?: RunningPhaseInfo | null
}

export function RunningOverlay({ label, runningPhaseInfo }: RunningOverlayProps) {
  const displayLabel = label
    || (runningPhaseInfo
      ? `正在${runningPhaseInfo.label}${runningPhaseInfo.modelName ? ` · ${runningPhaseInfo.modelName}` : ''}...`
      : '正在生成...')
  return (
    <div className="absolute inset-0 bg-background/50 flex items-center justify-center rounded-lg pointer-events-none">
      <div className={statusBadgeClass('warning', 'px-3 py-1.5 shadow animate-pulse')}>
        {displayLabel}
      </div>
    </div>
  )
}

/** 返回节点边框样式：运行中显示黄色高亮，否则使用默认颜色 */
export function runningBorder(isRunning: boolean | undefined, defaultBorder: string): string {
  return isRunning ? 'border-[color:var(--status-warning-border)] ring-2 ring-[color:var(--status-warning-bg)]' : defaultBorder
}

/** 运行中的标签 badge */
export function RunningBadge({ label }: { label?: string } = {}) {
  return (
    <span className={statusBadgeClass('warning', 'text-[10px] px-1.5 animate-pulse')}>{label || '生成中'}</span>
  )
}
