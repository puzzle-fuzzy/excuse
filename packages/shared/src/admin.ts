export interface AdminSummary {
  totalUsers: number
  activeUsers: number
  totalGenerationRecords: number
  failedGenerationRecords: number
  totalCostCents: number
  activeTasks: number
  activeCanvasProjects: number
}

export interface AdminStatusCount {
  status: string
  count: number
}

export interface AdminTaskQueueCount {
  domain: string
  status: string
  count: number
}

export type AdminTaskAction = 'requeue' | 'cancel'

export interface AdminTaskListQuery {
  status?: string
  domain?: string
  search?: string
  limit?: number
  offset?: number
}

export interface AdminTaskItem {
  id: string
  accountId: string
  type: string
  domain: string
  status: string
  priority: number
  attempts: number
  maxAttempts: number
  projectId: string | null
  targetType: string | null
  targetId: string | null
  generationRecordId: string | null
  lockedBy: string
  lockedUntil: string | null
  nextRunAt: string
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
  errorMessage: string | null
  canRequeue: boolean
  canCancel: boolean
}

export interface AdminRecentFailure {
  id: string
  kind: 'generation' | 'task' | 'canvas_pipeline'
  accountId: string | null
  title: string
  status: string
  errorMessage: string | null
  createdAt: string
  updatedAt: string | null
}

export interface AdminOverview {
  summary: AdminSummary
  generationStatus: AdminStatusCount[]
  canvasProjectStatus: AdminStatusCount[]
  taskQueue: AdminTaskQueueCount[]
  recentFailures: AdminRecentFailure[]
}

export interface AdminOverviewResponse {
  success: true
  data: AdminOverview
}

export interface AdminTaskListResponse {
  success: true
  items: AdminTaskItem[]
  total: number
}

export interface AdminTaskMutationResponse {
  success: true
  data: AdminTaskItem
}

// ── 用户级运营统计 ──────────────────────────────────────────────────────────

export interface AdminUserSummary {
  id: string
  username: string
  email: string | null
  isActive: boolean
  createdAt: string
  /** 最近一条 generation_records.createdAt（无活动则为 null） */
  lastActivityAt: string | null
  /** 当前可用余额（credit_accounts.availableCents） */
  creditBalanceCents: number
  /** 历史总成本（generation_records.totalPriceCents 累加） */
  totalCostCents: number
  /** 历史总调用次数（generation_records 计数） */
  totalCalls: number
}

export interface AdminUserDailyCost {
  /** YYYY-MM-DD */
  date: string
  costCents: number
  calls: number
}

export interface AdminUserModelBreakdown {
  model: string
  calls: number
  costCents: number
}

export interface AdminUserRecentRecord {
  id: string
  model: string
  status: string
  costCents: number
  createdAt: string
  /** generation_records.taskId；旧 generate 视频为 provider task id，不是统一 tasks.id */
  providerTaskId: string | null
  executionKind: 'inline' | 'legacy-provider-task' | 'canvas-worker' | 'gateway'
}

export interface AdminUserDetail {
  summary: AdminUserSummary
  /** 最近 30 天每日成本 */
  dailyCost: AdminUserDailyCost[]
  /** 按模型分组的成本分解（取前 10） */
  modelBreakdown: AdminUserModelBreakdown[]
  /** 最近 10 条 generation_records 摘要 */
  recentRecords: AdminUserRecentRecord[]
}

export interface AdminUserListQuery {
  search?: string
  isActive?: boolean
  limit?: number
  offset?: number
}

export interface AdminUserListResponse {
  success: true
  items: AdminUserSummary[]
  total: number
}

export interface AdminUserDetailResponse {
  success: true
  data: AdminUserDetail
}

// ── Provider 错误率 / 模型成本 ──────────────────────────────────────────────

export interface AdminProviderStatsItem {
  model: string
  category: string
  totalCalls: number
  succeededCalls: number
  failedCalls: number
  /** 0~1 浮点（前端 ×100 显示百分比） */
  failureRate: number
  /** 进程内 provider 调用延迟均值；metricsCollector 刚启动未采样到时为 null */
  avgLatencyMs: number | null
  p50LatencyMs: number | null
  p95LatencyMs: number | null
  totalCostCents: number
  totalInputTokens: number
  totalOutputTokens: number
  /** 断路器降级状态（provider_model_health）；该 model 从未失败过时为 null */
  health?: AdminProviderHealthSummary | null
}

export interface AdminProviderStatsResponse {
  success: true
  windowHours: number
  items: AdminProviderStatsItem[]
}

// ── Provider 模型降级状态（断路器）──────────────────────────────────────────

/**
 * Provider 模型降级状态摘要 —— 挂在 admin provider stats item 上，也可独立列表。
 *
 * `blocking` 是「当前是否真正阻断新调用」的实时判定（status degraded 且仍在
 * degradedUntil 冷却窗口内），与 status 列值区分（后者是最后一次设置的快照，
 * 冷却过期后即使列值仍为 degraded 也不再阻断）。
 */
export interface AdminProviderHealthSummary {
  model: string
  status: 'healthy' | 'degraded'
  blocking: boolean
  consecutiveFailures: number
  totalFailures: number
  totalSuccesses: number
  /** 降级恢复剩余秒数；非阻断时为 null */
  remainingSeconds: number | null
  degradedUntil: string | null
  lastFailureAt: string | null
  lastSuccessAt: string | null
  lastErrorMessage: string | null
  degradedReason: string | null
  updatedAt: string
}

export interface AdminProviderHealthListResponse {
  success: true
  items: AdminProviderHealthSummary[]
}

export interface AdminProviderHealthRestoreResponse {
  success: true
  health: AdminProviderHealthSummary
}

// ── 任务详情 + Canvas pipeline run 级联 ──────────────────────────────────────

export interface AdminPipelineRun {
  id: string
  projectId: string | null
  phase: string
  status: string
  startedAt: string | null
  finishedAt: string | null
  /** finishedAt - startedAt，repo 层计算，避免前端处理时区 */
  durationMs: number | null
  errorMessage: string | null
  /** outputSummaryJson 解析后的对象；形状随 phase 变化，前端只做摘要展示 */
  outputSummary: Record<string, unknown> | null
  createdAt: string
}

export interface AdminTaskDetail {
  task: AdminTaskItem
  /** canvas_pipeline_runs.taskId = tasks.id，按 createdAt asc */
  pipelineRuns: AdminPipelineRun[]
  /**
   * 关联生成记录（诊断用），帮助运营定位「任务 → 扣费/产物/错误原因」。
   * - matchReason='direct'：task.generationRecordId 直接命中（如 subtitle 烧录导出回填）。
   * - matchReason='worker-task' / 'pipeline-run'：Canvas worker 写入诊断元数据后精确命中。
   * - matchReason='time-window'：无直接关联时，按 accountId + 任务执行时间窗口返回候选。
   */
  generationRecords: AdminTaskGenerationRecord[]
}

export interface AdminTaskGenerationRecord {
  id: string
  model: string
  category: string
  status: string
  /** totalPriceCents（权威整数分）；部分记录未结算时为 null */
  costCents: number | null
  createdAt: string
  errorMessage: string | null
  /** direct / worker-task / pipeline-run 为精确命中；time-window = accountId+时间窗口候选 */
  matchReason: 'direct' | 'worker-task' | 'pipeline-run' | 'time-window'
}

export interface AdminTaskDetailResponse {
  success: true
  data: AdminTaskDetail
}

// ── 项目细粒度检索 ───────────────────────────────────────────────────────────

export interface AdminProjectItem {
  id: string
  accountId: string
  username: string | null
  title: string
  status: string
  /** 镜头总数 */
  shotCount: number
  /** 已完成的镜头数 */
  completedShotCount: number
  /** 模型偏好摘要（从 modelPreferencesJson 提取） */
  modelSummary: string
  isDeleted: boolean
  createdAt: string
  updatedAt: string | null
}

export interface AdminProjectListQuery {
  search?: string
  status?: string
  isDeleted?: boolean
  limit?: number
  offset?: number
}

export interface AdminProjectListResponse {
  success: true
  items: AdminProjectItem[]
  total: number
}

// ── 审计日志 ──────────────────────────────────────────────────────────────────

export interface AdminAuditLogItem {
  id: string
  accountId: string | null
  action: string
  targetId: string | null
  detail: Record<string, unknown> | null
  ip: string | null
  createdAt: string
}

export interface AdminAuditLogListQuery {
  accountId?: string
  action?: string
  from?: string
  to?: string
  limit?: number
  offset?: number
}

export interface AdminAuditLogListResponse {
  success: true
  items: AdminAuditLogItem[]
  total: number
}

// ── 管理后台 API Key 展示 ─────────────────────────────────────────────────────

export interface AdminApiKeyItem {
  id: string
  prefix: string
  name: string | null
  scope: string
  rateLimitPerMinute: number | null
  quotaMaxCents: number | null
  totalSpendCents: number
  quotaResetAt: string | null
  lastUsedAt: string | null
  createdAt: string
  revokedAt: string | null
}

export interface AdminApiKeyListResponse {
  success: true
  items: AdminApiKeyItem[]
}

// ── Gateway 客户管理 ──────────────────────────────────────────────────────────

/** Gateway 客户聚合列表项 —— 一个持有 ≥1 个 API Key 的账户 */
export interface AdminGatewayClientItem {
  accountId: string
  username: string
  email: string | null
  /** 未撤销的 key 数 */
  activeKeyCount: number
  /** 全部 key 数（含已撤销） */
  totalKeyCount: number
  /** 该账户所有 key 的 totalSpendCents 之和（受配额周期重置影响） */
  totalSpendCents: number
  /** 该账户所有 key 的 quotaMaxCents 之和；任一 key 无限额（null）则整体为 null */
  totalQuotaCents: number | null
  /** max(api_keys.lastUsedAt) */
  lastKeyActivityAt: string | null
}

export interface AdminGatewayClientListQuery {
  search?: string
  limit?: number
  offset?: number
}

export interface AdminGatewayClientListResponse {
  success: true
  items: AdminGatewayClientItem[]
  total: number
}

/** 单个 Gateway 客户的账户摘要（详情顶部） */
export interface AdminGatewayClientSummary {
  accountId: string
  username: string
  email: string | null
  /** credit_accounts.availableCents */
  creditBalanceCents: number
  activeKeyCount: number
  totalKeyCount: number
  totalSpendCents: number
  totalQuotaCents: number | null
  /** generation_records source=gateway 的调用计数 */
  gatewayCalls: number
  /** generation_records source=gateway 的 totalPriceCents 之和（累计、不随配额重置归零） */
  gatewaySpendCents: number
  lastKeyActivityAt: string | null
}

export interface AdminGatewayRecentRecord {
  id: string
  model: string
  status: string
  costCents: number
  createdAt: string
}

export interface AdminGatewayClientDetail {
  summary: AdminGatewayClientSummary
  /** 该账户所有 key（含已撤销） */
  keys: AdminApiKeyItem[]
  /** 最近 50 条 Gateway 调用记录 */
  recentGatewayRecords: AdminGatewayRecentRecord[]
}

export interface AdminGatewayClientDetailResponse {
  success: true
  data: AdminGatewayClientDetail
}

// ── 管理后台充值 ──────────────────────────────────────────────────────────

export interface AdminCreditAddResponse {
  success: true
  data: import('./billing').CreditTransactionDTO
}
