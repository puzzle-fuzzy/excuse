import type { CanvasModelPreferences, CanvasPipelinePhase, CanvasProjectStatus, ModelConfig, ProjectDTO } from '@excuse/shared'
import { CANVAS_PAUSE_BEFORE, CANVAS_PHASE_ORDER } from '@excuse/shared'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { statusTextClass, statusToneClass } from '@/lib/status-tokens'
import {
  analyzeCanvasProject,
  assembleCanvas,
  cancelCanvasActivePhase,
  checkCanvasContinuity,
  fetchCanvasPipelineRuns,
  fetchModels,
  generateCanvasBgm,
  generateCanvasCharacterRefs,
  generateCanvasCharacters,
  generateCanvasDialogue,
  generateCanvasLocationRefs,
  generateCanvasLocations,
  generateCanvasStoryboard,
  generateCanvasVideos,
  rebuildCanvasPrompts,
  retryFailedCanvasShots,
  updateCanvasModelPreferences,
} from '../../api/client'
import { useCanvasPipelineRunsPolling } from '../../hooks/use-canvas-pipeline-runs-polling'

// ── RunningPhaseInfo: 管线阶段运行时的丰富信息 ──────────

export interface RunningPhaseInfo {
  key: string // 'analyze', 'characters', ...
  label: string // '分析故事', '生成角色', ...
  modelCategory: 'text' | 'image' | 'video' | null
  modelName: string | null // 解析后的中文显示名，如 '千问 3.7 Plus'
}

// ── 默认模型 ID（与后端 service-helpers.ts 对齐）──────────

const DEFAULT_MODEL_IDS: Record<string, string> = {
  text: 'qwen3.7-plus',
  image: 'qwen-image-2.0-pro',
  video: 'happyhorse-1.0',
}

function resolveModelDisplayName(
  category: 'text' | 'image' | 'video' | null,
  prefs: CanvasModelPreferences,
  models: ModelConfig[],
): string | null {
  if (!category)
    return null // continuity 阶段无模型
  const prefKey = `${category}Model` as 'textModel' | 'imageModel' | 'videoModel'
  const modelId = prefs[prefKey] || DEFAULT_MODEL_IDS[category]
  const config = models.find(m => m.id === modelId)
  return config?.name || modelId // 兜底显示原始 ID
}

// ── PHASES 元数据 ──────────────────────────────────────
// 阶段顺序与 pauseBefore 全部从 @excuse/shared 的单一注册表派生；
// 新增阶段只在 PHASE_UI 补一项（Record 强制覆盖全部阶段，漏一个即编译失败）。

interface PipelinePhase {
  key: CanvasPipelinePhase
  label: string
  status: CanvasProjectStatus | null
  run: (projectId: string) => Promise<unknown>
  pauseBefore: boolean
  modelCategory: 'text' | 'image' | 'video' | null
}

/** UI 元数据按阶段键索引（Record<CanvasPipelinePhase, ...> 强制覆盖全部阶段） */
const PHASE_UI: Record<CanvasPipelinePhase, Omit<PipelinePhase, 'key' | 'pauseBefore'>> = {
  analyze: { label: '分析故事', status: 'analyzed', run: analyzeCanvasProject, modelCategory: 'text' },
  characters: { label: '生成角色', status: 'characters_ready', run: generateCanvasCharacters, modelCategory: 'text' },
  locations: { label: '生成场景', status: 'locations_ready', run: generateCanvasLocations, modelCategory: 'text' },
  characterRefs: { label: '角色参考图', status: 'refs_ready', run: generateCanvasCharacterRefs, modelCategory: 'image' },
  locationRefs: { label: '场景参考图', status: null, run: generateCanvasLocationRefs, modelCategory: 'image' },
  storyboard: { label: '生成分镜', status: 'storyboard_ready', run: generateCanvasStoryboard, modelCategory: 'text' },
  continuity: { label: '连续性检查', status: 'continuity_checked', run: checkCanvasContinuity, modelCategory: null },
  rebuild: { label: '重建 Prompt', status: 'prompts_ready', run: rebuildCanvasPrompts, modelCategory: 'text' },
  dialogue: { label: '对白层', status: null, run: generateCanvasDialogue, modelCategory: 'text' },
  videos: { label: '生成视频', status: 'generating', run: generateCanvasVideos, modelCategory: 'video' },
  bgm: { label: '生成配乐', status: null, run: generateCanvasBgm, modelCategory: null },
  assemble: { label: '合成成片', status: null, run: assembleCanvas, modelCategory: null },
}

const PHASES: PipelinePhase[] = CANVAS_PHASE_ORDER.map(key => ({
  key,
  ...PHASE_UI[key],
  pauseBefore: CANVAS_PAUSE_BEFORE.has(key),
}))

/**
 * 项目状态 → 流水线恢复索引（点击「自动执行」/刷新后从哪个阶段开始）。
 *
 * 注意：dialogue / bgm / assemble 没有独立的 project status，都落在
 * `generating → completed` 区间。status 只能把索引定位到该区间起点（videos），
 * 这三者是否「进行中/已完成」以活跃 pipeline run 的 phase 为准（见下方 restore
 * 逻辑），而非 project.status。
 */
function getPhaseIndex(status: CanvasProjectStatus): number {
  const map: Record<string, number> = {
    draft: 0,
    analyzed: 1,
    characters_ready: 2,
    locations_ready: 3,
    refs_ready: 4,
    refs_all_ready: 5,
    storyboard_ready: 6,
    continuity_checked: 7,
    prompts_ready: 8,
    generating: 9,
    partial_failed: 9,
    completed: CANVAS_PHASE_ORDER.length,
    failed: 0,
  }
  return map[status] ?? 0
}

interface PhaseDoneEvent {
  projectId: string
  key: string
  status: 'completed' | 'failed'
  error?: string
}

interface Props {
  projectId: string
  project: ProjectDTO
  modelPreferences: CanvasModelPreferences | null
  onPhaseComplete: (project?: ProjectDTO) => void
  onPhaseChange?: (info: RunningPhaseInfo | null) => void
  phaseDone: PhaseDoneEvent | null
  onPhaseDoneConsumed: () => void
}

export default function PipelineController({
  projectId,
  project,
  modelPreferences,
  onPhaseComplete,
  onPhaseChange,
  phaseDone,
  onPhaseDoneConsumed,
}: Props) {
  const projectStatus = project.status
  const [autoMode, setAutoMode] = useState(false)
  const [running, setRunning] = useState(false)
  const [currentPhase, setCurrentPhase] = useState(-1)
  const [failedPhaseIdx, setFailedPhaseIdx] = useState(-1)
  const [pendingConfirmIdx, setPendingConfirmIdx] = useState(-1)
  const [error, setError] = useState<string | null>(null)
  const [models, setModels] = useState<ModelConfig[]>([])
  const [prefs, setPrefs] = useState<CanvasModelPreferences>(modelPreferences ?? {})
  const [elapsed, setElapsed] = useState(0)
  const phaseStartedAtRef = useRef<number>(0)
  const autoRef = useRef(autoMode)
  const activeRunIdRef = useRef<string | null>(null)
  autoRef.current = autoMode

  // Sync prefs from parent when project reloads
  useEffect(() => {
    setPrefs(modelPreferences ?? {})
  }, [modelPreferences])

  // Load models once
  useEffect(() => {
    fetchModels()
      .then(res => setModels(res.models))
      .catch(() => { toast.error('加载模型列表失败') })
  }, [])

  // Restore running state from active pipeline runs on mount + project reload
  // This handles the case where the user refreshes the page while a phase is running
  const restoredRef = useRef(false)
  useEffect(() => {
    if (running || models.length === 0)
      return // already running or models not loaded yet

    fetchCanvasPipelineRuns(projectId)
      .then((runs) => {
        const activeRun = runs.find(r => r.status === 'pending' || r.status === 'running')
        if (!activeRun) {
          // No active run — ensure state is clean
          if (restoredRef.current) {
            // Previously restored but now no active run — might have completed during our absence
            setRunning(false)
            setCurrentPhase(-1)
            activeRunIdRef.current = null
            setElapsed(0)
            phaseStartedAtRef.current = 0
            onPhaseChange?.(null)
          }
          return
        }

        // Find the PHASES index matching the active run's phase
        const phaseIdx = PHASES.findIndex(p => p.key === activeRun.phase)
        if (phaseIdx < 0)
          return

        // Check if project status has already advanced past this phase
        // (e.g., phase completed while page was closed, but SSE event was missed)
        const currentStartIdx = getPhaseIndex(projectStatus)
        if (phaseIdx < currentStartIdx) {
          // Phase already completed — project status advanced past it
          setRunning(false)
          setCurrentPhase(-1)
          activeRunIdRef.current = null
          onPhaseChange?.(null)
          return
        }

        // Restore running state without calling the phase API
        setCurrentPhase(phaseIdx)
        setRunning(true)
        setError(null)
        restoredRef.current = true
        activeRunIdRef.current = activeRun.id

        // Compute elapsed from run's startedAt
        if (activeRun.startedAt) {
          const startedAtMs = new Date(activeRun.startedAt).getTime()
          phaseStartedAtRef.current = startedAtMs
          setElapsed(Math.floor((Date.now() - startedAtMs) / 1000))
        }

        const phase = PHASES[phaseIdx]
        const info: RunningPhaseInfo = {
          key: phase.key,
          label: phase.label,
          modelCategory: phase.modelCategory,
          modelName: resolveModelDisplayName(phase.modelCategory, prefs, models),
        }
        onPhaseChange?.(info)
      })
      .catch(() => { /* silently ignore — not critical */ })
  }, [projectId, projectStatus, models, running, prefs, onPhaseChange])

  const textModels = useMemo(() => models.filter(m => m.category === 'text'), [models])
  const imageModels = useMemo(() => models.filter(m => m.category === 'image'), [models])

  async function handleModelChange(key: keyof CanvasModelPreferences, value: string) {
    const next = { ...prefs, [key]: value }
    setPrefs(next)
    try {
      const res = await updateCanvasModelPreferences(projectId, next)
      onPhaseComplete(res.data)
    }
    catch {
      setPrefs(prefs)
      toast.error('保存模型偏好失败')
    }
  }

  const startIdx = getPhaseIndex(projectStatus)

  // Fire a phase API call (returns immediately in fire-and-forget mode)
  const triggerPhase = useCallback(async (idx: number) => {
    const phase = PHASES[idx]
    if (!phase)
      return

    setCurrentPhase(idx)
    setRunning(true)
    setError(null)
    setFailedPhaseIdx(-1)
    setPendingConfirmIdx(-1)
    setElapsed(0)
    phaseStartedAtRef.current = Date.now()
    const info: RunningPhaseInfo = {
      key: phase.key,
      label: phase.label,
      modelCategory: phase.modelCategory,
      modelName: resolveModelDisplayName(phase.modelCategory, prefs, models),
    }
    onPhaseChange?.(info)

    try {
      const accepted = await phase.run(projectId) as { runId?: string }
      activeRunIdRef.current = accepted.runId ?? null
      // API acknowledged (fire-and-forget: returns immediately)
      // Actual completion is tracked via phaseDone SSE events
    }
    catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`${phase.label} 触发失败: ${msg}`)
      setRunning(false)
      setCurrentPhase(-1)
      activeRunIdRef.current = null
      setFailedPhaseIdx(idx)
      setElapsed(0)
      phaseStartedAtRef.current = 0
      onPhaseChange?.(null)
    }
  }, [projectId, onPhaseChange, prefs, models])

  // Advance to next phase after current phase completes
  const advanceAfterPhase = useCallback((completedIdx: number) => {
    const nextIdx = completedIdx + 1
    if (nextIdx >= PHASES.length) {
      setRunning(false)
      setCurrentPhase(-1)
      activeRunIdRef.current = null
      setElapsed(0)
      phaseStartedAtRef.current = 0
      onPhaseChange?.(null)
      return
    }

    const nextPhase = PHASES[nextIdx]

    if (nextPhase.pauseBefore) {
      // PAUSE_BEFORE 阶段：暂停，等待用户确认
      // 当 autoProgress=true 时，后端 stepper 也会在这里暂停
      setRunning(false)
      setCurrentPhase(-1)
      activeRunIdRef.current = null
      setElapsed(0)
      phaseStartedAtRef.current = 0
      onPhaseChange?.(null)
      // 显示确认按钮，由用户手动触发
      setPendingConfirmIdx(nextIdx)
    }
    else if (autoRef.current && prefs.autoProgress) {
      // autoProgress=true：后端 pipeline-stepper 会自动创建下一个 phase task
      // 前端只需显示 "等待下一阶段..." 状态，不主动触发 API
      setRunning(false)
      setCurrentPhase(-1)
      activeRunIdRef.current = null
      setElapsed(0)
      phaseStartedAtRef.current = 0
      onPhaseChange?.(null)
    }
    else if (autoRef.current) {
      triggerPhase(nextIdx)
    }
    else {
      setRunning(false)
      setCurrentPhase(-1)
      activeRunIdRef.current = null
      setElapsed(0)
      phaseStartedAtRef.current = 0
      onPhaseChange?.(null)
    }
  }, [onPhaseChange, triggerPhase, prefs])

  // Handle phase completion from SSE events
  useEffect(() => {
    if (!phaseDone)
      return
    if (phaseDone.projectId !== projectId)
      return
    if (!running || currentPhase < 0) {
      onPhaseDoneConsumed()
      return
    }

    const phase = PHASES[currentPhase]
    if (!phase || phase.key !== phaseDone.key) {
      onPhaseDoneConsumed()
      return
    }

    onPhaseDoneConsumed()
    activeRunIdRef.current = null

    // Reload project data before advancing
    onPhaseComplete()

    if (phaseDone.status === 'failed') {
      setError(`${phase.label} 失败: ${phaseDone.error || '未知错误'}`)
      setRunning(false)
      setCurrentPhase(-1)
      activeRunIdRef.current = null
      setFailedPhaseIdx(currentPhase)
      setElapsed(0)
      phaseStartedAtRef.current = 0
      onPhaseChange?.(null)
      return
    }

    // Phase completed successfully, clear failed state and advance
    setFailedPhaseIdx(-1)

    // Phase completed successfully, advance
    advanceAfterPhase(currentPhase)
  }, [phaseDone, projectId, running, currentPhase, onPhaseDoneConsumed, onPhaseComplete, advanceAfterPhase, onPhaseChange])

  // SSE 是主路径；polling 用作兜底，避免断线或漏事件时自动执行卡在 running。
  const { runs: polledRuns } = useCanvasPipelineRunsPolling(projectId, {
    enabled: running && currentPhase >= 0,
  })

  // watch polledRuns，命中 succeeded/failed 时推进状态（行为与原 setInterval 一致）。
  // react-query 的 queryFn 抛错会进 query.error，不进 query.data（runs），等同于原 catch 静默兜底。
  useEffect(() => {
    if (!running || currentPhase < 0)
      return

    const phase = PHASES[currentPhase]
    if (!phase || !polledRuns)
      return

    const runId = activeRunIdRef.current
    const run = runId
      ? polledRuns.find(r => r.id === runId)
      : polledRuns.find(r => r.phase === phase.key && (r.status === 'succeeded' || r.status === 'failed'))

    if (!run)
      return

    if (run.status !== 'succeeded' && run.status !== 'failed')
      return

    activeRunIdRef.current = null
    onPhaseComplete()

    if (run.status === 'failed') {
      setError(`${phase.label} 失败: ${run.errorMessage || '未知错误'}`)
      setRunning(false)
      setCurrentPhase(-1)
      setFailedPhaseIdx(currentPhase)
      setElapsed(0)
      phaseStartedAtRef.current = 0
      onPhaseChange?.(null)
      return
    }

    setFailedPhaseIdx(-1)
    advanceAfterPhase(currentPhase)
    // setXxx 为 useState setter（稳定）；advanceAfterPhase 已 useCallback；onPhaseComplete/onPhaseChange 为 props
  }, [polledRuns, running, currentPhase, advanceAfterPhase, onPhaseComplete, onPhaseChange])

  // 暂停阶段确认 — 用户点击"确认继续"触发 PAUSE_BEFORE 阶段
  function handleConfirmPausePhase() {
    if (pendingConfirmIdx < 0 || running)
      return
    setPendingConfirmIdx(-1)
    triggerPhase(pendingConfirmIdx)
  }

  function handleCancelPausePhase() {
    setPendingConfirmIdx(-1)
    setAutoMode(false)
  }

  // 页面刷新后检测 PAUSE_BEFORE 状态：项目状态已到达暂停点但尚未触发
  useEffect(() => {
    if (running || pendingConfirmIdx >= 0 || failedPhaseIdx >= 0)
      return
    // 如果当前项目状态的 startIdx 对应的是 PAUSE_BEFORE 阶段，
    // 则提示用户需要确认才能继续
    if (PHASES[startIdx]?.pauseBefore) {
      setPendingConfirmIdx(startIdx)
    }
    else {
      setPendingConfirmIdx(-1)
    }
  }, [projectStatus, running, pendingConfirmIdx, failedPhaseIdx, startIdx])

  // Elapsed time timer — 每秒更新已耗时
  useEffect(() => {
    if (!running || phaseStartedAtRef.current === 0)
      return
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - phaseStartedAtRef.current) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [running])

  function handleRunFrom(idx: number) {
    if (running)
      return
    setAutoMode(false)
    setError(null)
    triggerPhase(idx)
  }

  function handleAutoRun() {
    if (running)
      return
    setAutoMode(true)
    setError(null)
    // autoProgress=true → set backend flag then trigger only phase 1 (analyze)
    // Backend pipeline-stepper handles subsequent phase advancement
    updateCanvasModelPreferences(projectId, { ...prefs, autoProgress: true })
      .then(() => triggerPhase(startIdx))
      .catch(() => {
        // Fallback: still trigger even if autoProgress save fails
        triggerPhase(startIdx)
      })
  }

  function handleSkipAndContinue() {
    if (running)
      return
    const nextIdx = startIdx + 1
    if (nextIdx < PHASES.length) {
      setAutoMode(false)
      setError(null)
      triggerPhase(nextIdx)
    }
  }

  const currentPhaseInfo = currentPhase >= 0
    ? {
        key: PHASES[currentPhase].key,
        label: PHASES[currentPhase].label,
        modelCategory: PHASES[currentPhase].modelCategory,
        modelName: resolveModelDisplayName(PHASES[currentPhase].modelCategory, prefs, models),
      }
    : null

  const shots = project.shots
  const shotStats = useMemo(() => {
    if (shots.length === 0)
      return null
    return {
      total: shots.length,
      completed: shots.filter(s => s.status === 'completed').length,
      failed: shots.filter(s => s.status === 'failed').length,
      generating: shots.filter(s => s.status === 'generating').length,
    }
  }, [shots])
  const showShotStats = projectStatus === 'partial_failed' || projectStatus === 'generating'
  const hasFailedShots = shotStats && shotStats.failed > 0

  async function handleRetryAllFailed() {
    try {
      await retryFailedCanvasShots(projectId)
      onPhaseComplete()
    }
    catch {
      toast.error('重试失败镜头出错')
    }
  }

  async function handleCancelActive() {
    try {
      const result = await cancelCanvasActivePhase(projectId)
      toast.success(result.message)
      setRunning(false)
      setCurrentPhase(-1)
      setPendingConfirmIdx(-1)
      activeRunIdRef.current = null
      setElapsed(0)
      phaseStartedAtRef.current = 0
      onPhaseChange?.(null)
      onPhaseComplete()
    }
    catch {
      toast.error('终止阶段出错')
    }
  }

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
              onClick={handleRetryAllFailed}
              disabled={running}
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
          models={textModels}
          value={prefs.textModel || ''}
          onChange={v => handleModelChange('textModel', v)}
          disabled={running}
        />
        <ModelSelect
          label="图像模型"
          models={imageModels}
          value={prefs.imageModel || ''}
          onChange={v => handleModelChange('imageModel', v)}
          disabled={running}
        />
      </div>

      {/* Phase progress bar */}
      <div className="flex items-center gap-1 mb-2">
        {PHASES.map((phase, idx) => {
          const isCompleted = idx < startIdx
          const isCurrent = idx === currentPhase
          const isFailed = idx === failedPhaseIdx && failedPhaseIdx >= 0
          const isPending = idx >= startIdx && !isCurrent && !isFailed

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
          {PHASES.map((phase, idx) => {
            const isCompleted = idx < startIdx
            const isCurrent = idx === currentPhase
            const isFailed = idx === failedPhaseIdx && failedPhaseIdx >= 0
            const canRun = idx === startIdx || isCurrent || isFailed

            return (
              <button
                key={phase.key}
                onClick={() => canRun && handleRunFrom(idx)}
                disabled={running || (!canRun && !isCompleted)}
                className={`
                  text-xs px-2 py-1 rounded border transition-colors
                  ${isCompleted ? statusToneClass('success') : ''}
                  ${isCurrent ? statusToneClass('info', 'font-medium') : ''}
                  ${isFailed ? statusToneClass('danger', 'font-medium') : ''}
                  ${!isCompleted && !isCurrent && !isFailed ? 'bg-muted/50 border-border text-muted-foreground' : ''}
                  ${canRun && !running ? 'hover:bg-accent cursor-pointer' : ''}
                `}
              >
                {phase.label}
                {phase.pauseBefore && ' ⏸'}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-2">
          {pendingConfirmIdx >= 0 && !running && (
            <div className="flex items-center gap-2 text-sm">
              <span className={statusTextClass('warning', 'font-medium')}>
                ⏸ 准备执行
                {PHASES[pendingConfirmIdx]?.label}
                ，请确认继续
              </span>
              <button
                onClick={handleConfirmPausePhase}
                className="text-xs px-3 py-1.5 rounded bg-[color:var(--status-warning-fg)] text-primary-foreground hover:opacity-90 font-medium"
              >
                确认继续 →
                {PHASES[pendingConfirmIdx]?.label}
              </button>
              <button
                onClick={handleCancelPausePhase}
                className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
              >
                暂不执行
              </button>
            </div>
          )}

          {running && currentPhaseInfo && (
            <span className={statusTextClass('info', 'text-xs font-medium animate-pulse')}>
              正在
              {currentPhaseInfo.label}
              {currentPhaseInfo.modelName && ` · ${currentPhaseInfo.modelName}`}
              ...
            </span>
          )}
          {running && currentPhaseInfo && elapsed > 0 && (
            <span className="text-xs text-muted-foreground">
              已耗时
              {' '}
              {elapsed}
              s
            </span>
          )}
          {running && !currentPhaseInfo && (
            <span className="text-xs text-muted-foreground">
              执行中...
            </span>
          )}
          {running && (
            <button
              onClick={handleCancelActive}
              className={statusToneClass('danger', 'rounded border px-2 py-1 text-xs hover:opacity-90')}
            >
              终止当前阶段
            </button>
          )}

          {error && (
            <div className="flex items-center gap-2">
              <span className={statusTextClass('danger', 'text-xs max-w-50 truncate')} title={error}>
                {error}
              </span>
              <button
                onClick={() => handleRunFrom(failedPhaseIdx >= 0 ? failedPhaseIdx : startIdx)}
                className={statusToneClass('warning', 'rounded border px-2 py-1 text-xs hover:opacity-90')}
              >
                重试
              </button>
              {startIdx + 1 < PHASES.length && (
                <button
                  onClick={handleSkipAndContinue}
                  className={statusToneClass('info', 'rounded border px-2 py-1 text-xs hover:opacity-90')}
                >
                  跳过继续
                </button>
              )}
            </div>
          )}

          {!running && pendingConfirmIdx < 0 && !error && (
            <button
              onClick={handleAutoRun}
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
