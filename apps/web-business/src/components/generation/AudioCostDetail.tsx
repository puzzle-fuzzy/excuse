import type { CostDetail } from '@excuse/shared'
import { formatCents } from '@/lib/generation-utils'

export default function AudioCostDetail({ cost }: { cost: CostDetail }) {
  return (
    <div className="text-xs text-muted-foreground space-y-0.5">
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {cost.duration != null && (
          <span>
            时长:
            {' '}
            {cost.duration}
            s
          </span>
        )}
        {cost.unitPrice != null && (
          <span>
            单价: ¥
            {Number(cost.unitPrice).toFixed(4)}
            /s
          </span>
        )}
      </div>
      {cost.totalPriceCents != null && (
        <p className="font-medium text-foreground">
          总计: ¥
          {formatCents(cost.totalPriceCents, 4)}
          {cost.estimated && ' (预估)'}
        </p>
      )}
    </div>
  )
}
