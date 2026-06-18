import type { CanvasAssetsPoll, CanvasCostPhase } from '@excuse/shared'
import { CANVAS_PHASE_ORDER } from '@excuse/shared'
import { CircleDollarSign, ReceiptText, X } from 'lucide-react'
import { statusTextClass } from '@/lib/status-tokens'

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

/** 展示顺序 = 共享注册表顺序（不再镜像） */

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
  const phases = summary ? CANVAS_PHASE_ORDER.filter(p => summary.byPhase[p]) : []

  return (
    <aside className="floating-product-panel absolute bottom-4 right-4 top-4 z-20 flex w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden">
      {/* 头部 */}
      <div className="border-b bg-background/95 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
              <CircleDollarSign className="size-4" />
            </span>
            <div className="flex flex-col">
              <span className="text-sm font-semibold">成本</span>
              <span className="text-xs text-muted-foreground">beta 期间暂未计费</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭成本面板"
            className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        {/* ── 总览 ── */}
        <section className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border bg-background p-2 text-center">
            <div className="text-xs text-muted-foreground">预估（进行中）</div>
            <div className={statusTextClass('info', 'text-sm font-semibold')}>
              {formatCents(summary?.totalEstimatedCents ?? 0)}
            </div>
          </div>
          <div className="rounded-lg border bg-background p-2 text-center">
            <div className="text-xs text-muted-foreground">已结算</div>
            <div className={statusTextClass('success', 'text-sm font-semibold')}>
              {formatCents(summary?.totalFinalCents ?? 0)}
            </div>
          </div>
          <div className="rounded-lg border bg-background p-2 text-center">
            <div className="text-xs text-muted-foreground">失败/取消</div>
            <div className={statusTextClass('danger', 'text-sm font-semibold')}>
              {formatCents(summary?.totalFailedCents ?? 0)}
            </div>
          </div>
        </section>

        {/* ── 按阶段拆分 ── */}
        <section className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground">按阶段拆分</h4>

          {!hasAny
            ? (
                <div className="rounded-xl border border-dashed bg-muted/25 p-5 text-center">
                  <ReceiptText className="mx-auto size-8 text-muted-foreground" />
                  <h4 className="mt-3 text-sm font-semibold">暂无成本记录</h4>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">执行 Canvas 阶段后，模型预估、结算和失败成本会按阶段展示。</p>
                </div>
              )
            : (
                <div className="space-y-1.5">
                  {phases.map((phase) => {
                    const entry = summary!.byPhase[phase]!
                    return (
                      <div key={phase} className="space-y-1 rounded-lg border bg-background p-3">
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
                            <span className={statusTextClass('info')}>
                              预估
                              {formatCents(entry.estimatedCents)}
                            </span>
                          )}
                          {entry.finalCents > 0 && (
                            <span className={statusTextClass('success')}>
                              已结算
                              {formatCents(entry.finalCents)}
                            </span>
                          )}
                          {entry.failedCents > 0 && (
                            <span className={statusTextClass('danger')}>
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
        <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
          以上成本基于各模型定价与用量预估，当前 beta 期间不扣除信用额度。计费策略确定后将另行说明。
        </p>
      </div>
    </aside>
  )
}
