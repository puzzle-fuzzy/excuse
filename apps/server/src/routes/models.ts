import { MODELS } from '@excuse/provider'
import { Elysia } from 'elysia'

/**
 * 模型目录路由
 *
 * GET /api/models — 返回所有可用 AI 模型定义
 * 包含 id, name, category, type, description, pricing, parameters, referenceMediaType
 * 前端据此渲染模型选择器、参数表单、参考图上传卡片等
 */
export const modelsRoutes = new Elysia({ prefix: '/api/models' })
  .get('/', () => {
    // audio 类模型（fun-music-v1）为 Canvas BGM 流水线内部使用，邀测期且非通用生成类别
    // （generation_category 枚举不含 audio），不暴露到通用生成 UI，避免误提交。
    const models = Object.values(MODELS).filter(m => m.category !== 'audio').map(m => ({
      id: m.id,
      name: m.name,
      category: m.category,
      type: m.type,
      description: m.description,
      async: m.async,
      pricing: {
        unit: m.pricing.unit,
        note: m.pricing.note,
        inputPriceCents: m.pricing.inputPriceCents,
        outputPriceCents: m.pricing.outputPriceCents,
        inputPrice1080Cents: m.pricing.inputPrice1080Cents,
      },
      parameters: m.parameters,
      // 前端需要 referenceMediaType 来判断是否显示参考图上传卡片（r2v 模型）
      referenceMediaType: m.referenceMediaType,
    }))
    return { models }
  }, {
    detail: {
      summary: '获取可用模型列表',
      description: '返回所有可用 AI 模型定义，包含 id、名称、类别、参数规格、定价和参考图类型。前端据此渲染模型选择器和参数表单。',
      tags: ['模型'],
    },
  })
