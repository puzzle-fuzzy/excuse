import type { AssetRetentionResult } from '@excuse/shared'
import type { ServerConfig } from '../../config'
import { runAssetRetentionCleanup } from '../../services/asset-retention'

export async function handleRunAssetRetention(
  config: ServerConfig,
  query: { dryRun?: boolean, graceDays?: number },
): Promise<AssetRetentionResult & { success: true }> {
  const result = await runAssetRetentionCleanup(config, { dryRun: query.dryRun === true, graceDays: query.graceDays })
  return { success: true, ...result }
}
