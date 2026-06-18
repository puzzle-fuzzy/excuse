import type { CostDetail } from '@excuse/shared'
import { formatCents } from '@/lib/generation-utils'

export default function TokenCostDetail({ cost }: { cost: CostDetail }) {
  return (
    <div className="text-xs text-muted-foreground space-y-0.5">
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {cost.inputTokens != null && (
          <span>
            输入 Tokens:
            {' '}
            {cost.inputTokens}
          </span>
        )}
        {cost.outputTokens != null && (
          <span>
            输出 Tokens:
            {' '}
            {cost.outputTokens}
          </span>
        )}
        {cost.inputUnitPrice != null && (
          <span>
            输入单价: ¥
            {Number(cost.inputUnitPrice).toFixed(4)}
            /1M
          </span>
        )}
        {cost.outputUnitPrice != null && (
          <span>
            输出单价: ¥
            {Number(cost.outputUnitPrice).toFixed(4)}
            /1M
          </span>
        )}
        {cost.inputCost != null && (
          <span>
            输入费用: ¥
            {Number(cost.inputCost).toFixed(4)}
          </span>
        )}
        {cost.outputCost != null && (
          <span>
            输出费用: ¥
            {Number(cost.outputCost).toFixed(4)}
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
