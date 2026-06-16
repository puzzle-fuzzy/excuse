import type { BillingParams, CostDetail, ModelPricing } from '@excuse/shared'
import currency from 'currency.js'
import { centsToYuan } from './utils'

/**
 * currency.js 精度配置 — 4 位小数确保分→元转换和乘法累加时不丢精度
 * 例如: 9999999 分 × 0.0001 = 999.9999 元，2 位精度会截断为 1000.00
 */
const PRECISION = { precision: 4 }

/**
 * 计算单次生成的费用（分计费）
 *
 * - 文本：按输入/输出 token 数 × 每百万 token 价格（分）
 * - 图片：按张数 × 单价（分）
 * - 视频：按时长（秒）× 单价（分，按分辨率）
 * - 音频：按时长（秒）× 单价（分，用于 ASR 转录等）
 *
 * 所有金额运算使用 currency.js（precision=4），避免浮点误差。
 * totalPriceCents 为权威值，totalPrice 为分→元的兼容展示值。
 */
export function calculateCost(
  model: { pricing: ModelPricing } | { id: string, category: string, pricing: ModelPricing },
  params: BillingParams,
  usage?: {
    inputTokens?: number
    outputTokens?: number
    imageCount?: number
    videoDuration?: number
  },
): CostDetail {
  const pricing = model.pricing

  switch (pricing.unit) {
    // token 计费: 输入/输出分别按每百万 token 单价计算
    case 'token': {
      const inputTokens = usage?.inputTokens || 0
      const outputTokens = usage?.outputTokens || 0

      const inputCostCents = currency(pricing.inputPriceCents, PRECISION)
        .multiply(inputTokens)
        .divide(1_000_000)
        .value
      const outputCostCents = currency(pricing.outputPriceCents || 0, PRECISION)
        .multiply(outputTokens)
        .divide(1_000_000)
        .value
      const totalCents = currency(inputCostCents, PRECISION).add(outputCostCents).value

      return {
        unit: 'token',
        inputTokens,
        outputTokens,
        inputUnitPriceCents: pricing.inputPriceCents,
        inputUnitPrice: centsToYuan(pricing.inputPriceCents),
        outputUnitPriceCents: pricing.outputPriceCents,
        outputUnitPrice: pricing.outputPriceCents ? centsToYuan(pricing.outputPriceCents) : undefined,
        inputCostCents,
        inputCost: centsToYuan(inputCostCents),
        outputCostCents,
        outputCost: centsToYuan(outputCostCents),
        totalPriceCents: totalCents,
        totalPrice: centsToYuan(totalCents),
      }
    }

    // 图片计费: 按张数 × 单价，张数优先取 usage.imageCount，其次取 params.n，默认 1
    case 'image': {
      const count = usage?.imageCount || params.n || 1
      const totalCents = currency(pricing.inputPriceCents, PRECISION).multiply(count).value

      return {
        unit: 'image',
        quantity: count,
        unitPriceCents: pricing.inputPriceCents,
        unitPrice: centsToYuan(pricing.inputPriceCents),
        totalPriceCents: totalCents,
        totalPrice: centsToYuan(totalCents),
      }
    }

    // 视频计费: 按时长（秒）× 单价，1080P 优先使用独立定价，缺省回退到基础定价
    case 'video': {
      const duration = usage?.videoDuration || params.duration || 5
      const resolution = params.resolution || '720P'
      const unitPriceCents = resolution === '1080P'
        ? (pricing.inputPrice1080Cents || pricing.inputPriceCents)
        : pricing.inputPriceCents
      const totalCents = currency(unitPriceCents, PRECISION).multiply(duration).value

      return {
        unit: 'video',
        duration,
        resolution,
        unitPriceCents,
        unitPrice: centsToYuan(unitPriceCents),
        totalPriceCents: totalCents,
        totalPrice: centsToYuan(totalCents),
      }
    }

    // 音频计费: 按时长（秒）× 单价，用于 ASR 转录等按秒计费的场景
    // 例：paraformer-v2 = 0.008 分/秒（0.00008 元/秒）
    case 'audio': {
      const duration = params.duration || 0
      const unitPriceCents = pricing.inputPriceCents
      const totalCents = currency(unitPriceCents, PRECISION).multiply(duration).value

      return {
        unit: 'audio',
        duration,
        unitPriceCents,
        unitPrice: centsToYuan(unitPriceCents),
        totalPriceCents: totalCents,
        totalPrice: centsToYuan(totalCents),
      }
    }

    default:
      throw new Error(`未知的计费单位: ${pricing.unit}`)
  }
}

/**
 * 预估费用（生成前调用，用于前端展示）
 *
 * 与 calculateCost 相同计算逻辑，但标记 estimated=true，
 * usage 参数传 undefined 表示未获得实际用量，使用默认值估算。
 */
export function estimateCost(model: { pricing: ModelPricing } | { id: string, category: string, pricing: ModelPricing }, params: BillingParams): CostDetail {
  const result = calculateCost(model, params, undefined)
  result.estimated = true
  return result
}
