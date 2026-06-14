// ===== 统一资产中心 DTO =====
//
// `/api/assets` 把 generation_records（普通生成）、canvas_assets（Canvas 流水线产物）、
// uploaded_files（用户上传）三种来源的资产统一成同一份 AssetLibraryItem。
//
// 设计约束：
//   - 不把 DB 的 inputJson / outputJson 原样暴露成裸 Record 给页面。
//     只提取页面真正需要的标量字段（prompt、previewUrl、costCents 等）。
//   - previewUrl / downloadUrl 优先使用稳定 publicUrl，不优先 provider 临时 URL。
//   - kind 是“可浏览的资产类别”（图片/视频/角色/场景/镜头/项目文档/上传），
//     source 是“来源表”（generation_record / canvas_asset / uploaded_file）。
//     同一 kind 可来自不同 source，但映射规则集中在本模块对应的 server 路由中。

/**
 * 资产来源表 — 决定一条资产来自哪张 DB 表
 */
export type AssetLibrarySource = 'generation_record' | 'canvas_asset' | 'uploaded_file'

/**
 * 可浏览的资产类别 — 用于筛选/统计/缩略图样式
 *
 * image/video/text/subtitle：来自 generation_records.category
 * character/location/shot/project：来自 canvas_assets.category 的集中映射
 * upload：来自 uploaded_files
 */
export type AssetLibraryKind
  = | 'image'
    | 'video'
    | 'text'
    | 'subtitle'
    | 'upload'
    | 'character'
    | 'location'
    | 'shot'
    | 'project'

/**
 * 统一资产状态过滤 — 跨来源归一后的“可筛选状态”
 *
 * 不同来源的原始状态枚举不同（generation_records 有 pending/submitting/...，
 * canvas_assets 有 queued/running/...）。这里归并为面向用户的过滤语义：
 *   - running：生成中（generation 的 submitting/processing/saving_output + canvas 的 running）
 *   - queued：排队中（generation 的 pending + canvas 的 queued）
 *   - succeeded/failed/cancelled：终态，直接对应
 */
export type AssetLibraryStatusFilter
  = | 'all'
    | 'succeeded'
    | 'failed'
    | 'cancelled'
    | 'running'
    | 'queued'

/**
 * 资产中心列表排序选项
 *
 * - created_desc：按创建时间倒序（默认，与历史行为一致）
 * - created_asc：按创建时间正序（最早的在前）
 * - title_asc / title_desc：按卡片标题字母序（中文按 localeCompare）
 *
 * 排序在 route 合并 generation_records / canvas_assets / uploaded_files 三来源后
 * 统一做，不影响各 repo 的内部分页（repo 仍然按 createdAt desc）。
 */
export type AssetLibrarySort
  = | 'created_desc'
    | 'created_asc'
    | 'title_asc'
    | 'title_desc'

/**
 * 单条统一资产 — 页面渲染所需的最小标量集合
 */
export interface AssetLibraryItem {
  /** 主键（来源表的主键），前端用作 React key */
  id: string
  /** 来源表 */
  source: AssetLibrarySource
  /** 可浏览类别（集中映射后） */
  kind: AssetLibraryKind
  /** 原始状态字符串（来源表的真实状态，如 'succeeded' / 'processing'） */
  status: string
  /** 卡片标题（model / 文件名 / 类别中文标签） */
  title: string
  /** 使用的 AI 模型（上传文件无） */
  model: string | null
  /** 预览 URL（图片/视频缩略，文本类为 null），优先稳定 publicUrl */
  previewUrl: string | null
  /** 下载 URL（与 previewUrl 同源，便于单独鉴权/CDN） */
  downloadUrl: string | null
  /** Canvas 项目 ID（普通生成记录可能从 inputParams 提取，上传文件无） */
  projectId: string | null
  /** Canvas 目标实体类型（character/location/shot/project） */
  targetEntityType: string | null
  /** Canvas 目标实体 ID */
  targetEntityId: string | null
  /** prompt 摘要（从 inputParams/inputJson 安全提取） */
  prompt: string | null
  /** 费用（整数分，无则 null） */
  costCents: number | null
  /** 创建时间 ISO 字符串 */
  createdAt: string
}

/**
 * 统一资产列表响应
 *
 * total 为当前查询条件（source/kind/status/projectId/limit/offset）下返回的条目数，
 * 与现有 /api/records 的 total 语义一致（返回的 items 数量，非全量计数）。
 *
 * hasMore 为轻量分页标记（v1.1）：当返回条数 >= limit 时为 true，提示前端可继续
 * 「加载更多」。由于三来源各自按 limit/offset 分页后合并，hasMore 是“可能有更多”
 * 的启发式，不是精确全量计数（短期不做 SQL count）。
 */
export interface AssetLibraryListResponse {
  success: true
  items: AssetLibraryItem[]
  total: number
  hasMore?: boolean
}

/**
 * 资产中心列表查询参数 — 前端 API client 与 server query 共用
 *
 * model/createdFrom/createdTo 在服务端下推到 SQL（v1.1），不再只在前端本地过滤。
 * createdFrom/createdTo 为 ISO 日期字符串，服务端解析为 Date 后用 createdAt 范围筛选。
 */
export interface AssetLibraryQuery {
  source?: 'all' | AssetLibrarySource
  kind?: 'all' | AssetLibraryKind
  status?: AssetLibraryStatusFilter
  projectId?: string
  /** 关键词搜索（服务端 trim 后生效，空字符串等同未传，限长 120 字符） */
  search?: string
  /** 模型精确匹配（generation_records.model / canvas_assets.model；上传文件无 model，非空时跳过 uploads） */
  model?: string
  /** 创建时间下界（含），ISO 日期字符串 */
  createdFrom?: string
  /** 创建时间上界（含），ISO 日期字符串 */
  createdTo?: string
  /** 排序方式，缺省 created_desc */
  sort?: AssetLibrarySort
  limit?: number
  offset?: number
}
