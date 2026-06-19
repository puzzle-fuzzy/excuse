import type { LocationDTO } from '@excuse/shared'
import type { NodeProps } from '@xyflow/react'
import type { RunningPhaseInfo } from '../PipelineController'
import { Handle, Position } from '@xyflow/react'
import { statusBadgeClass, statusTextClass } from '@/lib/status-tokens'
import { RunningBadge, runningBorder, RunningOverlay } from '../RunningOverlay'

export default function LocationNode({ data }: NodeProps) {
  const { location, isRunning, runningPhaseInfo, activeImageTaskIds } = data as { location: LocationDTO, isRunning?: boolean, runningPhaseInfo?: RunningPhaseInfo | null, activeImageTaskIds?: string[] }
  const profile = location.profile
  const isGeneratingImage = (activeImageTaskIds?.length ?? 0) > 0

  return (
    <div className={`rounded-xl border-2 bg-card shadow-[var(--shadow-floating)] w-85 relative ${runningBorder(isRunning || isGeneratingImage, 'border-[color:var(--node-location)]')}`}>
      <Handle type="target" position={Position.Top} className="bg-[color:var(--node-location)]!" />
      <div className="bg-[color:var(--node-location)] text-white px-3 py-2 font-semibold text-sm flex items-center justify-between rounded-t-xl">
        <span>
          场景：
          {location.name}
        </span>
        <div className="flex items-center gap-1">
          {location.locked && <span className="text-[10px] bg-white/20 rounded px-1">锁定</span>}
          <span className="text-[10px] bg-white/20 rounded px-1">{location.type}</span>
          {isRunning && <RunningBadge label={runningPhaseInfo?.label} />}
          {isGeneratingImage && !isRunning && <span className={statusBadgeClass('warning', 'text-[10px] px-1 animate-pulse')}>生成中...</span>}
        </div>
      </div>
      {isRunning && <RunningOverlay runningPhaseInfo={runningPhaseInfo} />}
      <div className="p-3 space-y-2 text-sm">
        {/* 参考图 — 正在生成时显示占位 spinner */}
        {isGeneratingImage && !location.referenceImageUrl && (
          <div className="w-full h-35 rounded border border-border bg-muted flex items-center justify-center">
            <span className="text-muted-foreground text-xs animate-pulse">正在生成参考图...</span>
          </div>
        )}
        {location.referenceImageUrl && (
          <div className={isGeneratingImage ? 'relative' : ''}>
            <img
              src={location.referenceImageUrl}
              alt={location.name}
              className="w-full h-35 object-cover rounded border"
            />
            {isGeneratingImage && (
              <div className={statusBadgeClass('warning', 'absolute top-1 right-1 text-[10px] px-1 animate-pulse')}>
                生成中
              </div>
            )}
          </div>
        )}

        {profile && (
          <div className="space-y-1 text-xs">
            <div>
              <span className="text-muted-foreground">位置：</span>
              {profile.location}
              ，
              {profile.era}
            </div>
            <div>
              <span className="text-muted-foreground">氛围：</span>
              {profile.atmosphere}
            </div>
            <div>
              <span className="text-muted-foreground">色板：</span>
              {profile.visualRules.colorPalette.join('、')}
            </div>
            <div>
              <span className="text-muted-foreground">灯光：</span>
              {profile.visualRules.lighting}
            </div>
            <div>
              <span className="text-muted-foreground">建筑：</span>
              {profile.visualRules.architecture}
            </div>
            <div>
              <span className="text-muted-foreground">地面：</span>
              {profile.visualRules.floor}
            </div>
            {profile.visualRules.backgroundElements.length > 0 && (
              <div>
                <span className="text-muted-foreground">背景元素：</span>
                {profile.visualRules.backgroundElements.join('、')}
              </div>
            )}
            <div className="border-t pt-1 mt-1">
              <span className="text-muted-foreground">摄像规则：</span>
              <div className="mt-0.5">
                轴线：
                {profile.cameraRules.axisDirection}
              </div>
              <div>
                允许：
                {profile.cameraRules.allowedAngles.join('、')}
              </div>
              {profile.cameraRules.forbiddenAngles.length > 0 && (
                <div className={statusTextClass('danger')}>
                  禁止：
                  {profile.cameraRules.forbiddenAngles.join('、')}
                </div>
              )}
            </div>
          </div>
        )}

        {/* scenePrompt */}
        {location.scenePrompt && (
          <div>
            <span className="text-muted-foreground text-xs">Scene Prompt：</span>
            <p className="text-xs bg-muted rounded p-2 mt-0.5 max-h-20 overflow-auto">
              {location.scenePrompt}
            </p>
          </div>
        )}

        {/* negativePrompt */}
        {location.negativePrompt && (
          <div>
            <span className="text-muted-foreground text-xs">Negative Prompt：</span>
            <p className={statusTextClass('danger', 'text-xs bg-muted rounded p-2 mt-0.5 max-h-15 overflow-auto')}>
              {location.negativePrompt}
            </p>
          </div>
        )}

        {/* Dev mode */}
        <details className="mt-2">
          <summary className="text-xs text-muted-foreground cursor-pointer">完整 Profile JSON</summary>
          <pre className="text-[10px] bg-muted rounded p-2 mt-1 max-h-75 overflow-auto whitespace-pre-wrap">
            {JSON.stringify(profile, null, 2)}
          </pre>
        </details>
      </div>
      <Handle type="source" position={Position.Bottom} className="bg-[color:var(--node-location)]!" />
    </div>
  )
}
