import type { CanvasPipelinePhase as SharedCanvasPipelinePhase } from '@excuse/shared'
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'
import type { accounts, canvasAssetCategoryEnum, canvasAssets, canvasAssetStatusEnum, canvasCharacters, canvasContinuityReports, canvasLocations, canvasPipelinePhaseEnum, canvasPipelineRuns, canvasPipelineRunStatusEnum, canvasProjects, canvasProjectStatusEnum, canvasShots, canvasShotStatusEnum, creditAccounts, creditTransactions, generationCategoryEnum, generationRecords, generationStatusEnum, notifications, subtitleProjects, subtitleProjectStatusEnum, taskDomainEnum, tasks, taskStatusEnum, uploadedFiles, usageEvents } from './schema'

// ===== Drizzle 行类型（从 schema 自动推导） =====

/** accounts 表 — 查询结果行类型 */
export type AccountRow = InferSelectModel<typeof accounts>

/** accounts 表 — 插入参数类型 */
export type AccountInsert = InferInsertModel<typeof accounts>

/** generation_records 表 — 查询结果行类型 */
export type GenerationRecordRow = InferSelectModel<typeof generationRecords>

/** generation_records 表 — 插入参数类型 */
export type GenerationRecordInsert = InferInsertModel<typeof generationRecords>

/** uploaded_files 表 — 查询结果行类型 */
export type UploadedFileRow = InferSelectModel<typeof uploadedFiles>

/** uploaded_files 表 — 插入参数类型 */
export type UploadedFileInsert = InferInsertModel<typeof uploadedFiles>

/** canvas_projects 表 — 查询结果行类型 */
export type CanvasProjectRow = InferSelectModel<typeof canvasProjects>

/** canvas_projects 表 — 插入参数类型 */
export type CanvasProjectInsert = InferInsertModel<typeof canvasProjects>

/** canvas_characters 表 — 查询结果行类型 */
export type CanvasCharacterRow = InferSelectModel<typeof canvasCharacters>

/** canvas_characters 表 — 插入参数类型 */
export type CanvasCharacterInsert = InferInsertModel<typeof canvasCharacters>

/** canvas_assets 表 — 查询结果行类型 */
export type CanvasAssetRow = InferSelectModel<typeof canvasAssets>

/** canvas_assets 表 — 插入参数类型 */
export type CanvasAssetInsert = InferInsertModel<typeof canvasAssets>

/** canvas_locations 表 — 查询结果行类型 */
export type CanvasLocationRow = InferSelectModel<typeof canvasLocations>

/** canvas_locations 表 — 插入参数类型 */
export type CanvasLocationInsert = InferInsertModel<typeof canvasLocations>

/** canvas_shots 表 — 查询结果行类型 */
export type CanvasShotRow = InferSelectModel<typeof canvasShots>

/** canvas_shots 表 — 插入参数类型 */
export type CanvasShotInsert = InferInsertModel<typeof canvasShots>

/** canvas_continuity_reports 表 — 查询结果行类型 */
export type CanvasContinuityRow = InferSelectModel<typeof canvasContinuityReports>

/** canvas_continuity_reports 表 — 插入参数类型 */
export type CanvasContinuityInsert = InferInsertModel<typeof canvasContinuityReports>

/** canvas_pipeline_runs 表 — 查询结果行类型 */
export type CanvasPipelineRunRow = InferSelectModel<typeof canvasPipelineRuns>

/** canvas_pipeline_runs 表 — 插入参数类型 */
export type CanvasPipelineRunInsert = InferInsertModel<typeof canvasPipelineRuns>

/** credit_accounts 表 — 查询结果行类型 */
export type CreditAccountRow = InferSelectModel<typeof creditAccounts>

/** credit_accounts 表 — 插入参数类型 */
export type CreditAccountInsert = InferInsertModel<typeof creditAccounts>

/** credit_transactions 表 — 查询结果行类型 */
export type CreditTransactionRow = InferSelectModel<typeof creditTransactions>

/** credit_transactions 表 — 插入参数类型 */
export type CreditTransactionInsert = InferInsertModel<typeof creditTransactions>

/** usage_events 表 — 查询结果行类型 */
export type UsageEventRow = InferSelectModel<typeof usageEvents>

/** usage_events 表 — 插入参数类型 */
export type UsageEventInsert = InferInsertModel<typeof usageEvents>

/** notifications 表 — 查询结果行类型 */
export type NotificationRow = InferSelectModel<typeof notifications>

/** notifications 表 — 插入参数类型 */
export type NotificationInsert = InferInsertModel<typeof notifications>

/** tasks 表 — 查询结果行类型 */
export type TaskRow = InferSelectModel<typeof tasks>

/** tasks 表 — 插入参数类型 */
export type TaskInsert = InferInsertModel<typeof tasks>

/** subtitle_projects 表 — 查询结果行类型 */
export type SubtitleProjectRow = InferSelectModel<typeof subtitleProjects>

/** subtitle_projects 表 — 插入参数类型 */
export type SubtitleProjectInsert = InferInsertModel<typeof subtitleProjects>

// ===== 枚举类型（从 pgEnum 定义推断） =====

/** 生成内容类别：从 pgEnum 定义推断 */
export type GenerationCategory = typeof generationCategoryEnum.enumValues extends (infer T)[] ? T : never

/** 生成任务状态：从 pgEnum 定义推断 */
export type GenerationStatus = typeof generationStatusEnum.enumValues extends (infer T)[] ? T : never

/** 画布项目状态：从 pgEnum 定义推断 */
export type CanvasProjectStatus = typeof canvasProjectStatusEnum.enumValues extends (infer T)[] ? T : never

/** 画布镜头状态：从 pgEnum 定义推断 */
export type CanvasShotStatus = typeof canvasShotStatusEnum.enumValues extends (infer T)[] ? T : never

/**
 * 画布流水线阶段 — 权威源在 @excuse/shared（canvas-phases 注册表）。
 *
 * 此处做编译期双向断言：DB 的 `canvas_pipeline_phase` pgEnum 值集合必须精确等于
 * shared 的 `CanvasPipelinePhase` 集合。新增阶段时若只改了 shared 没补 pgEnum
 * （或反之），此断言编译失败并给出明确错误，阻止 silent drift。
 * 真正的 pgEnum 字面量仍留在 schema 文件里（drizzle-kit 生成迁移需要字面量）。
 */
type _DbCanvasPipelinePhase = typeof canvasPipelinePhaseEnum.enumValues extends (infer T)[] ? T : never
type _AssertCanvasPhaseSync
  = [_DbCanvasPipelinePhase] extends [SharedCanvasPipelinePhase]
    ? [SharedCanvasPipelinePhase] extends [_DbCanvasPipelinePhase]
        ? true
        : 'ERR: shared 有阶段不在 DB canvas_pipeline_phase pgEnum 中（需补 pgEnum + db:generate 迁移）'
    : 'ERR: DB canvas_pipeline_phase pgEnum 含 shared 中不存在的阶段'
// 导出以强制条件类型求值：失配时解析为错误字面量，`true` 不可赋值 → 编译失败并显示上面的信息。
// 前导下划线标记其为内部断言，非公开 API。
export const _assertCanvasPhaseSync: _AssertCanvasPhaseSync = true
export type CanvasPipelinePhase = SharedCanvasPipelinePhase

/** 画布流水线运行状态：从 pgEnum 定义推断 */
export type CanvasPipelineRunStatus = typeof canvasPipelineRunStatusEnum.enumValues extends (infer T)[] ? T : never

/** 画布资产类别：从 pgEnum 定义推断 */
export type CanvasAssetCategory = typeof canvasAssetCategoryEnum.enumValues extends (infer T)[] ? T : never

/** 画布资产状态：从 pgEnum 定义推断 */
export type CanvasAssetStatus = typeof canvasAssetStatusEnum.enumValues extends (infer T)[] ? T : never

/** 字幕项目状态：从 pgEnum 定义推断 */
export type SubtitleProjectStatus = typeof subtitleProjectStatusEnum.enumValues extends (infer T)[] ? T : never

/** 任务状态：从 pgEnum 定义推断 */
export type TaskStatus = typeof taskStatusEnum.enumValues extends (infer T)[] ? T : never

/** 任务域：从 pgEnum 定义推断 */
export type TaskDomain = typeof taskDomainEnum.enumValues extends (infer T)[] ? T : never

// ===== 序列化工具类型 =====

/**
 * JSON 序列化工具类型
 * 将 Drizzle 行类型中的 Date 转为 string，模拟 HTTP JSON 传输后的实际类型
 */
export type Serialize<T> = T extends Date
  ? string
  : T extends null
    ? null
    : T extends (infer U)[]
      ? Serialize<U>[]
      : T extends object
        ? { -readonly [K in keyof T]: Serialize<T[K]> }
        : T

/**
 * 运行时序列化 — {@link Serialize} 类型工具的运行时对应物。
 *
 * 递归把值中的 `Date` 转为 ISO 字符串（数组与普通对象递归遍历），
 * 用于把 Drizzle 行（含 `Date`）转为前端兼容的 DTO（ISO 字符串），
 * 取代路由层各自手写的 `serializeXxx` Date→ISO 映射。
 *
 * 纯函数，无 IO 依赖：`null`/原始类型原样返回，`Date` → ISO 字符串，
 * 数组逐元素递归，普通对象逐字段递归。非 Date 的 JSONB 内容结构不变。
 */
export function serialize<T>(value: T): Serialize<T> {
  if (value instanceof Date) {
    return value.toISOString() as unknown as Serialize<T>
  }
  if (Array.isArray(value)) {
    return value.map(serialize) as unknown as Serialize<T>
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>)) {
      out[key] = serialize((value as Record<string, unknown>)[key])
    }
    return out as unknown as Serialize<T>
  }
  return value as unknown as Serialize<T>
}

/** generation_records 序列化后类型（Date → string） */
export type GenerationRecordSerialized = Serialize<GenerationRecordRow>

/** uploaded_files 序列化后类型（Date → string） */
export type UploadedFileSerialized = Serialize<UploadedFileRow>

/** canvas_projects 序列化后类型（Date → string） */
export type CanvasProjectSerialized = Serialize<CanvasProjectRow>

/** canvas_characters 序列化后类型（Date → string） */
export type CanvasCharacterSerialized = Serialize<CanvasCharacterRow>

/** canvas_locations 序列化后类型（Date → string） */
export type CanvasLocationSerialized = Serialize<CanvasLocationRow>

/** canvas_shots 序列化后类型（Date → string） */
export type CanvasShotSerialized = Serialize<CanvasShotRow>

/** canvas_pipeline_runs 序列化后类型（Date → string） */
export type CanvasPipelineRunSerialized = Serialize<CanvasPipelineRunRow>

/** canvas_assets 序列化后类型（Date → string） */
export type CanvasAssetSerialized = Serialize<CanvasAssetRow>

// ===== 查询过滤条件 =====

/** 生成记录列表查询过滤条件 */
export interface ListGenerationRecordsFilter {
  /** 用户 ID 过滤 */
  accountId?: string
  /** 分类过滤（text/image/video/subtitle） */
  category?: GenerationCategory
  /** 单状态过滤 */
  status?: GenerationStatus
  /** 多状态过滤（inArray）；提供时优先于 status，用于资产中心跨状态聚合 */
  statuses?: GenerationStatus[]
  /** 项目 ID 过滤（Canvas 视频遗留路径写入 inputParams.projectId），按 JSONB 提取 */
  projectId?: string
  /** 模型精确匹配（资产中心按模型筛选） */
  model?: string
  /** 关键词搜索（ilike model / inputParams::text / outputResult::text） */
  search?: string
  /** 创建时间下界（含） */
  createdFrom?: Date
  /** 创建时间上界（含） */
  createdTo?: Date
  /** 排除已隐藏的记录（资产中心默认排除） */
  excludeHidden?: boolean
  /** 每页条数 */
  limit?: number
  /** 偏移量 */
  offset?: number
}
