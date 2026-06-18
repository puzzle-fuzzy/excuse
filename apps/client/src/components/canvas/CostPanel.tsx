import type { CanvasAssetsPoll, CanvasCostPhase } from '@excuse/shared'

/**
 * 成本面板 — 展示项目级成本 rollup 与按阶段拆分（P2-1 成本可见）
 *
 * 重要：当前 beta 期间 Canvas 暂不对用户计费，此处的成本仅作「预估/已结算」展示，
 * 不进入 credit reserve/debit/refund 体系，面板顶部明确标注「暂未计费」避免误导。
 */

/** 阶段维度 → 中文标签 */
const PHASE_LABELS: Record<CanvasCostPhase, string> = {
  analyze: '文本分析',
  characters: '角色档案',
  locations: '场景档案',
  characterRefs: '角色参考图',
  locationRefs: '场景参考图',
  storyboard: '分镜',
  continuity: '连续性检查',
  rebuild: 'Prompt 重建',
  dialogue: '对话层',
  videos: '镜头视频',
  bgm: '背景音乐',
  assemble: '最终合成',
}

/** 展示顺序（镜像 CanvasPipelinePhase 顺序） */
const PHASE_ORDER: CanvasCostPhase[] = [
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
]

/** cents → 元展示（保留两位） */
function formatCents(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`
}

interface CostPanelProps {
  pollData: CanvasAssetsPoll | null
  onClose: () => void
}

export default function CostPanel({ pollData, onClose }: CostPanelProps) {
  const summary = pollData?.costSummary
  const hasAny = summary && (summary.totalEstimatedCents + summary.totalFinalCents + summary.totalFailedCents) > 0
  const phases = summary ? PHASE_ORDER.filter(p => summary.byPhase[p]) : []

  return (
    <div className="absolute right-4 top-4 bottom-4 w-96 bg-background border rounded-lg shadow-lg overflow-auto z-20">
      {/* 头部 */}
      <div className="sticky top-0 bg-background border-b px-4 py-2 flex items-center justify-between z-10">
        <div className="flex flex-col">
          <span className="text-sm font-medium">成本</span>
          <span className="text-xs text-muted-foreground">beta 期间暂未计费</span>
        </div>
        <button
          onClick={onClose}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          关闭
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* ── 总览 ── */}
        <section className="grid grid-cols-3 gap-2">
          <div className="border rounded p-2 text-center">
            <div className="text-xs text-muted-foreground">预估（进行中）</div>
            <div className="text-sm font-semibold text-blue-700">
              {formatCents(summary?.totalEstimatedCents ?? 0)}
            </div>
          </div>
          <div className="border rounded p-2 text-center">
            <div className="text-xs text-muted-foreground">已结算</div>
            <div className="text-sm font-semibold text-green-700">
              {formatCents(summary?.totalFinalCents ?? 0)}
            </div>
          </div>
          <div className="border rounded p-2 text-center">
            <div className="text-xs text-muted-foreground">失败/取消</div>
            <div className="text-sm font-semibold text-red-700">
              {formatCents(summary?.totalFailedCents ?? 0)}
            </div>
          </div>
        </section>

        {/* ── 按阶段拆分 ── */}
        <section className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground">按阶段拆分</h4>

          {!hasAny
            ? (
                <p className="text-xs text-muted-foreground py-2">暂无成本记录</p>
              )
            : (
                <div className="space-y-1.5">
                  {phases.map((phase) => {
                    const entry = summary!.byPhase[phase]!
                    return (
                      <div key={phase} className="border rounded p-2 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium">{PHASE_LABELS[phase]}</span>
                          <span className="text-xs text-muted-foreground">
                            {entry.count}
                            {' '}
                            条
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          {entry.estimatedCents > 0 && (
                            <span className="text-blue-700">
                              预估
                              {formatCents(entry.estimatedCents)}
                            </span>
                          )}
                          {entry.finalCents > 0 && (
                            <span className="text-green-700">
                              已结算
                              {formatCents(entry.finalCents)}
                            </span>
                          )}
                          {entry.failedCents > 0 && (
                            <span className="text-red-700">
                              失败
                              {formatCents(entry.failedCents)}
                            </span>
                          )}
                          {entry.estimatedCents === 0 && entry.finalCents === 0 && entry.failedCents === 0 && (
                            <span className="text-muted-foreground">¥0.00</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
        </section>

        {/* ── 说明 ── */}
        <p className="text-xs text-muted-foreground bg-muted/40 rounded px-2 py-1.5">
          以上成本基于各模型定价与用量预估，当前 beta 期间不扣除信用额度。计费策略确定后将另行说明。
        </p>
      </div>
    </div>
  )
}
