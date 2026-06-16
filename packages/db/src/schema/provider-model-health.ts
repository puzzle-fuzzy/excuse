import { index, integer, pgEnum, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core'

/**
 * Provider 模型健康状态枚举 —— 断路器降级状态机值。
 *
 * 状态机（详见 @excuse/provider-health）：
 *   healthy → degraded：连续失败达到阈值（failureThreshold）。
 *   degraded → healthy：冷却窗口内某次真实调用成功（或管理员手动恢复）。
 *
 * `status` 列是「最后一次设置」的快照；是否真正阻断调用由纯函数 `isDegraded`
 * （status==='degraded' 且仍在 degraded_until 之前）判定，因此列值为 degraded
 * 但 degraded_until 已过期时，视为半开（half-open）可探测。
 */
export const providerModelHealthStatusEnum = pgEnum('provider_model_health_status', [
  'healthy',
  'degraded',
])

/**
 * Provider 模型健康表 —— 跨进程（server + worker）共享的模型降级状态。
 *
 * 每个 model 一行（model 为主键）。server / worker 的 provider 调用 observer
 * 在每次调用结束后经 `recordProviderOutcome` 用 SELECT FOR UPDATE 串行化更新，
 * 保证连续失败计数在并发下正确递增。
 *
 * 与 `generation_records` 的失败聚合（admin provider stats）互补：
 *   - generation_records：时间窗口内的失败率/成本（历史聚合）。
 *   - provider_model_health：当前是否应阻断新调用的实时状态（断路器）。
 */
export const providerModelHealth = pgTable('provider_model_health', {
  /** 模型 ID（model-configs 的 key，如 'qwen-max'），主键 */
  model: varchar('model', { length: 100 }).primaryKey(),
  /** 健康状态快照（实际阻断由 degraded_until 时间窗判定） */
  status: providerModelHealthStatusEnum('status').notNull().default('healthy'),
  /** 连续失败次数；任一成功清零 */
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  /** 累计失败次数（只增，admin 诊断） */
  totalFailures: integer('total_failures').notNull().default(0),
  /** 累计成功次数（只增） */
  totalSuccesses: integer('total_successes').notNull().default(0),
  /** 降级冷却截止时间；status!=='degraded' 时为 null */
  degradedUntil: timestamp('degraded_until', { withTimezone: true }),
  lastFailureAt: timestamp('last_failure_at', { withTimezone: true }),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  /** 最近一次失败的错误摘要 */
  lastErrorMessage: text('last_error_message'),
  /** 触发降级的原因摘要 */
  degradedReason: text('degraded_reason'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  /** admin / metrics 查询「当前降级模型」：status + degraded_until */
  index('idx_provider_model_health_status').on(table.status, table.degradedUntil),
])
