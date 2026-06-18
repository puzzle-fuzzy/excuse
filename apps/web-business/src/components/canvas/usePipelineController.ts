/**
 * 管线控制器 hook — 从 PipelineController.tsx 抽取的状态管理与逻辑
 *
 * 原 753 行单文件中"恢复 + auto + trigger"逻辑与渲染混在一起。
 * 本 hook 收敛所有 useState/useEffect/useCallback + 动作处理函数，
 * 组件侧只消费返回值做渲染。
 */
import type { CanvasModelPreferences, CanvasPipelinePhase, CanvasProjectStatus, ModelConfig, ProjectDTO } from '@excuse/shared'
import { CANVAS_PAUSE_BEFORE, CANVAS_PHASE_ORDER } from '@excuse/shared'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
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

// ── RunningPhaseInfo ─────────────────────────────────────

export interface RunningPhaseInfo {
  key: string
  label: string
  modelCategory: 'text' | 'image' | 'video' | null
  modelName: string | null
}

// ── 默认模型 ID ──────────────────────────────────────────

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
    return null
  const prefKey = `${category}Model` as 'textModel' | 'imageModel' | 'videoModel'
  const modelId = prefs[prefKey] || DEFAULT_MODEL_IDS[category]
  const config = models.find(m => m.id === modelId)
  return config?.name || modelId
}

// ── PHASES 元数据 ────────────────────────────────────────

interface PipelinePhase {
  key: CanvasPipelinePhase
  label: string
  status: CanvasProjectStatus | null
  run: (projectId: string) => Promise<unknown>
  pauseBefore: boolean
  modelCategory: 'text' | 'image' | 'video' | null
}

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

// ── 接口 ────────────────────────────────────────────────

export interface PhaseDoneEvent {
  projectId: string
  key: string
  status: 'completed' | 'failed'
  error?: string
}

export interface UsePipelineControllerInput {
  projectId: string
  project: ProjectDTO
  modelPreferences: CanvasModelPreferences | null
  onPhaseComplete: (project?: ProjectDTO) => void
  onPhaseChange?: (info: RunningPhaseInfo | null) => void
  phaseDone: PhaseDoneEvent | null
  onPhaseDoneConsumed: () => void
}

export function usePipelineController(input: UsePipelineControllerInput) {
  const { projectId, project, modelPreferences, onPhaseComplete, onPhaseChange, phaseDone, onPhaseDoneConsumed } = input
  const projectStatus = project.status

  // ── 状态 ─────────────────────────────────────────────
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

  // Sync prefs from parent
  useEffect(() => {
    setPrefs(modelPreferences ?? {})
  }, [modelPreferences])

  // Load models once
  useEffect(() => {
    fetchModels()
      .then(res => setModels(res.models))
      .catch(() => { toast.error('加载模型列表失败') })
  }, [])

  // ── 模型偏好 ─────────────────────────────────────────
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

  // ── 阶段触发 ─────────────────────────────────────────
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

  // ── 阶段推进 ─────────────────────────────────────────
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
      setRunning(false)
      setCurrentPhase(-1)
      activeRunIdRef.current = null
      setElapsed(0)
      phaseStartedAtRef.current = 0
      onPhaseChange?.(null)
      setPendingConfirmIdx(nextIdx)
    }
    else if (autoRef.current && prefs.autoProgress) {
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

  // ── 恢复运行状态 ─────────────────────────────────────
  const restoredRef = useRef(false)
  useEffect(() => {
    if (running || models.length === 0)
      return

    fetchCanvasPipelineRuns(projectId)
      .then((runs) => {
        const activeRun = runs.find(r => r.status === 'pending' || r.status === 'running')
        if (!activeRun) {
          if (restoredRef.current) {
            setRunning(false)
            setCurrentPhase(-1)
            activeRunIdRef.current = null
            setElapsed(0)
            phaseStartedAtRef.current = 0
            onPhaseChange?.(null)
          }
          return
        }

        const phaseIdx = PHASES.findIndex(p => p.key === activeRun.phase)
        if (phaseIdx < 0)
          return

        const currentStartIdx = getPhaseIndex(projectStatus)
        if (phaseIdx < currentStartIdx) {
          setRunning(false)
          setCurrentPhase(-1)
          activeRunIdRef.current = null
          onPhaseChange?.(null)
          return
        }

        setCurrentPhase(phaseIdx)
        setRunning(true)
        setError(null)
        restoredRef.current = true
        activeRunIdRef.current = activeRun.id

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
      .catch(() => { /* silently ignore */ })
  }, [projectId, projectStatus, models, running, prefs, onPhaseChange])

  // ── SSE 阶段完成 ─────────────────────────────────────
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

    setFailedPhaseIdx(-1)
    advanceAfterPhase(currentPhase)
  }, [phaseDone, projectId, running, currentPhase, onPhaseDoneConsumed, onPhaseComplete, advanceAfterPhase, onPhaseChange])

  // ── 轮询兜底 ─────────────────────────────────────────
  const { runs: polledRuns } = useCanvasPipelineRunsPolling(projectId, {
    enabled: running && currentPhase >= 0,
  })

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
  }, [polledRuns, running, currentPhase, advanceAfterPhase, onPhaseComplete, onPhaseChange])

  // ── 暂停确认 ─────────────────────────────────────────
  const startIdx = getPhaseIndex(projectStatus)

  useEffect(() => {
    if (running || pendingConfirmIdx >= 0 || failedPhaseIdx >= 0)
      return
    if (PHASES[startIdx]?.pauseBefore) {
      setPendingConfirmIdx(startIdx)
    }
    else {
      setPendingConfirmIdx(-1)
    }
  }, [projectStatus, running, pendingConfirmIdx, failedPhaseIdx, startIdx])

  function handleConfirmPausePhase() {
    if (pendingConfirmIdx < 0 || running)
      return
    const idx = pendingConfirmIdx
    setPendingConfirmIdx(-1)
    triggerPhase(idx)
  }

  function handleCancelPausePhase() {
    setPendingConfirmIdx(-1)
    setAutoMode(false)
  }

  // ── 耗时计时器 ───────────────────────────────────────
  useEffect(() => {
    if (!running || phaseStartedAtRef.current === 0)
      return
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - phaseStartedAtRef.current) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [running])

  // ── 动作处理 ─────────────────────────────────────────
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
    updateCanvasModelPreferences(projectId, { ...prefs, autoProgress: true })
      .then(() => triggerPhase(startIdx))
      .catch(() => triggerPhase(startIdx))
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

  // ── 计算值 ───────────────────────────────────────────
  const textModels = useMemo(() => models.filter(m => m.category === 'text'), [models])
  const imageModels = useMemo(() => models.filter(m => m.category === 'image'), [models])

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

  return {
    // 阶段数据
    PHASES,
    startIdx,
    // 状态
    autoMode,
    running,
    currentPhase,
    failedPhaseIdx,
    pendingConfirmIdx,
    error,
    elapsed,
    prefs,
    models,
    textModels,
    imageModels,
    // 计算值
    currentPhaseInfo,
    shotStats,
    showShotStats,
    hasFailedShots,
    projectStatus,
    // 动作
    handleModelChange,
    handleRunFrom,
    handleAutoRun,
    handleSkipAndContinue,
    handleConfirmPausePhase,
    handleCancelPausePhase,
    handleRetryAllFailed,
    handleCancelActive,
  }
}
