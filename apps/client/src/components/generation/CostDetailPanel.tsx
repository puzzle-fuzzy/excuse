import type { CostDetail } from '@excuse/shared'
import AudioCostDetail from './AudioCostDetail'
import ImageCostDetail from './ImageCostDetail'
import TokenCostDetail from './TokenCostDetail'
import VideoCostDetail from './VideoCostDetail'

export default function CostDetailPanel({ cost }: { cost: CostDetail }) {
  switch (cost.unit) {
    case 'token':
      return <TokenCostDetail cost={cost} />
    case 'image':
      return <ImageCostDetail cost={cost} />
    case 'video':
      return <VideoCostDetail cost={cost} />
    case 'audio':
      return <AudioCostDetail cost={cost} />
    default:
      return null
  }
}
