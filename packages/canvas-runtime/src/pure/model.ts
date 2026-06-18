/**
 * 纯函数：视频模型推荐
 *
 * 无 IO 依赖。根据镜头参考图情况和模型能力做变体降级推荐。
 */

import type { CanvasVideoVariant } from '@excuse/shared'
import type { CanvasRuntimeProviderAdapter } from '../adapter-types'
import { recommendCanvasVideoVariant } from '@excuse/shared'

/** 变体降级优先级：i2v → r2v → t2v；r2v → t2v；t2v 不降级 */
export const VARIANT_FALLBACK: Record<CanvasVideoVariant, CanvasVideoVariant[]> = {
  i2v: ['i2v', 'r2v', 't2v'],
  r2v: ['r2v', 't2v'],
  t2v: ['t2v'],
}

export interface CanvasVideoModelRecommendation {
  model: string
  variant: CanvasVideoVariant
  reason: string
}

/**
 * 带能力降级的镜头视频模型推荐。
 *
 * 1. 调用 @excuse/shared 纯规则 recommendCanvasVideoVariant(refs) 确定目标变体。
 * 2. 检查所选 base 模型是否真有该变体；若无，沿降级链回退。
 * 3. 返回最终 model id + 实际变体 + 原因。
 */
export function recommendCanvasVideoModel(
  prefs: { videoModel?: string | null } | null | undefined,
  references: ReadonlyArray<import('@excuse/shared').CanvasVideoReference>,
  provider: CanvasRuntimeProviderAdapter,
): CanvasVideoModelRecommendation {
  const base = (prefs?.videoModel || 'happyhorse-1.0').replace(/-r2v$|-t2v$|-i2v$/, '')
  const desired = recommendCanvasVideoVariant(references)

  const availableVariant = VARIANT_FALLBACK[desired.variant].find(
    variant => provider.getModelById(`${base}-${variant}`),
  ) ?? 't2v'

  const downgraded = availableVariant !== desired.variant
  const reason = downgraded
    ? `${desired.reason}（当前模型无 ${desired.variant.toUpperCase()} 变体，已降级为 ${availableVariant.toUpperCase()}）`
    : desired.reason

  return { model: `${base}-${availableVariant}`, variant: availableVariant, reason }
}

/** @deprecated 使用 recommendCanvasVideoModel 获取带原因的推荐 */
export function getCanvasVideoModel(
  prefs: { videoModel?: string | null } | null | undefined,
  referenceUrls: string[],
): string {
  const base = (prefs?.videoModel || 'happyhorse-1.0').replace(/-r2v$|-t2v$|-i2v$/, '')
  return referenceUrls.length > 0 ? `${base}-r2v` : `${base}-t2v`
}
