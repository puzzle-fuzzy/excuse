// 全站配置数据 —— 跨页面共享，统一在此维护。
// 品牌、导航、用例、套餐、FAQ、博客栏目、页脚等都在这里。

// 用户端工作台地址（astro.config.mjs 通过 Vite define 注入 __APP_URL__）。
// 组件里读 APP_URL；构建时若未注入则回落到工作台正式域名。
declare const __APP_URL__: string
export const APP_URL: string = typeof __APP_URL__ !== 'undefined' ? __APP_URL__ : 'https://app.excuse.com'

export const SITE = {
  name: 'Excuse',
  /** 完整站点标题（首页 / SEO 默认） */
  title: 'Excuse — 让想象力拥有生产力',
  /** 站点级描述 */
  description:
    '一站式 AI 创意生产平台：从故事文本、提示词到图片、视频、字幕与成片。成本可见、任务可恢复、资产可复用，并提供开发者 API。',
  /** 默认语言 */
  lang: 'zh-CN',
  /** 运营主体 */
  legalName: 'Excuse',
  /** 联系邮箱 */
  contactEmail: 'hello@excuse.com',
  /** 销售邮箱 */
  salesEmail: 'sales@excuse.com',
  /** 备案 / 公司信息（上线前替换） */
  icp: '',
}

export interface NavLink {
  href: string
  label: string
}

/** 顶部主导航 */
export const NAV_LINKS: NavLink[] = [
  { href: '/product', label: '产品' },
  { href: '/use-cases', label: '用例' },
  { href: '/pricing', label: '定价' },
  { href: '/docs', label: '文档' },
  { href: '/blog', label: '博客' },
]

export interface SocialLink {
  label: string
  href: string
  /** 内联 SVG path（24x24 viewBox，fill）—— 品牌图标 lucide 已移除，故内联 */
  icon: string
}

export const SOCIAL_LINKS: SocialLink[] = [
  {
    label: 'GitHub',
    href: 'https://github.com/puzzle-fuzzy/excuse',
    icon: 'M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.2.8-.6v-2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.4-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17 4.6 18 4.9 18 4.9c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .4.2.7.8.6 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z',
  },
  {
    label: 'X (Twitter)',
    href: 'https://x.com/excuse',
    icon: 'M18.9 1.5h3.4l-7.5 8.6 8.8 11.6h-6.9l-5.4-7.1-6.2 7.1H1.7l8-9.2L1.3 1.5h7.1l4.9 6.5 5.6-6.5zm-1.2 18.2h1.9L7.4 3.4H5.4l12.3 16.3z',
  },
  {
    label: '微信公众号',
    href: '#',
    icon: 'M8.5 4C4.9 4 2 6.4 2 9.3c0 1.7 1 3.2 2.6 4.2l-.6 2 2.3-1.3c.7.2 1.4.3 2.2.3h.6a5 5 0 0 1-.2-1.4c0-2.9 2.8-5.2 6.3-5.2h.6C15.4 5.4 12.3 4 8.5 4zm-2.4 3.1a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8zm4.8 0a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8zM22 13.4c0-2.4-2.4-4.3-5.4-4.3s-5.4 1.9-5.4 4.3 2.4 4.3 5.4 4.3c.6 0 1.2-.1 1.8-.3l1.8 1-.5-1.6c1.4-.8 2.3-2 2.3-3.4zm-7.2-.9a.7.7 0 1 1 0 1.4.7.7 0 0 1 0-1.4zm3.6 0a.7.7 0 1 1 0 1.4.7.7 0 0 1 0-1.4z',
  },
]

export interface UseCase {
  slug: string
  title: string
  tagline: string
  description: string
  /** 场景解决的痛点（3 条） */
  points: string[]
  /** @lucide/astro 图标名（见 components/Icon.astro registry） */
  icon: string
}

/** §5.3 场景入口 & §5.2 use-cases 子页 */
export const USE_CASES: UseCase[] = [
  {
    slug: 'advertising',
    title: 'AI 广告与商品图',
    tagline: '一句描述，出可投放的营销素材',
    description:
      '批量生成商品图、广告创意、营销 banner。统一品牌风格，输出可直接商用的高质量图片，降低拍摄与设计成本。',
    points: ['商品图换背景 / 场景化', '多尺寸批量出图', '品牌视觉一致性'],
    icon: 'megaphone',
  },
  {
    slug: 'short-video',
    title: 'AI 短视频',
    tagline: '从脚本到成片，几分钟产出',
    description:
      '文生视频、图生视频，结合 Canvas 流水线把脚本拆成镜头、补全角色与场景一致性，快速产出可发布的短视频。',
    points: ['文/图生视频', '镜头连贯性控制', '一键成片'],
    icon: 'clapperboard',
  },
  {
    slug: 'subtitle',
    title: 'AI 字幕',
    tagline: '自动转写并烧录高质量字幕',
    description:
      '上传视频自动抽音频、ASR 转写、生成带样式的字幕并烧录，支持自定义样式预设，省去人工打轴。',
    points: ['自动语音转写', 'ASS 样式预设', '一键烧录导出'],
    icon: 'captions',
  },
  {
    slug: 'story-to-video',
    title: '故事成片',
    tagline: '一段故事文本，自动成片',
    description:
      'Canvas 流水线：故事分析 → 抽取角色 / 场景 → 镜头分镜 → 一致性校验 → 对白 → 视频 → 配乐 → 合成。全流程任务可恢复。',
    points: ['12 阶段自动化', '角色 / 场景一致性', '失败可恢复、可重试'],
    icon: 'film',
  },
]

export interface ProcessStep {
  title: string
  description: string
}

/** §5.3 首页「产品流程：从 idea 到 assets 的 4 步」 */
export const PROCESS_STEPS: ProcessStep[] = [
  { title: '描述你的想法', description: '输入故事、提示词，或上传参考素材。' },
  { title: '选择能力', description: '文本、图片、视频、字幕，或走 Canvas 全流程。' },
  { title: '生成与迭代', description: '实时预览、成本预估、失败自动恢复、随时重试。' },
  { title: '沉淀资产', description: '产物自动入库，可收藏、打标、下载、复用。' },
]

export interface Capability {
  title: string
  description: string
  /** @lucide/astro 图标名 */
  icon: string
}

/** §5.3 首页「核心能力」 */
export const CAPABILITIES: Capability[] = [
  { title: 'Canvas 流水线', description: '故事到成片的 12 阶段自动化，角色与场景一致性，阶段可暂停确认。', icon: 'workflow' },
  { title: '统一资产库', description: '图片、视频、文本、字幕、参考素材统一管理，可复用与二次创作。', icon: 'layout-grid' },
  { title: '成本可见', description: '生成前预估积分消耗，生成后写入流水，失败按原因退款。', icon: 'coins' },
  { title: '任务可恢复', description: '统一任务队列、心跳锁、孤儿回收，失败任务可重试可取消。', icon: 'refresh-cw' },
  { title: '开发者 API', description: 'OpenAI 兼容网关、API Key、用量统计、Webhook，方便程序化接入。', icon: 'code' },
  { title: '多模型支持', description: '集成 Qwen 文本 / 图像、Wan / HappyHorse 视频，统一计费与路由。', icon: 'boxes' },
]

export interface TrustItem {
  title: string
  description: string
}

/** §5.3 首页「信任模块」 */
export const TRUST_ITEMS: TrustItem[] = [
  { title: '商用授权', description: '生成结果可用于商业用途，版权与责任边界清晰。' },
  { title: '数据安全', description: '上传与生成内容加密存储，敏感字段脱敏，可配置留存周期。' },
  { title: '可靠供应商', description: '底层集成阿里云 DashScope（通义千问 / 万相），稳定可预期。' },
  { title: '透明计费', description: '基于积分的统一账本，每一笔扣费、充值、退款均可追溯。' },
]

export interface PricingPlan {
  name: string
  /** 每期价格（元），null 表示「联系销售」 */
  price: number | null
  period: string
  description: string
  features: string[]
  cta: string
  highlighted?: boolean
}

/** §5.3 / §7.2 定价 */
export const PRICING_PLANS: PricingPlan[] = [
  {
    name: 'Free',
    price: 0,
    period: '永久免费',
    description: '新用户试用，含有限免费额度。',
    features: ['每日免费积分', '文本 / 图片基础生成', '资产库基础能力', '社区支持'],
    cta: '免费开始',
  },
  {
    name: 'Creator',
    price: 39,
    period: '/ 月',
    description: '个人创作者，月度积分包。',
    features: ['月度积分包', '视频生成', '字幕烧录', '优先队列', '邮件支持'],
    cta: '选择 Creator',
    highlighted: true,
  },
  {
    name: 'Pro',
    price: 129,
    period: '/ 月',
    description: '高频创作者，更高额度与高级模型。',
    features: ['更高积分额度', '高级模型优先', 'Canvas 完整流水线', '任务恢复与重试', 'API 访问'],
    cta: '选择 Pro',
  },
  {
    name: 'Team',
    price: null,
    period: '按团队规模',
    description: '小团队，成员、共享资产、团队账单。',
    features: ['团队空间与成员', '共享资产库', '团队统一账单', '权限管理', '专属支持'],
    cta: '联系销售',
  },
  {
    name: 'Enterprise',
    price: null,
    period: '定制',
    description: '企业客户，私有模型、发票、SLA、专属支持。',
    features: ['私有模型 / 专属部署', '增值税发票', 'SLA 保障', '专属客户成功', '合规与审计'],
    cta: '联系销售',
  },
]

export interface FAQItem {
  q: string
  a: string
}

/** §5.3 首页 FAQ */
export const FAQ_ITEMS: FAQItem[] = [
  { q: '生成失败会扣费吗？', a: '不会。失败任务按原因分类：内容审核失败、供应商异常等不扣费；部分成功的任务按实际消耗计入账本，并支持补偿。' },
  { q: '生成结果可以商用吗？', a: '可以。Excuse 生成的结果可用于商业用途，但你需对生成内容的使用场景与合规性负责，详见商用说明与内容政策。' },
  { q: '成本如何计算？', a: '采用统一积分体系，按 token / 图片张数 / 视频时长 / 音频时长计费。生成前给出预估，生成后写入实际流水。' },
  { q: '我的数据保存多久？', a: '上传素材与生成资产默认长期保留，可在资产库随时删除。企业版可配置自定义留存与自动清理策略。' },
  { q: '提供 API 吗？', a: '提供。兼容 OpenAI 协议的网关、API Key 管理、用量统计与 Webhook，方便开发者程序化接入。详见开发者文档。' },
]

/** §5.5 博客 5 栏目 */
export const BLOG_CATEGORIES = [
  { slug: 'tutorials', label: '教程', description: '手把手教你完成具体任务，承接搜索流量。' },
  { slug: 'use-cases', label: '应用场景', description: '按行业 / 岗位讲应用场景与玩法。' },
  { slug: 'product-updates', label: '产品更新', description: '发布功能更新，增强活跃与信任。' },
  { slug: 'guides', label: 'AI 生产指南', description: '建立专业认知：成本、流程、模型选择。' },
  { slug: 'customer-stories', label: '客户案例', description: '展示真实案例、结果与 ROI。' },
] as const

/** §6.1 文档栏目（导航用） */
export const DOC_SECTIONS = [
  { slug: 'getting-started', label: '快速开始' },
  { slug: 'workspace', label: '工作台' },
  { slug: 'canvas', label: 'Canvas' },
  { slug: 'assets', label: '资产库' },
  { slug: 'subtitle', label: '字幕' },
  { slug: 'billing', label: '计费' },
  { slug: 'models', label: '模型' },
  { slug: 'api', label: 'API' },
  { slug: 'faq', label: '常见问题' },
] as const

export interface FooterColumn {
  title: string
  links: NavLink[]
}

/** 页脚导航分组 */
export const FOOTER_NAV: FooterColumn[] = [
  {
    title: '产品',
    links: [
      { href: '/product', label: '产品总览' },
      { href: '/use-cases', label: '应用场景' },
      { href: '/templates', label: '模板' },
      { href: '/pricing', label: '定价' },
      { href: '/changelog', label: '更新日志' },
    ],
  },
  {
    title: '资源',
    links: [
      { href: '/docs', label: '文档中心' },
      { href: '/blog', label: '博客' },
      { href: '/docs/api', label: 'API 文档' },
      { href: '/docs/faq', label: '常见问题' },
    ],
  },
  {
    title: '公司',
    links: [
      { href: '/about', label: '关于我们' },
      { href: '/customers', label: '客户案例' },
      { href: '/contact', label: '联系我们' },
    ],
  },
  {
    title: '法律',
    links: [
      { href: '/legal/privacy', label: '隐私政策' },
      { href: '/legal/terms', label: '服务条款' },
      { href: '/legal/content-policy', label: '内容政策' },
      { href: '/docs/legal/commercial-use', label: '商用说明' },
    ],
  },
]
