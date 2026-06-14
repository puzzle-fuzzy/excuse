# Claude A 下一轮执行计划：管理后台运营统计深化（用户级用量 + provider 错误率/成本统计）

更新时间：2026-06-15

本文给 Claude A 执行。Claude B 当前在处理 **P4.1 成熟库 zod runtime 校验迁移第一批**（`packages/gateway` + `packages/prompt-engine` 把外部输入边界的「裸 cast / 手写校验」改为 zod parse + 类型守卫），Claude A 本轮推进 P3.2「管理后台和运营能力」剩余的两条待办：用户级用量/成本统计 + provider 错误率/模型成本统计。让 admin 后台从「全局概览」升级为「可下钻的运营统计」。

不要碰 packages/gateway、packages/prompt-engine、packages/metrics、packages/provider、packages/canvas-runtime、apps/worker、Canvas 客户端、表单页面、SSE 客户端。

## 上轮复核结论（已通过）

上一轮 Claude A 完成并提交：

- `7f587f2 refactor(client): migrate forms to react-hook-form with zod validation`
- `f87ad1c docs(changelog): backfill react-hook-form migration commit hash`

复核结果：

- `apps/client/src/pages/Login.tsx`、`Register.tsx`、`ModelLab.tsx`（参数表单区）从手写 `useState` + 内联校验替换为 `react-hook-form` + `zod` resolver。
- `apps/client/src/lib/form-schemas.ts`：新建，统一定义 `loginSchema` / `registerSchema` / `apiKeyCreateSchema` + `buildModelLabSchema(parameters)` 动态 schema builder。
- `apps/client/package.json`：新增 `@hookform/resolvers` + `zod@4.4.3` 依赖。
- 补 `apps/client/test/form-schemas.test.ts`（18 条）+ `apps/client/test/model-lab-form.test.ts`（11 条），合计 29 条新测试。
- `bun run typecheck`：server / client / worker 三端通过。
- 暂存区零跨界。

保持上一轮的纪律。

## 本轮目标

推进 P3.2「管理后台和运营能力」剩余两条：

1. **用户级用量和成本统计**：admin 后台新增「用户列表」+「用户详情」，展示信用余额、月度生成量、成本明细；当前 admin 只有全局 `getAdminOverview`，无法回答「具体某个用户消耗多少」。
2. **provider 错误率和模型成本统计**：admin 后台新增「Provider 指标」tab，复用既有 `excuse_provider_calls_total{model,status}` + `excuse_provider_latency_seconds{model,quantile}`（commit: `9b0a37a`）和 `generation_records.cost` 聚合，让运营能定位「哪个模型失败率最高」「哪个模型最贵」。

当前状态：

- `apps/server/src/routes/admin.ts`（117 行）：当前只有 `GET /api/admin/overview` + `GET /api/admin/tasks` + `POST /api/admin/tasks/:id/requeue` + `POST /api/admin/tasks/:id/cancel`。鉴权通过 `canAccessAdmin(config, userId)` + `ADMIN_USER_IDS` 配置限制；derive 注入 `adminAllowed` / `adminDenied` helper。
- `packages/db/src/repositories/admin.repo.ts`（399 行）：当前导出 `getAdminOverview` / `listAdminTasks` / `requeueAdminTask` / `cancelAdminTask`。所有 SQL 用 Drizzle query builder + `sql<number>` 模板拼装，`numberValue()` / `iso()` helper 做类型转换。`AdminTaskItem` 等类型在本文件内**重复定义**（与 `packages/shared/src/admin.ts` 同名但独立），既有现状保持不变。
- `packages/shared/src/admin.ts`（91 行）：barrel-exported via `packages/shared/src/index.ts`。定义 `AdminOverview` / `AdminTaskListResponse` / `AdminTaskMutationResponse` / `AdminOverviewResponse` 等 response DTO（route 用 `satisfies` 收窄）。本轮新增 DTO 追加到本文件。
- `apps/client/src/pages/Admin.tsx`：当前是单页 admin，已展示概览卡片 + 任务诊断区（commit: `104fe2f`）。本轮扩 tab。具体结构需读源文件确认。
- `credit_accounts` / `credit_transactions` / `usage_events` 表：credit/usage 查询基础已具备（schema 见 `packages/db/src/schema/`）。
- 上一轮 Claude B 已完成 provider 指标 in-process 采集（`excuse_provider_calls_total` + `excuse_provider_latency_seconds`）+ DB-derived 聚合（`excuse_canvas_phase_total` 等），但**这些指标只在 `/metrics` Prometheus 端点暴露**，admin 后台 UI 看不到。本轮通过**直接查 `generation_records.cost` 表 + 在 server 进程内 `metricsCollector.snapshot()`** 给 admin 用，**不依赖 Prometheus scrape**。

本轮要做的：

1. **`packages/shared/src/admin.ts` — 新增 DTO**：
   - `AdminUserSummary`：用户列表项（id、username、email、isActive、createdAt、lastActivityAt、creditBalanceCents、totalCostCents、totalCalls）。
   - `AdminUserDetail`：单用户下钻（summary 字段 + 最近 30 天每日 cost 趋势 + 按模型分组的成本分解 + 最近 10 条 generation_records 摘要）。
   - `AdminProviderStatsItem`：单模型统计（model、category、totalCalls、succeededCalls、failedCalls、failureRate、avgLatencyMs、p50LatencyMs、p95LatencyMs、totalCostCents、totalInputTokens、totalOutputTokens）。
   - 对应 response 类型：`AdminUserListResponse` / `AdminUserDetailResponse` / `AdminProviderStatsResponse`。
2. **`packages/db/src/repositories/admin.repo.ts` — 新增 repository 函数**：
   - `listAdminUsers(query: { search?, isActive?, limit?, offset? }): Promise<{ items: AdminUserSummary[], total: number }>`：join `accounts` + `credit_accounts`（取 balance）+ 子查询聚合 `generation_records`（count + sum cost），支持用户名/邮箱搜索 + 状态过滤 + 分页。
   - `getAdminUserDetail(accountId: string): Promise<AdminUserDetail | null>`：单账户下钻。包含 30 天每日 cost（`GROUP BY date_trunc('day', created_at)`）+ 按模型分组（`GROUP BY model`）+ 最近 10 条 generation_records（id、model、status、cost、createdAt）。
   - `getAdminProviderStats(windowHours: number = 24): Promise<AdminProviderStatsItem[]>`：从 `generation_records` 聚合 per-model 统计（近 N 小时内），输出 totalCalls/succeeded/failed/failureRate/totalCostCents/totalInputTokens/totalOutputTokens；avg/p50/p95 latency 从 server 进程内 `metricsCollector.snapshot().providerCalls` 拿（**这个字段在 repository 层无法访问**，因此拆为两段：repository 出 cost/count 部分，server route 合并 metrics 部分 — 见步骤 5 详述）。
   - 复用既有 `numberValue()` / `iso()` helper。
3. **`apps/server/src/routes/admin.ts` — 新增 endpoints**：
   - `GET /api/admin/users?search=&isActive=&limit=&offset=` → `AdminUserListResponse`。
   - `GET /api/admin/users/:id` → `AdminUserDetailResponse`（用户不存在 → 404）。
   - `GET /api/admin/providers?windowHours=` → `AdminProviderStatsResponse`。这个 endpoint 内部调 `getAdminProviderStats(windowHours)` 拿 DB 部分（cost/count），再调 `metricsCollector.snapshot().providerCalls` 拿 latency 部分（in-process），**route 层做合并**（保持 packages/db 不依赖 server runtime 单例）。
   - 所有 endpoint 复用既有 `adminAllowed` / `adminDenied` derive guard。
   - 路由 detail 标签统一打 `tags: ['管理后台']`，security `[{ bearerAuth: [] }]`。
4. **`apps/server/src/services/metrics.ts` — 暴露 snapshot() 给 route**：
   - 检查现有 `metricsCollector` 是不是模块级单例 / 是否通过 `ServerConfig` 传递。
   - 如果是单例：admin route 直接 `import { metricsCollector } from '../services/metrics'`。
   - 如果通过 config：admin route 已经接收 `config: ServerConfig`，加 `config.metricsCollector` 引用。
   - 推荐方案：**单例 import**（最小改动），与 `apps/server/src/index.ts` 注入 `registerProviderCallObserver` 时使用的 metricsCollector 引用一致。
5. **`apps/client/src/pages/Admin.tsx` — 扩 tab UI**：
   - 先读源文件，确认现有 tab 结构（如果是单页无 tab，加 tab；如果已有 tab，扩 tab）。
   - 新增「用户」tab：
     - 列表表格：username、email、状态、信用余额、总成本、总调用数、最近活动时间。
     - 筛选：搜索框（username/email）+ 状态下拉（active/inactive/全部）。
     - 分页：上一页 / 下一页 + 总数显示（默认 limit=20）。
     - 行点击 → 展开「用户详情」面板（dialog 或 inline drawer）：30 天成本趋势（简单 bar/sparkline 或纯文本表格，不引图表库）+ 模型成本分解表格 + 最近 10 条生成记录表格。
   - 新增「Provider」tab：
     - 表格：model、category、totalCalls、succeededCalls、failedCalls、failureRate（百分比）、avgLatencyMs、p50LatencyMs、p95LatencyMs、totalCostCents、totalInputTokens、totalOutputTokens。
     - 筛选：windowHours 下拉（1h / 6h / 24h / 7d）。
     - 排序：默认按 totalCalls desc，支持点击列头排序（最小实现 — 不引表格库；如果不引表格库代价过高，先按 totalCalls desc 固定排序，列头排序留 TODO 注释）。
   - 复用既有 `useQuery` + 30s 刷新（admin overview 现有 polling 模式）。
   - 信用余额/成本展示统一用既有 `formatCents()` / `formatYuan()` helper（在 `apps/client/src/lib/` 找现有 helper；如无，inline `Intl.NumberFormat`）。
   - 不引图表库。30 天趋势用纯 CSS bar（每行一条 bar，宽度按比例）或简单 sparkline（`<svg>` 内联）。如果实现复杂，fallback 为表格（day / costCents 两列）。
6. **补 `packages/db` 测试**（如果有 admin.repo 测试基础）：
   - 如果 `packages/db/test/admin.repo.test.ts` 已存在：扩 `listAdminUsers` / `getAdminUserDetail` / `getAdminProviderStats` 测试。
   - 如果不存在：新建 `packages/db/test/admin-users-providers.repo.test.ts`（DB 集成测试，复用既有 transaction-scoped fixture）。
   - 覆盖：空表 → 空数组、单用户、搜索匹配、状态过滤、分页边界、windowHours 过滤、failureRate 计算。
7. **补 `apps/server/test/admin-routes.test.ts`**：
   - 既有 admin route 测试覆盖 overview + tasks；本轮扩 users list / user detail / providers。
   - 覆盖：非 admin 用户 403、不存在的 userId → 404、providers latency merge（mock `metricsCollector.snapshot` 返回 fixture providerCalls）。
8. **补 `apps/client` admin page 测试**：
   - 扩既有 admin-page 测试。
   - 覆盖：用户列表渲染、搜索触发 query、用户详情展开、provider 表格渲染、windowHours 切换。
9. **更新 `docs/TODO.md`**：
   - P3.2 第 2 条「用户余额明细、用户级用量和成本统计」：把括号「(全局用户 / 成本摘要已完成)」改为「(全局概览 + 用户级下钻已完成)」。
   - P3.2 第 5 条「provider 错误率和模型成本统计」：整条删除（本轮完成）。
   - 不动其他章节。
10. **更新 `CHANGELOG.md`**：
    - 在 `[Unreleased]` 的 Added 区追加本轮完成内容和 commit。

本轮不要处理：

- packages/gateway / packages/prompt-engine 的 zod 迁移（Claude B 在动）。
- packages/metrics 内部 collector 改动（上轮已完成，本轮只**消费** snapshot）。
- packages/provider 的 DashScopeClient 改动。
- API Key scope / rate limit / quota（独立任务，本轮不做）。
- OpenAI Gateway scope / rate limit（独立任务，本轮不做）。
- 失败任务深度诊断的 generation record / Canvas pipeline run 级联部分（独立任务，本轮不做；用户级 + provider 级已经足够）。
- 项目级任务检索（独立任务）。
- Worker、Canvas 客户端、Subtitle、Billing 客户端、Model Lab、表单页面。
- DB schema / migration（本轮零 schema 改动）。
- 引入图表库 / 表格库（除非复杂度过高，否则手写）。

## 重要规则：完成后必须 commit

- 本轮 1 个 commit（hash 回填可以追一个 docs commit）。
- commit 前必须运行 `git status --short` 和 `git diff --name-only --cached`。
- 暂存区只能包含本任务文件，**绝对不要**混入 Claude B 的 packages/gateway / packages/prompt-engine 文件。
- 完成事项从 `docs/TODO.md` 删除（P3.2 第 5 条整条删除；P3.2 第 2 条括号说明更新）。
- 完成记录和 commit 写入根目录 `CHANGELOG.md`。
- 如果 `docs/TODO.md` / `CHANGELOG.md` 与 Claude B 并行修改冲突，优先提交代码；文档冲突在最终回复里说明。
- commit 成功后，在最终回复里写出 commit hash。

**强制检查**：commit 前必须确认 `git diff --name-only --cached` 输出**不包含**：

- `packages/gateway/`（任何路径，Claude B 在动）
- `packages/prompt-engine/`（任何路径，Claude B 在动）
- `packages/metrics/`（任何路径，本轮零 metrics 改动，只消费 snapshot）
- `packages/provider/`（任何路径）
- `packages/canvas-engine/` / `packages/canvas-runtime/`（任何路径）
- `packages/events/` / `packages/workflow-engine/` / `packages/task-engine/`（任何路径）
- `packages/rate-limit/` / `packages/subtitle-engine/` / `packages/auth/`（任何路径）
- `packages/billing/` / `packages/ffmpeg/` / `packages/storage/`（任何路径）
- `packages/db/src/schema/`（**本轮绝对零 schema 改动**）
- `packages/db/src/repositories/`（除 `admin.repo.ts`）
- `packages/db/src/services/`
- `apps/worker/`（任何路径）
- `apps/client/src/api/`（除新增 admin api helper 文件）
- `apps/client/src/stores/`（任何 store 文件）
- `apps/client/src/hooks/`（除新增 admin hook）
- `apps/client/src/components/`（除新增 admin 组件）
- `apps/client/src/pages/`（除 `Admin.tsx`）
- `apps/client/src/lib/`（除新增的 admin helper 或 format helper 复用）
- `apps/server/src/modules/`（任何路径）
- `apps/server/src/plugins/`（任何路径）
- `apps/server/src/services/`（除 `metrics.ts` 暴露 snapshot 的最小 diff）
- `apps/server/src/routes/`（除 `admin.ts`）
- `apps/server/src/utils/`（任何路径）
- `apps/server/src/config.ts`（除非要扩 `ServerConfig.metricsCollector` 引用；如改动需说明）
- `apps/server/src/index.ts`（任何路径）
- `apps/server/test/`（除 `admin-routes.test.ts`）

## 文件边界

Claude A 可以修改：

```txt
packages/shared/src/admin.ts                                  (新增用户/Provider stats DTO)
packages/db/src/repositories/admin.repo.ts                    (新增 listAdminUsers / getAdminUserDetail / getAdminProviderStats)
packages/db/test/admin-users-providers.repo.test.ts           (新建，或追加到既有 admin.repo.test.ts)
apps/server/src/routes/admin.ts                               (新增 GET /api/admin/users, /users/:id, /providers)
apps/server/src/services/metrics.ts                           (仅当需要 export snapshot() 给 route；最小 diff)
apps/server/test/admin-routes.test.ts                         (扩 users/providers 测试)
apps/client/src/pages/Admin.tsx                               (扩 用户 tab + Provider tab)
apps/client/src/__tests__/admin-page.test.tsx                 (扩 用户列表 + provider 表格测试，或同级 admin-*.test.tsx)
apps/client/src/api/admin.ts                                  (新建或扩：admin users/providers treaty 类型化 client，仅在需要时)
apps/client/src/lib/admin-format.ts                           (新建：formatCents / formatLatencyMs helper，仅在需要时)
docs/TODO.md
CHANGELOG.md
```

Claude A 不要修改：

```txt
docs/claude-parallel-plan.md
packages/gateway/**                                           (Claude B 在动)
packages/prompt-engine/**                                     (Claude B 在动)
packages/metrics/**                                           (本轮零 metrics 改动)
packages/provider/**
packages/canvas-engine/**
packages/canvas-runtime/**
packages/events/**
packages/workflow-engine/**
packages/task-engine/**
packages/rate-limit/**
packages/subtitle-engine/**
packages/auth/**
packages/billing/**
packages/ffmpeg/**
packages/storage/**
packages/db/src/schema/**                                     (本轮绝对零 schema 改动)
packages/db/src/repositories/**（除 admin.repo.ts）
packages/db/src/services/**
apps/worker/**
apps/server/src/modules/**
apps/server/src/plugins/**
apps/server/src/services/**（除 metrics.ts 最小 diff）
apps/server/src/routes/**（除 admin.ts）
apps/server/src/utils/**
apps/server/src/config.ts                                     (除非要扩 ServerConfig；如改动需说明)
apps/server/src/index.ts
apps/server/test/**（除 admin-routes.test.ts）
apps/client/src/api/client.ts
apps/client/src/api/sse.ts
apps/client/src/api/query-client.ts
apps/client/src/stores/**
apps/client/src/hooks/**（除新增 admin hook）
apps/client/src/components/**（除新增 admin 组件）
apps/client/src/pages/**（除 Admin.tsx）
apps/client/src/lib/**（除新增 admin helper）
apps/client/src/auth/**
apps/client/src/main.tsx
apps/client/src/App.tsx
apps/client/package.json                                       (本轮零依赖新增；图表库 / 表格库不引)
apps/client/bun.lockb
```

如果必须修改边界外文件，**先停止并在最终回复说明原因**。

## 第一步：调研现有 admin 实现 + DB schema

阅读以下文件，记录调用链和扩展点：

1. `apps/client/src/pages/Admin.tsx` — 完整记录：当前 tab 结构（如果有）、useQuery 用法、过滤 / 排序 / 分页模式、与 `api.admin` treaty 调用方式、format helper 用法（formatCents / formatYuan 在哪里）。
2. `apps/client/src/__tests__/admin-page.test.tsx`（或同级文件）— 记录既有测试模式（mock api 模式、query client mock、render 等待策略）。
3. `apps/server/src/routes/admin.ts` — 已读：确认 derive 注入 `adminAllowed` / `adminDenied` + canAccessAdmin guard 模式。
4. `apps/server/test/admin-routes.test.ts` — 记录既有测试结构（treaty<App>、makeAccount + signTestToken、admin user 模拟方式）。
5. `packages/db/src/repositories/admin.repo.ts` — 已读：确认 `numberValue` / `iso` / `buildAdminTaskFilters` 模式。
6. `packages/db/src/schema/credit.ts`（或 credit_accounts / credit_transactions / usage_events 所在 schema 文件）— 确认字段名（balanceCents / amountCents / category / model / costCents 等）。
7. `packages/db/src/schema/generation-records.ts` — 确认 `cost` JSONB 字段结构（`inputTokens` / `outputTokens` / `totalPriceCents`）、`model` 字段、`status` 字段、`inputParams` JSONB（含 `requestedModel` / `source`）。
8. `apps/server/src/services/metrics.ts` — 确认 `metricsCollector` 是模块级单例还是通过 config 传递；如果是单例，确认 export 方式（`export const metricsCollector` vs `export function getMetricsCollector()`）。
9. `apps/client/src/api/` 下既有 admin api 调用（grep `api.admin`）— 确认 client 端调用方式（treaty `api.admin.overview.get()` 等）。

调研结论写入最终回复。

## 第二步：扩 packages/shared/src/admin.ts

在既有文件末尾追加 DTO（不动既有 DTO）：

```ts
// ── 用户级运营统计 ──────────────────────────────────────────────────────────

export interface AdminUserSummary {
  id: string
  username: string
  email: string | null
  isActive: boolean
  createdAt: string
  lastActivityAt: string | null  // 最近一条 generation_records.createdAt
  creditBalanceCents: number     // 当前信用余额（从 credit_accounts.balanceCents 取）
  totalCostCents: number         // 历史总成本
  totalCalls: number             // 历史总调用次数（generation_records 计数）
}

export interface AdminUserDailyCost {
  date: string        // YYYY-MM-DD
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
}

export interface AdminUserDetail {
  summary: AdminUserSummary
  dailyCost: AdminUserDailyCost[]      // 最近 30 天
  modelBreakdown: AdminUserModelBreakdown[]  // 按模型分组（取前 10）
  recentRecords: AdminUserRecentRecord[]     // 最近 10 条
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
  category: string                 // text/image/video/subtitle
  totalCalls: number
  succeededCalls: number
  failedCalls: number
  failureRate: number              // 0~1
  avgLatencyMs: number | null      // 来自 metricsCollector.snapshot.providerCalls；进程内重启归零
  p50LatencyMs: number | null
  p95LatencyMs: number | null
  totalCostCents: number
  totalInputTokens: number
  totalOutputTokens: number
}

export interface AdminProviderStatsResponse {
  success: true
  windowHours: number
  items: AdminProviderStatsItem[]
}
```

注意：
- 所有时间字段 `toISOString()`，不允许 Date 对象泄露到 API 响应。
- `failureRate` 是 0~1 浮点（前端 ×100 显示百分比）。
- `avgLatencyMs` 等可能为 null（metricsCollector 进程刚启动未采样到该 model）。

## 第三步：扩 packages/db/src/repositories/admin.repo.ts

新增三个函数。所有 SQL 用 Drizzle query builder + `sql<number>` 模板，沿用既有 `numberValue()` / `iso()` helper：

### 3a. `listAdminUsers(query)`

```ts
export interface AdminUserListQuery {
  search?: string
  isActive?: boolean
  limit?: number
  offset?: number
}

export async function listAdminUsers(
  query: AdminUserListQuery = {},
): Promise<{ items: AdminUserSummaryRow[], total: number }> {
  const limit = Math.min(Math.max(query.limit ?? 20, 1), 100)
  const offset = Math.max(query.offset ?? 0, 0)

  const conditions: SQL[] = []
  if (query.isActive !== undefined) conditions.push(eq(accounts.isActive, query.isActive))
  const search = query.search?.trim()
  if (search) {
    const pattern = `%${search}%`
    conditions.push(or(ilike(accounts.username, pattern), ilike(accounts.email, pattern))!)
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined

  // 一次 join 查询：accounts LEFT JOIN credit_accounts + 子查询聚合 generation_records
  const [rows, totalRows] = await Promise.all([
    getDb()
      .select({
        id: accounts.id,
        username: accounts.username,
        email: accounts.email,
        isActive: accounts.isActive,
        createdAt: accounts.createdAt,
        creditBalanceCents: sql<number>`coalesce(${creditAccounts.balanceCents}, 0)::int`,
        totalCostCents: sql<number>`coalesce(agg.total_cost, 0)::int`,
        totalCalls: sql<number>`coalesce(agg.total_calls, 0)::int`,
        lastActivityAt: sql<Date | null>`agg.last_activity`,
      })
      .from(accounts)
      .leftJoin(creditAccounts, eq(creditAccounts.accountId, accounts.id))
      .leftJoin(sql`(SELECT account_id, sum(total_price_cents)::int AS total_cost, count(*)::int AS total_calls, max(created_at) AS last_activity FROM generation_records GROUP BY account_id) AS agg`, sql`agg.account_id = ${accounts.id}`)
      .where(where)
      .orderBy(desc(accounts.createdAt))
      .limit(limit)
      .offset(offset),
    getDb()
      .select({ count: sql<number>`count(*)::int` })
      .from(accounts)
      .where(where),
  ])

  return {
    items: rows.map(row => ({
      id: row.id,
      username: row.username,
      email: row.email,
      isActive: row.isActive,
      createdAt: iso(row.createdAt)!,
      creditBalanceCents: numberValue(row.creditBalanceCents),
      totalCostCents: numberValue(row.totalCostCents),
      totalCalls: numberValue(row.totalCalls),
      lastActivityAt: iso(row.lastActivityAt),
    })),
    total: numberValue(totalRows[0]?.count),
  }
}
```

注意：实际 column 名以 schema 为准（`balanceCents` / `balance_cents`、`accountId` / `account_id`），调研后调整。如果不熟悉 Drizzle 的 LATERAL join 语法，可改为先查 accounts、再 Promise.all 批量查 credit + generation 聚合，JavaScript 层做 join（更简单但 SQL 数多一些）。

### 3b. `getAdminUserDetail(accountId)`

```ts
export async function getAdminUserDetail(
  accountId: string,
): Promise<AdminUserDetailRow | null> {
  // 1. 单用户 summary（与 listAdminUsers 单条同 shape）
  // 2. 30 天 daily cost：GROUP BY date_trunc('day', created_at), 表产出 { date, costCents, calls }
  // 3. 模型分组：GROUP BY model, 按 costCents desc 取前 10
  // 4. 最近 10 条 generation_records：id / model / status / totalPriceCents / createdAt
  // 全部 Promise.all 并发
}
```

如果用户不存在，返回 null（route 层 404）。

### 3c. `getAdminProviderStats(windowHours)`

**重要**：repository 层只出 DB 部分（per-model count + cost + tokens），latency 部分由 server route 从 `metricsCollector.snapshot().providerCalls` 注入并合并。

```ts
export interface AdminProviderStatsDbRow {
  model: string
  category: string                  // 从 generation_records.category 取
  totalCalls: number
  succeededCalls: number
  failedCalls: number
  totalCostCents: number
  totalInputTokens: number
  totalOutputTokens: number
}

export async function getAdminProviderStats(
  windowHours: number = 24,
): Promise<AdminProviderStatsDbRow[]> {
  return getDb()
    .select({
      model: generationRecords.model,
      category: generationRecords.category,
      totalCalls: sql<number>`count(*)::int`,
      succeededCalls: sql<number>`count(*) filter (where ${generationRecords.status} = 'succeeded')::int`,
      failedCalls: sql<number>`count(*) filter (where ${generationRecords.status} = 'failed')::int`,
      totalCostCents: sql<number>`coalesce(sum(${generationRecords.totalPriceCents}), 0)::int`,
      totalInputTokens: sql<number>`coalesce(sum((${generationRecords.cost}->>'inputTokens')::numeric), 0)::int`,
      totalOutputTokens: sql<number>`coalesce(sum((${generationRecords.cost}->>'outputTokens')::numeric), 0)::int`,
    })
    .from(generationRecords)
    .where(sql`${generationRecords.createdAt} > now() - interval '${sql.raw(String(windowHours))} hours'`)
    .groupBy(generationRecords.model, generationRecords.category)
    .orderBy(desc(sql`count(*)`))
}
```

注意：
- `interval '${windowHours} hours'` 必须用 `sql.raw(String(windowHours))` 防 SQL 注入；windowHours 已被 route 层 normalize 到整数。
- `cost->>'inputTokens'` 是 JSONB 字段访问；用 `::numeric` cast 才能 sum。
- 如果 schema 中 cost 字段名不是 `cost`（可能是 `costJson` 或在 `inputParams`），调研后调整。

## 第四步：扩 apps/server/src/routes/admin.ts

新增三个 endpoint：

```ts
.get('/users', async ({ adminAllowed, adminDenied, query }) => {
  if (!adminAllowed) return adminDenied()
  const result = await listAdminUsers({
    search: query.search,
    isActive: query.isActive,
    limit: query.limit,
    offset: query.offset,
  })
  return { success: true, items: result.items, total: result.total } satisfies AdminUserListResponse
}, {
  query: t.Object({
    search: t.Optional(t.String()),
    isActive: t.Optional(t.Boolean()),
    limit: t.Optional(t.Numeric()),
    offset: t.Optional(t.Numeric()),
  }),
  detail: { summary: '查询用户列表', tags: ['管理后台'], security: [{ bearerAuth: [] }] },
})
.get('/users/:id', async ({ adminAllowed, adminDenied, params, set }) => {
  if (!adminAllowed) return adminDenied()
  const detail = await getAdminUserDetail(params.id)
  if (!detail) return notFound(set, '用户不存在')
  return { success: true, data: detail } satisfies AdminUserDetailResponse
}, {
  params: t.Object({ id: t.String() }),
  detail: { summary: '查询用户详情', tags: ['管理后台'], security: [{ bearerAuth: [] }] },
})
.get('/providers', async ({ adminAllowed, adminDenied, query }) => {
  if (!adminAllowed) return adminDenied()
  const windowHours = Math.min(Math.max(Number(query.windowHours ?? 24), 1), 24 * 30)  // 1h ~ 30d
  const dbRows = await getAdminProviderStats(windowHours)
  const providerCalls = metricsCollector.snapshot(0, 0).providerCalls  // 单例 import
  // 合并：DB 出 cost/count + metrics 出 latency
  const items: AdminProviderStatsItem[] = dbRows.map((row) => {
    const stats = providerCalls[row.model]
    return {
      model: row.model,
      category: row.category,
      totalCalls: row.totalCalls,
      succeededCalls: row.succeededCalls,
      failedCalls: row.failedCalls,
      failureRate: row.totalCalls > 0 ? row.failedCalls / row.totalCalls : 0,
      avgLatencyMs: stats ? average(stats.durations) : null,
      p50LatencyMs: stats ? percentile(stats.durations, 0.5) : null,
      p95LatencyMs: stats ? percentile(stats.durations, 0.95) : null,
      totalCostCents: row.totalCostCents,
      totalInputTokens: row.totalInputTokens,
      totalOutputTokens: row.totalOutputTokens,
    }
  })
  return { success: true, windowHours, items } satisfies AdminProviderStatsResponse
}, {
  query: t.Object({
    windowHours: t.Optional(t.Numeric()),
  }),
  detail: { summary: '查询 provider 错误率与模型成本统计', tags: ['管理后台'], security: [{ bearerAuth: [] }] },
})
```

注意：
- `notFound` helper 在 `apps/server/src/utils/errors.ts`，已有 import 模式参考 `forbidden` / `conflict`。
- `average` / `percentile` helper：如果 `packages/metrics` 已导出（`aggregateProviderMetrics` 用过），优先 import；否则在 route 文件内 inline 两个小函数。
- `metricsCollector.snapshot(0, 0)` 的参数是 `(onlineUsers, uptime)`；这两个字段在 admin route 中无意义，传 0 即可，只取 `providerCalls` 字段。
- 检查 `metricsCollector` 是否 export：如果是 `export const metricsCollector = ...`，直接 import；如果是 `class MetricsCollector` + 模块内 `const metricsCollector = new MetricsCollector()`，也直接 import。如果 `metrics.ts` 不 export 单例，本步骤需要 minimal 扩 export（这一改动算在允许范围内）。

## 第五步：扩 apps/client/src/pages/Admin.tsx

调研 `Admin.tsx` 当前结构（第一步已调研），按以下原则扩：

### 5a. tab 结构

如果当前是单页无 tab：在最外层加 shadcn `Tabs`，三个 tab：概览 / 用户 / Provider。
如果当前已经有 tab：扩两个 tab。

### 5b. 用户 tab

```tsx
function AdminUsersTab() {
  const [search, setSearch] = useState('')
  const [isActive, setIsActive] = useState<boolean | undefined>(undefined)
  const [page, setPage] = useState(0)
  const debouncedSearch = useDebounce(search, 300)

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', { debouncedSearch, isActive, page }],
    queryFn: () => api.admin.users.get({ query: { search: debouncedSearch, isActive, limit: 20, offset: page * 20 } }),
    refetchInterval: 30_000,
  })

  // 表格：username / email / 状态 / 余额 / 总成本 / 总调用 / 最近活动
  // 行点击 → setSelectedUserId → 打开 detail dialog 或 drawer
}

function AdminUserDetailDialog({ userId, onClose }) {
  const { data } = useQuery({
    queryKey: ['admin', 'users', userId],
    queryFn: () => api.admin.users({ id: userId }).get(),
    enabled: !!userId,
  })
  // daily cost 趋势：30 个 bar，宽度按 costCents / max
  // model breakdown 表格
  // recent records 表格
}
```

### 5c. Provider tab

```tsx
function AdminProvidersTab() {
  const [windowHours, setWindowHours] = useState(24)
  const { data } = useQuery({
    queryKey: ['admin', 'providers', windowHours],
    queryFn: () => api.admin.providers.get({ query: { windowHours } }),
    refetchInterval: 30_000,
  })
  // 表格：model / category / totalCalls / succeeded / failed / failureRate(%) / avg/p50/p95 latency / totalCost / tokens
  // 默认按 totalCalls desc（DB 已 ORDER BY）；列头排序留 TODO
}
```

### 5d. format helper

如果 `apps/client/src/lib/` 已有 `formatCents` / `formatYuan` / `formatMs`，复用；否则 inline：

```ts
function formatCents(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`
}
function formatMs(ms: number | null): string {
  if (ms === null) return '—'
  return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`
}
function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}
```

## 第六步：补测试

### 6a. packages/db/test/admin-users-providers.repo.test.ts（新建）

至少覆盖：
1. `listAdminUsers` 空表 → items=[], total=0。
2. `listAdminUsers` 单用户 + 单 generation_record → totalCostCents / totalCalls 正确。
3. `listAdminUsers` search 匹配 username / email。
4. `listAdminUsers` isActive 过滤。
5. `listAdminUsers` 分页：limit=2 + offset=0/2。
6. `getAdminUserDetail` 不存在的 accountId → null。
7. `getAdminUserDetail` daily cost 30 天聚合（构造跨日 record）。
8. `getAdminProviderStats` 多 model 分组、succeeded/failed count 正确、windowHours 过滤。

测试用 transaction-scoped fixture（既有 packages/db/test 模式）。

### 6b. apps/server/test/admin-routes.test.ts（扩）

至少覆盖：
1. `GET /api/admin/users` 非 admin 用户 → 403。
2. `GET /api/admin/users` admin 用户 → 200 + items shape。
3. `GET /api/admin/users/:id` 不存在 → 404。
4. `GET /api/admin/users/:id` 存在 → 200 + detail shape。
5. `GET /api/admin/providers` mock metricsCollector.snapshot 返回 fixture providerCalls → 200 + items 含 avgLatencyMs。
6. `GET /api/admin/providers` windowHours 越界（< 1 / > 720）→ 自动 clamp。

mock metricsCollector：在 `apps/server/test/helpers/test-factory.ts` 已有 mock 模式，参考既有 metrics.test.ts mock 方式。

### 6c. apps/client admin-page test（扩）

至少覆盖：
1. 用户 tab 渲染 → 表格头部 + 数据行。
2. 搜索输入 → debouncedSearch 触发 query（用 `waitFor`）。
3. 行点击 → detail dialog 打开。
4. Provider tab 渲染 → 表格行 + windowHours 切换触发 query。
5. 余额 / 成本 / 延迟格式化正确。

## 第七步：更新 TODO 和 CHANGELOG

修改 `docs/TODO.md`：

- P3.2 第 2 条「用户余额明细、用户级用量和成本统计」：

  原：
  ```txt
  - 用户余额明细、用户级用量和成本统计（全局用户 / 成本摘要已完成）。
  ```
  改为：
  ```txt
  - ✅ 用户级用量和成本统计（admin 后台新增「用户」tab + 用户详情：余额 / 30 天成本趋势 / 模型分解 / 最近记录；commit: `<本轮 hash>`）。
  ```

- P3.2 第 5 条「provider 错误率和模型成本统计」：**整条删除**（本轮完成）。

- 不要碰 P0 / P1 / P2 / P3.1 / P4 / P5 章节，避免与 Claude B 在 P4.1 zod 章节的修改撞行。
- 不要碰 P4.1 zod 章节（Claude B 当前在动）。

修改根目录 `CHANGELOG.md`：

- 在 `[Unreleased]` 的 Added 区追加：

```txt
- 管理后台运营统计深化（用户级用量 + provider 错误率/成本统计）：`packages/shared/src/admin.ts` 新增 `AdminUserSummary` / `AdminUserDetail` / `AdminProviderStatsItem` 等 DTO；`packages/db/src/repositories/admin.repo.ts` 新增 `listAdminUsers`（join accounts + credit_accounts + 子查询聚合 generation_records，支持 search/isActive/分页）/ `getAdminUserDetail`（30 天 daily cost + 模型分解 + 最近 10 条 record）/ `getAdminProviderStats(windowHours)`（DB 部分：per-model count/cost/tokens）；`apps/server/src/routes/admin.ts` 新增 `GET /api/admin/users` + `GET /api/admin/users/:id` + `GET /api/admin/providers`，providers 端点在 route 层合并 DB 数据与 `metricsCollector.snapshot().providerCalls`（avgLatencyMs / p50LatencyMs / p95LatencyMs）；`apps/client/src/pages/Admin.tsx` 扩「用户」tab（表格 + 搜索 + 状态过滤 + 分页 + 用户详情 dialog）+「Provider」tab（表格 + windowHours 切换），复用既有 useQuery + 30s 刷新，零图表库依赖（30 天趋势用纯 CSS bar）；补 packages/db admin-users-providers repo 测试 + apps/server admin-routes 测试 + apps/client admin-page 测试（commit: `<本轮 hash>`）。
```

- 写入本轮 commit 短 hash（commit 完成后回填）。

如果文档与 Claude B 冲突：

- 不要覆盖 Claude B 的 zod 迁移记录。
- 可以先提交代码，文档冲突在最终回复里说明。

## 验证命令

至少运行（**server test 必须加 `--isolate`**）：

```bash
bun test packages/db/test/admin-users-providers.repo.test.ts   # 如有 PG
bun test --isolate apps/server/test/admin-routes.test.ts
bun run --cwd apps/client vitest src/__tests__/admin-page.test.tsx
bun run typecheck
```

如时间允许，再运行：

```bash
bun run lint
bun run --cwd apps/server test --isolate
bun run --cwd apps/client test
```

如果 lint 因 Claude B 并行未提交文件失败，不要修改 Claude B 文件；最终回复说明。

## 推荐 commit

```bash
git add packages/shared/src/admin.ts \
  packages/db/src/repositories/admin.repo.ts \
  packages/db/test/admin-users-providers.repo.test.ts \
  apps/server/src/routes/admin.ts \
  apps/server/src/services/metrics.ts \
  apps/server/test/admin-routes.test.ts \
  apps/client/src/pages/Admin.tsx \
  apps/client/src/__tests__/admin-page.test.tsx \
  apps/client/src/api/admin.ts \
  apps/client/src/lib/admin-format.ts \
  docs/TODO.md \
  CHANGELOG.md

git diff --name-only --cached
```

⚠️ 如果 client 端 admin api helper / format helper 不需要新建（已有同等 helper），从 add 列表删除对应文件。如果 `apps/server/src/services/metrics.ts` 不需要扩 export，从 add 列表删除。**仅限最小 diff**。

**强制检查**：commit 前必须确认 `git diff --name-only --cached` 输出**不包含**：

- `packages/gateway/`（任何路径）
- `packages/prompt-engine/`（任何路径）
- `packages/metrics/src/`（任何路径，本轮零 metrics 内部改动）
- `packages/provider/`（任何路径）
- `packages/db/src/schema/`（任何路径）
- `apps/worker/`（任何路径）
- `apps/server/src/modules/` / `plugins/` / `routes/`（除 `admin.ts`）/ `utils/`（任何路径）
- `apps/client/src/pages/`（除 `Admin.tsx`）
- `apps/client/src/stores/` / `hooks/`（除新增 admin hook）/ `components/`（除新增 admin 组件）
- `apps/client/package.json` / `bun.lockb`（本轮零新增依赖）

确认无误后提交：

```bash
git commit -m "feat(admin): add user-level usage and provider stats endpoints and UI"
```

最终回复必须包含：

- 本轮 commit hash。
- 实际运行的验证命令（特别是 admin-routes test + client admin-page test 输出）。
- `git diff --name-only --cached` 的最终输出（证明未跨界）。
- 第一步「调研」结果：Admin.tsx 当前 tab 结构、metricsCollector export 方式、credit_accounts / generation_records 字段名。
- 第三步 repository 实现：`listAdminUsers` 的 join 策略（单 SQL vs 多 SQL JS-join）、`getAdminProviderStats` 的 interval 注入方式。
- 第四步 route 层 provider metrics 合并的真实输出示例（含一条 fixture 模型的 cost + latency）。
- 与 Claude B 是否有冲突（特别是 `docs/TODO.md` / `CHANGELOG.md`）。
