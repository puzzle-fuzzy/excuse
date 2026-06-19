import type { ProjectDTO, ShotDTO } from '@excuse/shared'
import type { NodeProps } from '@xyflow/react'
import type { RunningPhaseInfo } from '../PipelineController'
import { hasDialogueAudio } from '@excuse/shared'
import { Handle, Position } from '@xyflow/react'
import { SHOT_STATUS_TONES, statusBadgeClass, statusToneClass } from '@/lib/status-tokens'
import { RunningBadge, runningBorder, RunningOverlay } from '../RunningOverlay'

const SHOT_STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  ready: '就绪',
  generating: '生成中',
  completed: '已完成',
  failed: '失败',
}

export default function ShotNode({ data }: NodeProps) {
  const { shot, project, isRunning, runningPhaseInfo } = data as { shot: ShotDTO, project: ProjectDTO, isRunning?: boolean, runningPhaseInfo?: RunningPhaseInfo | null }

  const camera = shot.camera
  const continuity = shot.continuity
  const environment = shot.environment

  // Find related character/location names
  const charNames = shot.characterIds
    .map(id => project.characters.find(c => c.id === id)?.name)
    .filter(Boolean)
  const locName = shot.locationId
    ? project.locations.find(l => l.id === shot.locationId)?.name
    : null

  // 镜头是否含角色对白（启发式，驱动音频指示器）
  const hasDialogue = hasDialogueAudio(shot.narrative)

  return (
    <div className={`rounded-xl border-2 bg-card shadow-[var(--shadow-floating)] w-85 relative ${runningBorder(isRunning, 'border-[color:var(--node-shot)]')}`}>
      <Handle type="target" position={Position.Top} className="bg-[color:var(--node-shot)]!" />
      <div className="bg-[color:var(--node-shot)] text-white px-3 py-2 font-semibold text-sm flex items-center justify-between rounded-t-xl">
        <span>
          镜头
          {shot.shotIndex + 1}
        </span>
        {isRunning
          ? (
              <RunningBadge label={runningPhaseInfo?.label} />
            )
          : (
              <span className={statusBadgeClass(SHOT_STATUS_TONES[shot.status] ?? 'neutral', 'text-[10px]')}>
                {SHOT_STATUS_LABELS[shot.status] || shot.status}
              </span>
            )}
      </div>
      {isRunning && <RunningOverlay runningPhaseInfo={runningPhaseInfo} />}
      <div className="p-3 space-y-2 text-sm">
        {/* 基本信息 */}
        <div className="text-xs space-y-1">
          <div className="flex items-center gap-2">
            <span>
              <span className="text-muted-foreground">时长：</span>
              {shot.duration}
              秒
            </span>
            <span
              className={statusBadgeClass(hasDialogue ? 'success' : 'neutral', 'text-[10px] px-1.5')}
              title={hasDialogue ? '本镜头含角色对白，生成的视频带对话音频' : '本镜头无角色对白，仅环境音'}
            >
              {hasDialogue ? '🔊 对话音频' : '🔇 无对白'}
            </span>
          </div>
          {locName && (
            <div>
              <span className="text-muted-foreground">场景：</span>
              {locName}
            </div>
          )}
          {charNames.length > 0 && (
            <div>
              <span className="text-muted-foreground">角色：</span>
              {charNames.join('、')}
            </div>
          )}
        </div>

        {/* 叙事 */}
        <div>
          <span className="text-muted-foreground text-xs">叙事：</span>
          <p className="text-xs bg-muted rounded p-2 mt-0.5 max-h-15 overflow-auto">
            {shot.narrative}
          </p>
        </div>

        {/* 摄像 */}
        <div className="text-xs">
          <span className="text-muted-foreground">摄像：</span>
          {camera.shotSize}
          ，
          {camera.angle}
          ，
          {camera.movement}
          ，
          {camera.lens}
        </div>

        {/* 时间线 */}
        {shot.timeline && shot.timeline.length > 0 && (
          <div>
            <span className="text-muted-foreground text-xs">逐秒时间线：</span>
            <div className="text-xs bg-muted rounded p-2 mt-0.5 max-h-25 overflow-auto space-y-0.5">
              {shot.timeline.map(entry => (
                <div key={entry.time}>
                  <span className="font-mono text-muted-foreground">
                    {entry.time}
                    :
                  </span>
                  {' '}
                  {entry.action}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 连续性 */}
        {continuity && (
          <div className="text-xs space-y-0.5">
            <span className="text-muted-foreground">连续性：</span>
            {continuity.emotionStart && (
              <div>
                情绪：
                {String(continuity.emotionStart)}
                {' '}
                →
                {' '}
                {String(continuity.emotionEnd)}
              </div>
            )}
            {continuity.actionStart && (
              <div>
                动作：
                {String(continuity.actionStart)}
                {' '}
                →
                {' '}
                {String(continuity.actionEnd)}
              </div>
            )}
          </div>
        )}

        {/* 环境 */}
        {environment && (
          <div className="text-xs space-y-0.5">
            <span className="text-muted-foreground">环境：</span>
            {environment.lighting && (
              <div>
                灯光：
                {environment.lighting}
              </div>
            )}
            {environment.mood && (
              <div>
                情绪：
                {environment.mood}
              </div>
            )}
            {environment.backgroundMotion && (
              <div>
                背景运动：
                {environment.backgroundMotion}
              </div>
            )}
          </div>
        )}

        {/* 视频 Prompt */}
        {shot.videoPrompt && (
          <div>
            <span className="text-muted-foreground text-xs">视频提示词：</span>
            <p className="text-xs bg-muted rounded p-2 mt-0.5 max-h-20 overflow-auto">
              {shot.videoPrompt}
            </p>
          </div>
        )}

        {/* 负面 Prompt */}
        {shot.negativePrompt && (
          <div>
            <span className="text-muted-foreground text-xs">负面提示词：</span>
            <p className="text-xs bg-muted rounded p-2 mt-0.5 max-h-15 overflow-auto text-[color:var(--status-danger-fg)]">
              {shot.negativePrompt}
            </p>
          </div>
        )}

        {/* 视频 */}
        {shot.videoUrl && (
          <div>
            <span className="text-muted-foreground text-xs">生成视频：</span>
            <video
              src={shot.videoUrl}
              controls
              className="w-full rounded border mt-0.5"
            />
          </div>
        )}

        {/* 错误 */}
        {shot.errorMessage && (
          <div className={statusToneClass('danger', 'rounded border p-2 text-xs')}>
            {shot.errorMessage}
          </div>
        )}

        {/* Dev mode: raw JSON */}
        <details className="mt-2">
          <summary className="text-xs text-muted-foreground cursor-pointer">原始 JSON 数据</summary>
          <pre className="text-[10px] bg-muted rounded p-2 mt-1 max-h-75 overflow-auto whitespace-pre-wrap">
            {JSON.stringify(shot, null, 2)}
          </pre>
        </details>
      </div>
      <Handle type="source" position={Position.Bottom} className="bg-[color:var(--node-shot)]!" />
    </div>
  )
}
