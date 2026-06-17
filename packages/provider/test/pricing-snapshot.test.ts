import type { ModelPricing } from '@excuse/shared'
import { describe, expect, it } from 'bun:test'
import { MODELS } from '../src/model-configs'

/**
 * P1.8: 价格快照测试 — 锁定当前模型定价，防止误改
 *
 * 任何定价变更（新模型、调价、删除模型）必须：
 *   1. 更新下方的 EXPECTED_PRICING 快照
 *   2. 在 commit message 中注明调价原因和来源链接
 *   3. 运行 provider 测试和 billing 测试确认计算逻辑正确
 *
 * 快照结构：{ modelId: { inputPriceCents, outputPriceCents?, inputPrice1080Cents?, unit } }
 * 不锁定 note 字段（note 是人类可读描述，允许自由调整）
 */

// ══════════════════════════════════════════════════════════
// 价格快照 — 最后更新: 2026-06-12
//
// 来源: 阿里云百炼 DashScope 官方定价页
//   - 文本: https://help.aliyun.com/zh/model-studio/getting-started/models
//   - 图像: https://help.aliyun.com/zh/model-studio/developer-reference/image-generation-api
//   - 视频: https://help.aliyun.com/zh/model-studio/developer-reference/video-generation-api
// ══════════════════════════════════════════════════════════

const EXPECTED_PRICING: Record<string, ModelPricing> = {
  // ===== 文本模型 =====
  'qwen-max': { inputPriceCents: 240, outputPriceCents: 960, unit: 'token' },
  'qwen-plus': { inputPriceCents: 80, outputPriceCents: 200, unit: 'token' },
  'qwen-turbo': { inputPriceCents: 30, outputPriceCents: 60, unit: 'token' },
  'qwen-long': { inputPriceCents: 50, outputPriceCents: 200, unit: 'token' },
  'qwen3.7-plus': { inputPriceCents: 160, outputPriceCents: 640, unit: 'token' },

  // ===== 图像模型 =====
  'qwen-image-2.0-pro': { inputPriceCents: 25, unit: 'image' },
  'qwen-image-max': { inputPriceCents: 25, unit: 'image' },

  // ===== 音频模型 =====
  // fun-music-v1 邀测期定价 0.002元/1000秒 = 0.0002分/秒（按秒小数计费，见 docs/bailian/模型调用价格.md）
  'fun-music-v1': { inputPriceCents: 0.0002, unit: 'audio' },

  // ===== 视频模型 =====
  'happyhorse-1.0-t2v': { inputPriceCents: 90, inputPrice1080Cents: 160, unit: 'video' },
  'happyhorse-1.0-i2v': { inputPriceCents: 90, inputPrice1080Cents: 160, unit: 'video' },
  'happyhorse-1.0-r2v': { inputPriceCents: 90, inputPrice1080Cents: 160, unit: 'video' },
  'happyhorse-1.0-video-edit': { inputPriceCents: 90, inputPrice1080Cents: 160, unit: 'video' },
  'wan2.7-t2v': { inputPriceCents: 60, inputPrice1080Cents: 100, unit: 'video' },
  'wan2.7-i2v': { inputPriceCents: 60, inputPrice1080Cents: 100, unit: 'video' },
  'wan2.7-r2v': { inputPriceCents: 60, inputPrice1080Cents: 100, unit: 'video' },
  'wan2.7-videoedit': { inputPriceCents: 60, inputPrice1080Cents: 100, unit: 'video' },
}

describe('价格快照 (P1.8)', () => {
  it('所有模型的定价与快照一致 — 误改会导致测试失败', () => {
    const violations: string[] = []

    for (const [modelId, expected] of Object.entries(EXPECTED_PRICING)) {
      const model = MODELS[modelId]
      if (!model) {
        violations.push(`快照中的 "${modelId}" 不存在于 MODELS — 可能已删除，需更新快照`)
        continue
      }

      const actual = model.pricing
      if (actual.inputPriceCents !== expected.inputPriceCents) {
        violations.push(`${modelId}: inputPriceCents 快照=${expected.inputPriceCents} 实际=${actual.inputPriceCents}`)
      }
      if (actual.unit !== expected.unit) {
        violations.push(`${modelId}: unit 快照=${expected.unit} 实际=${actual.unit}`)
      }
      if (expected.outputPriceCents !== undefined && actual.outputPriceCents !== expected.outputPriceCents) {
        violations.push(`${modelId}: outputPriceCents 快照=${expected.outputPriceCents} 实际=${actual.outputPriceCents}`)
      }
      if (expected.inputPrice1080Cents !== undefined && actual.inputPrice1080Cents !== expected.inputPrice1080Cents) {
        violations.push(`${modelId}: inputPrice1080Cents 快照=${expected.inputPrice1080Cents} 实际=${actual.inputPrice1080Cents}`)
      }
    }

    // 反向检查：MODELS 中存在但快照中缺失的模型
    for (const modelId of Object.keys(MODELS)) {
      if (!EXPECTED_PRICING[modelId]) {
        violations.push(`"${modelId}" 存在于 MODELS 但快照中缺失 — 新增模型需更新快照`)
      }
    }

    expect(violations).toHaveLength(0)
  })

  it('文本模型必须有 outputPriceCents', () => {
    const textModels = Object.values(MODELS).filter(m => m.category === 'text')
    const violations: string[] = []
    for (const model of textModels) {
      if (model.pricing.outputPriceCents === undefined || model.pricing.outputPriceCents <= 0) {
        violations.push(`${model.id}: 文本模型缺少 outputPriceCents 或 <= 0`)
      }
    }
    expect(violations).toHaveLength(0)
  })

  it('视频模型必须有 inputPrice1080Cents', () => {
    const videoModels = Object.values(MODELS).filter(m => m.category === 'video')
    const violations: string[] = []
    for (const model of videoModels) {
      if (model.pricing.inputPrice1080Cents === undefined || model.pricing.inputPrice1080Cents <= 0) {
        violations.push(`${model.id}: 视频模型缺少 inputPrice1080Cents 或 <= 0`)
      }
    }
    expect(violations).toHaveLength(0)
  })

  it('所有定价金额为正数（token/image/video 为正整数分；audio 按秒可小数计费）', () => {
    const violations: string[] = []
    for (const model of Object.values(MODELS)) {
      const p = model.pricing
      // audio 模型按秒计费，单价可为小数分（如 fun-music-v1 = 0.0002分/秒，
      // 与 ASR 0.008分/秒 同属按秒小数定价）—— 仅要求为正数。
      const requireInteger = p.unit !== 'audio'
      const check = (label: string, value: number | undefined) => {
        if (value === undefined)
          return
        if (value <= 0 || (requireInteger && !Number.isInteger(value))) {
          violations.push(`${model.id}: ${label}=${value} ${requireInteger ? '不是正整数分' : '不是正数'}`)
        }
      }
      check('inputPriceCents', p.inputPriceCents)
      check('outputPriceCents', p.outputPriceCents)
      check('inputPrice1080Cents', p.inputPrice1080Cents)
    }
    expect(violations).toHaveLength(0)
  })
})
