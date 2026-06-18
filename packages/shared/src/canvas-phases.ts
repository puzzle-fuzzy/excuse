/**
 * Canvas 流水线阶段单一权威注册表。
 *
 * 这是阶段顺序、类型、pause-before、task-type 映射的**唯一来源**：
 *  - `@excuse/workflow-engine` 由此派生阶段推进规则（不再手抄）。
 *  - `@excuse/db` 的 `canvas_pipeline_phase` pgEnum 与本注册表双向断言同源（见 db/types.ts）。
 *  - 前端 `PipelineController` / `CostPanel` 由此派生展示顺序与 pauseBefore（不再手抄）。
 *
 * 新增一个阶段只改：本注册表 + 各自实现（worker handler / 前端 UI 元数据）+ DB pgEnum
 * （db/types.ts 的编译期断言会强制你补 pgEnum 并跑 db:generate 迁移）。
 * 切勿在别处再复制阶段列表 —— 镜像是 drift 的温床。
 */

/** 阶段执行顺序（权威源） */
export const CANVAS_PHASE_ORDER = [
  'analyze',
  'characters',
  'locations',
  'characterRefs',
  'locationRefs',
  'storyboard',
  'continuity',
  'rebuild',
  'dialogue',
  'videos',
  'bgm',
  'assemble',
] as const

/** 阶段类型 — 由顺序数组派生，禁止手写 union */
export type CanvasPipelinePhase = (typeof CANVAS_PHASE_ORDER)[number]

/** 需要用户确认才能继续的阶段（storyboard / videos / assemble） */
export const CANVAS_PAUSE_BEFORE_PHASES = [
  'storyboard',
  'videos',
  'assemble',
] as const satisfies readonly CanvasPipelinePhase[]

/** pause-before 阶段集合（O(1) 查询） */
export const CANVAS_PAUSE_BEFORE: ReadonlySet<CanvasPipelinePhase> = new Set(CANVAS_PAUSE_BEFORE_PHASES)

/** 全部阶段集合（O(1) 校验） */
const CANVAS_PHASE_SET: ReadonlySet<CanvasPipelinePhase> = new Set(CANVAS_PHASE_ORDER)

/** 阶段 → `canvas.<phase>` task type */
export function phaseToTaskType(phase: CanvasPipelinePhase): `canvas.${CanvasPipelinePhase}` {
  return `canvas.${phase}`
}

/** `canvas.<phase>` → 阶段（非法返回 null） */
export function getCanvasPhaseFromTaskType(taskType: string): CanvasPipelinePhase | null {
  if (!taskType.startsWith('canvas.'))
    return null
  const phase = taskType.slice('canvas.'.length)
  return CANVAS_PHASE_SET.has(phase as CanvasPipelinePhase) ? phase as CanvasPipelinePhase : null
}

/** 下一阶段（已是末阶段返回 null） */
export function getNextCanvasPhase(currentPhase: CanvasPipelinePhase): CanvasPipelinePhase | null {
  const index = CANVAS_PHASE_ORDER.indexOf(currentPhase)
  if (index === -1 || index === CANVAS_PHASE_ORDER.length - 1)
    return null
  return CANVAS_PHASE_ORDER[index + 1]!
}

/** 阶段是否需要用户确认才能继续（storyboard / videos / assemble） */
export function isPauseBeforePhase(phase: CanvasPipelinePhase): boolean {
  return CANVAS_PAUSE_BEFORE.has(phase)
}

/** 值是否为合法阶段（类型守卫） */
export function isCanvasPipelinePhase(value: string): value is CanvasPipelinePhase {
  return CANVAS_PHASE_SET.has(value as CanvasPipelinePhase)
}
