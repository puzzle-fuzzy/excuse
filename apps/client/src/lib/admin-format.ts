/**
 * Admin 后台运营统计专用格式化 helper。
 *
 * 与 `generation-utils.ts` 的 `formatCents` / `formatMs` 区分：
 * - `formatLatencyMs`：用于 provider 调用延迟（Xms / Xs），不是视频时长 M:SS。
 * - `formatPercent`：失败率（0~1 → 百分比）。
 * - `formatNumber`：千分位分隔。
 */

export function formatLatencyMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms))
    return '—'
  if (ms < 1000)
    return `${ms.toFixed(0)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

export function formatPercent(rate: number | null | undefined, fractionDigits = 1): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate))
    return '—'
  return `${(rate * 100).toFixed(fractionDigits)}%`
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return '—'
  return value.toLocaleString('zh-CN')
}

/**
 * Canvas pipeline 阶段中文标签（9 阶段）。
 * 用于 admin 任务详情的 pipeline run 时间线展示。
 */
export const PIPELINE_PHASE_LABELS: Record<string, string> = {
  analyze: '分析',
  characters: '角色',
  locations: '场景',
  characterRefs: '角色参考图',
  locationRefs: '场景参考图',
  storyboard: '分镜',
  continuity: '连续性',
  rebuild: '提示词重建',
  videos: '视频',
}

export function pipelinePhaseLabel(phase: string): string {
  return PIPELINE_PHASE_LABELS[phase] ?? phase
}
