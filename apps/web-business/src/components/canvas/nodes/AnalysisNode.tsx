import type { ProjectDTO } from '@excuse/shared'
import type { NodeProps } from '@xyflow/react'
import type { RunningPhaseInfo } from '../PipelineController'
import { Handle, Position } from '@xyflow/react'
import { RunningBadge, runningBorder, RunningOverlay } from '../RunningOverlay'

export default function AnalysisNode({ data }: NodeProps) {
  const { project, isRunning, runningPhaseInfo } = data as { project: ProjectDTO, isRunning?: boolean, runningPhaseInfo?: RunningPhaseInfo | null }
  const analysis = project.analysis

  return (
    <div className={`rounded-lg border-2 bg-emerald-50 shadow-md w-85 relative ${runningBorder(isRunning, 'border-emerald-400')}`}>
      <Handle type="target" position={Position.Top} className="bg-emerald-400!" />
      <div className="bg-emerald-400 text-white px-3 py-2 font-semibold text-sm flex items-center justify-between rounded-t-md">
        <span>故事分析</span>
        {isRunning && <RunningBadge label={runningPhaseInfo?.label} />}
      </div>
      {isRunning && <RunningOverlay runningPhaseInfo={runningPhaseInfo} />}
      <div className="p-3 space-y-2 text-sm">
        {analysis
          ? (
              <>
                <div>
                  <span className="text-muted-foreground">摘要：</span>
                  <p className="text-xs mt-0.5">{analysis.summary}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">核心冲突：</span>
                  <p className="text-xs mt-0.5">{analysis.mainConflict}</p>
                </div>
                {analysis.timeline.length > 0 && (
                  <div>
                    <span className="text-muted-foreground">时间线：</span>
                    <ul className="text-xs mt-0.5 list-disc pl-4 space-y-0.5">
                      {analysis.timeline.map(t => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">角色：</span>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {analysis.characterNames.map(name => (
                      <span key={name} className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs">{name}</span>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">场景：</span>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {analysis.sceneNames.map(name => (
                      <span key={name} className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs">{name}</span>
                    ))}
                  </div>
                </div>
                {/* Dev mode: raw JSON */}
                <details className="mt-2">
                  <summary className="text-xs text-muted-foreground cursor-pointer">原始 JSON</summary>
                  <pre className="text-[10px] bg-white rounded p-2 mt-1 max-h-50 overflow-auto whitespace-pre-wrap">
                    {JSON.stringify(analysis, null, 2)}
                  </pre>
                </details>
              </>
            )
          : (
              <p className="text-xs text-muted-foreground">等待分析...</p>
            )}
      </div>
      <Handle type="source" position={Position.Bottom} className="bg-emerald-400!" />
    </div>
  )
}
