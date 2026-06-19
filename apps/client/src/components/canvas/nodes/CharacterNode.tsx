import type { CharacterDTO } from '@excuse/shared'
import type { NodeProps } from '@xyflow/react'
import type { RunningPhaseInfo } from '../PipelineController'
import { Handle, Position } from '@xyflow/react'
import { statusBadgeClass, statusTextClass } from '@/lib/status-tokens'
import { RunningBadge, runningBorder, RunningOverlay } from '../RunningOverlay'

export default function CharacterNode({ data }: NodeProps) {
  const { character, isRunning, runningPhaseInfo, activeImageTaskIds } = data as { character: CharacterDTO, isRunning?: boolean, runningPhaseInfo?: RunningPhaseInfo | null, activeImageTaskIds?: string[] }
  const profile = character.profile
  const isGeneratingImage = (activeImageTaskIds?.length ?? 0) > 0

  return (
    <div className={`rounded-xl border-2 bg-card shadow-[var(--shadow-floating)] w-85 relative ${runningBorder(isRunning || isGeneratingImage, 'border-[color:var(--node-character)]')}`}>
      <Handle type="target" position={Position.Top} className="bg-[color:var(--node-character)]!" />
      <div className="bg-[color:var(--node-character)] text-white px-3 py-2 font-semibold text-sm flex items-center justify-between rounded-t-xl">
        <span>
          角色：
          {character.name}
        </span>
        <div className="flex items-center gap-1">
          {character.locked && <span className="text-[10px] bg-white/20 rounded px-1">锁定</span>}
          {character.role && <span className="text-[10px] bg-white/20 rounded px-1">{character.role}</span>}
          {isRunning && <RunningBadge label={runningPhaseInfo?.label} />}
          {isGeneratingImage && !isRunning && <span className={statusBadgeClass('warning', 'text-[10px] px-1 animate-pulse')}>生成中...</span>}
        </div>
      </div>
      {isRunning && <RunningOverlay runningPhaseInfo={runningPhaseInfo} />}
      <div className="p-3 space-y-2 text-sm">
        {/* 参考图 — 正在生成时显示占位 spinner */}
        {isGeneratingImage && !character.referenceImageUrl && (
          <div className="w-full h-35 rounded border border-border bg-muted flex items-center justify-center">
            <span className="text-muted-foreground text-xs animate-pulse">正在生成参考图...</span>
          </div>
        )}
        {character.referenceImageUrl && (
          <div className={isGeneratingImage ? 'relative' : ''}>
            <img
              src={character.referenceImageUrl}
              alt={character.name}
              className="w-full h-35 object-cover rounded border"
            />
            {isGeneratingImage && (
              <div className={statusBadgeClass('warning', 'absolute top-1 right-1 text-[10px] px-1 animate-pulse')}>
                生成中
              </div>
            )}
          </div>
        )}
        {/* 转面图 — 正在生成时显示占位 */}
        {isGeneratingImage && !character.turnaroundSheetUrl && (
          <div className="w-full h-25 rounded border border-border bg-muted flex items-center justify-center mt-0.5">
            <span className="text-muted-foreground text-xs animate-pulse">正在生成转面图...</span>
          </div>
        )}
        {character.turnaroundSheetUrl && (
          <div className={isGeneratingImage ? 'relative' : ''}>
            <span className="text-muted-foreground text-xs">转面图：</span>
            <img
              src={character.turnaroundSheetUrl}
              alt="转面图"
              className="w-full h-25 object-cover rounded border mt-0.5"
            />
            {isGeneratingImage && (
              <div className={statusBadgeClass('warning', 'absolute top-1 right-1 text-[10px] px-1 animate-pulse')}>
                生成中
              </div>
            )}
          </div>
        )}

        {/* Profile 摘要 */}
        {profile && (
          <div className="space-y-1 text-xs">
            <div>
              <span className="text-muted-foreground">外貌：</span>
              {profile.gender}
              ，
              {profile.age}
              ，
              {profile.bodyShape}
              ，
              {profile.height}
            </div>
            <div>
              <span className="text-muted-foreground">面部：</span>
              {profile.face.shape}
              脸，
              {profile.face.eyes}
              ，
              {profile.face.skin}
            </div>
            <div>
              <span className="text-muted-foreground">发型：</span>
              {profile.hair.color}
              {profile.hair.style}
              （
              {profile.hair.length}
              ）
            </div>
            <div>
              <span className="text-muted-foreground">服装：</span>
              {profile.costume.mainColor}
              {profile.costume.style}
              （
              {profile.costume.material}
              ）
            </div>
            {profile.accessories.length > 0 && (
              <div>
                <span className="text-muted-foreground">配饰：</span>
                {profile.accessories.join('、')}
              </div>
            )}
          </div>
        )}

        {/* identityPrompt */}
        {character.identityPrompt && (
          <div>
            <span className="text-muted-foreground text-xs">Identity Prompt：</span>
            <p className="text-xs bg-muted rounded p-2 mt-0.5 max-h-20 overflow-auto">
              {character.identityPrompt}
            </p>
          </div>
        )}

        {/* negativePrompt */}
        {character.negativePrompt && (
          <div>
            <span className="text-muted-foreground text-xs">Negative Prompt：</span>
            <p className={statusTextClass('danger', 'text-xs bg-muted rounded p-2 mt-0.5 max-h-15 overflow-auto')}>
              {character.negativePrompt}
            </p>
          </div>
        )}

        {/* Dev mode: full profileJson */}
        <details className="mt-2">
          <summary className="text-xs text-muted-foreground cursor-pointer">完整 Profile JSON</summary>
          <pre className="text-[10px] bg-muted rounded p-2 mt-1 max-h-75 overflow-auto whitespace-pre-wrap">
            {JSON.stringify(profile, null, 2)}
          </pre>
        </details>
      </div>
      <Handle type="source" position={Position.Bottom} className="bg-[color:var(--node-character)]!" />
    </div>
  )
}
