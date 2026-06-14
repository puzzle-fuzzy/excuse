# Claude B 下一轮执行计划：Canvas 阶段耗时 + 任务队列积压 Prometheus 指标

更新时间：2026-06-14

本文给 Claude B 执行。Claude A 当前在处理 **Canvas PipelineController 兜底轮询迁移到 react-query**（`apps/client/src/components/canvas/PipelineController.tsx` line 364-409 的 `setInterval` 抽到新建 hook `useCanvasPipelineRunsPolling` + `apps/client/src/api/query-client.ts` 追加 `canvasPipelineRunsQueryKeys` 常量），Claude B 本轮收口 P2.5「Metrics / Health」第一条待办中两个子项「任务队列积压」+「Canvas 阶段耗时」：把这两个 DB 派生指标接到 Prometheus 输出，让 `/metrics` 能回答「队列有多少 pending/running/retrying 任务」「Canvas 各阶段 p50/p95/avg 耗时与成功失败计数」。不要碰资产中心、Canvas 客户端、API Key 页面、worker 运行时、Gateway、Provider。

## 上轮复核结论（已通过）

上一轮 Claude B 完成并提交：

- `63c6e9f refactor(gateway): extract error factories for openai gateway route`
- `6e231e3 docs(changelog): backfill gateway error factory commit hash`

复核结果：

- `packages/gateway/test/index.test.ts` + `apps/server/test/openai-gateway.test.ts`：48 pass / 0 fail / 209 expect() calls（含 7 个新工厂单元测试 + 既有 7 条错误码响应矩阵继续通过）。
- `bun run typecheck`：server / client / worker 三端通过。
- `packages/gateway/src/index.ts`：+77 行追加 6 个语义化错误工厂（`modelNotFoundError` / `invalidModelError` / `invalidParametersError` / `missingUserMessageError` / `insufficientBalanceError` / `generationFailedError`），全部 pure 调 `createOpenAIError`；`createOpenAIError` 保留为低层 API。
- `apps/server/src/routes/openai-gateway.ts`：6 处 `createOpenAIError` 内联调用替换为对应工厂；`normalizeOpenAIChatRequest` 内 MISSING_USER_MESSAGE 检测也改用 `missingUserMessageError()`；顺手合并顶部 4 行重复 `@excuse/shared` type import 修掉 baseline lint 报错。
- route 的 status / response / 审计 / 余额逻辑零行为变化（既有错误码测试矩阵全绿）。
- `docs/TODO.md` P2.4 第三条「Gateway 协议解析和响应映射继续下沉」整条删除；保留 P2.4 第一条「scope / quota / rate limit」与第二条「正式开放还是隐藏入口的最终产品决策」。
- `CHANGELOG.md` Changed 区已记录并回填 commit `63c6e9f`。
- 暂存区零跨界（未碰 `packages/db` / `packages/metrics` / `apps/client` / `apps/worker` / 其他 server route）。

保持上一轮的纪律。

## 本轮目标

收口 P2.5 第一条待办中「任务队列积压」+「Canvas 阶段耗时」两个子项。

当前状态：

- `packages/metrics/src/index.ts` 的 `MetricsSnapshot` 是进程内 in-memory 指标（HTTP 请求、延迟、SSE 在线、generation 状态、errors、uptime）；`MetricsCollector` 不依赖 DB。
- `packages/metrics/src/prometheus.ts` 的 `snapshotToPrometheus(snapshot)` 把 in-memory snapshot 映射为 6 个 metric family（`excuse_http_requests_total` / `excuse_http_latency_seconds` / `excuse_sse_online_users` / `excuse_generation_total` / `excuse_errors_total` / `excuse_uptime_seconds`）。
- `apps/server/src/routes/metrics.ts` 的 `GET /metrics` 端点：调 `getMetrics(onlineUsers, uptime)` → `snapshotToPrometheus` → `serializePrometheus` → text exposition；带 IP 白名单 + Bearer token 鉴权。
- `packages/db/src/schema/canvas-pipeline-runs.ts` 有 `phase` / `status` / `startedAt` / `finishedAt` / `errorMessage` 字段；`tasks` 表有 `domain` / `status` 字段。
- `docs/TODO.md` P2.5 第一条：「补 provider 错误率、模型耗时、任务队列积压、Canvas 阶段耗时。」（4 个子项；本轮收口 2 个）

本轮要做的：

1. **`packages/metrics` 新增 DB 派生指标聚合纯函数**（不依赖 DB，只接 SQL 查询结果做聚合）：
   - `aggregateCanvasPhaseMetrics(rows)` → `PrometheusMetric[]`：把 `canvas_pipeline_runs` 聚合结果（per-phase succeeded/failed 计数 + per-phase duration 量化）映射为 `excuse_canvas_phase_total{phase,status}` counter + `excuse_canvas_phase_duration_seconds{phase,quantile}` gauge。
   - `aggregateTaskQueueMetrics(rows)` → `PrometheusMetric[]`：把 `tasks` 聚合结果（per-domain per-status 计数）映射为 `excuse_task_queue_depth{domain,status}` gauge。
2. **`packages/db` 新增两个聚合 repository 函数**：
   - `getCanvasPhaseStats(windowHours: number = 24)`：返回 per-phase 数组，每项 `{ phase, status, count, durationP50, durationP95, durationAvgMs }`；只统计 `finishedAt IS NOT NULL` 且 `finishedAt > now() - windowHours` 的行。
   - `getTaskQueueStats()`：返回 per-domain per-status 数组 `{ domain, status, count }`；不限制时间窗（队列深度是即时的）。
3. **`apps/server/src/routes/metrics.ts` 合并 in-process 与 DB-derived 输出**：在 `/metrics` route 内调两个新 repository 函数 → 用新聚合函数映射为 metric family → 与 `snapshotToPrometheus(snapshot)` 合并 → `serializePrometheus` 输出。
4. **`apps/server/src/services/metrics.ts` 不动**：in-memory `MetricsCollector` 接口不变；DB 派生指标在 route 层直接调 repository，不走 service。
5. **补 `packages/metrics` 单元测试**：聚合函数的边界（空数组、单条、p95 计算、缺失 duration）。
6. **`apps/server/test/metrics.test.ts` 既有用例不能破坏**：本轮新增 DB-derived 输出，既有 6 个 in-memory metric family 测试必须继续通过；新增 2-3 个 DB-derived 测试（mock repository）。
7. 在 `docs/TODO.md` 把 P2.5 第一条「补 provider 错误率、模型耗时、任务队列积压、Canvas 阶段耗时」**部分删除**：保留「补 provider 错误率、模型耗时」（剩余 2 个子项）；「任务队列积压、Canvas 阶段耗时」整段删除。
8. 在 `CHANGELOG.md` `[Unreleased]` 的 Added 区记录本轮完成内容和 commit。

本轮不要处理：

- P2.5 第二条「线上排障检查命令或文档」— 独立任务，本轮不做。
- P2.5 第三条「Prometheus 指标跨 worker 进程聚合」— 架构级，需要 worker → server push 通道，独立任务。
- P2.5 第一条剩余「provider 错误率、模型耗时」— 需要在 generation service / openai-gateway 调用点埋 in-process 计数，独立任务，本轮不做。
- Worker 运行时改动：本轮所有指标都从 DB 派生，不需要 worker 配合。
- 资产中心、Canvas 客户端、API Key 页面、开发者页、Gateway、Provider。
- DB schema / migration（仅新增查询函数，不改表结构）。

## 重要规则：完成后必须 commit

- 本轮 1 个 commit（hash 回填可以追一个 docs commit）。
- commit 前必须运行 `git status --short` 和 `git diff --name-only --cached`。
- 暂存区只能包含本任务文件，**绝对不要**混入 Claude A 的 client / hooks 文件。
- 完成事项从 `docs/TODO.md` 删除（P2.5 第一条部分删除）。
- 完成记录和 commit 写入根目录 `CHANGELOG.md`。
- 如果 `docs/TODO.md` / `CHANGELOG.md` 与 Claude A 并行修改冲突，优先提交代码；文档冲突在最终回复里说明。
- commit 成功后，在最终回复里写出 commit hash。

**强制检查**：commit 前必须确认 `git diff --name-only --cached` 输出**不包含**：

- `packages/shared/`
- `packages/gateway/`（除 `packages/gateway/test/` 仅当本轮不动；本轮零 gateway 改动）
- `packages/provider/`
- `packages/auth/`
- `packages/events/`
- `packages/workflow-engine/`
- `packages/task-engine/`
- `packages/rate-limit/`
- `packages/subtitle-engine/`
- `packages/canvas-engine/`
- `packages/canvas-runtime/`
- `packages/prompt-engine/`
- `packages/billing/`
- `packages/ffmpeg/`
- `packages/storage/`
- `apps/client/`（任何路径，本轮零 client 改动）
- `apps/worker/`（任何路径，本轮零 worker 改动）
- `apps/server/src/routes/assets.ts`
- `apps/server/src/routes/asset-tags.ts`
- `apps/server/src/routes/openai-gateway.ts`（上一轮已动；本轮不动）
- `apps/server/src/routes/notifications.ts`
- `apps/server/src/routes/api-keys.ts`
- `apps/server/src/routes/upload.ts`
- `apps/server/src/routes/canvas.ts`
- `apps/server/src/routes/generate.ts`
- `apps/server/src/routes/billing.ts`
- `apps/server/src/routes/subtitle.ts`
- `apps/server/src/routes/sse.ts`
- `apps/server/src/routes/auth.ts`
- `apps/server/src/routes/models.ts`
- `apps/server/src/routes/health.ts`（health 的 `/api/health/metrics` 仍走 in-memory snapshot；本轮不扩 health 端点，DB 派生仅 Prometheus 端点暴露）
- `apps/server/src/services/audit.ts`
- `apps/server/src/services/sse-manager.ts`
- `apps/server/src/services/metrics.ts`（in-memory 收集器接口不变）
- `apps/server/src/index.ts`
- `apps/server/src/config.ts`

## 文件边界

Claude B 可以修改：

```txt
packages/metrics/src/index.ts                                (导出新的聚合结果类型；不改 MetricsSnapshot / MetricsCollector)
packages/metrics/src/db-derived.ts                           (新建：aggregateCanvasPhaseMetrics + aggregateTaskQueueMetrics 纯函数)
packages/metrics/src/prometheus.ts                           (仅在需要复用 helper 时改动；优先不动)
packages/metrics/test/db-derived.test.ts                     (新建：聚合函数单元测试)
packages/metrics/test/index.test.ts                          (如需要补 helper export 断言；优先不动)
packages/db/src/repositories/metrics.repo.ts                 (新建：getCanvasPhaseStats + getTaskQueueStats)
packages/db/src/index.ts                                     (barrel export 新 repository；不动既有 export)
apps/server/src/routes/metrics.ts                            (/metrics 合并 in-memory + DB-derived 输出)
apps/server/test/metrics.test.ts                             (扩 DB-derived 测试；既有 in-memory 测试不破坏)
docs/TODO.md
CHANGELOG.md
```

Claude B 不要修改：

```txt
docs/claude-next-plan.md
packages/db/src/schema/**                                    (本轮绝对不动 schema / migration)
packages/db/src/repositories/**（除新建 metrics.repo.ts）    (不动既有 repository)
packages/db/src/services/**                                  (本轮不动 service)
packages/db/test/**                                          (本轮不动既有 DB 测试)
packages/shared/**                                           (本轮绝对不动)
packages/gateway/**                                          (上一轮已动；本轮不动)
packages/auth/**
packages/events/**
packages/workflow-engine/**
packages/task-engine/**
packages/rate-limit/**
packages/subtitle-engine/**
packages/canvas-engine/**
packages/canvas-runtime/**
packages/prompt-engine/**
packages/billing/**
packages/ffmpeg/**
packages/storage/**
apps/server/src/services/**                                  (in-memory metrics.ts 接口不变)
apps/server/src/plugins/**
apps/server/src/modules/**
apps/server/src/utils/**
apps/server/src/config.ts
apps/server/src/index.ts
apps/server/src/routes/**（除 metrics.ts）
apps/server/test/**（除 metrics.test.ts）
apps/client/**
apps/worker/**
```

如果必须修改边界外文件，**先停止并在最终回复说明原因**。

## 第一步：调研 metrics 现状 + DB 派生数据源

阅读以下文件：

1. `packages/metrics/src/index.ts` — 确认 `MetricsSnapshot` / `MetricsCollector` 接口；本轮**不动这两个**，只在同包新建 `db-derived.ts`。
2. `packages/metrics/src/prometheus.ts` — 确认 `PrometheusMetric` / `serializePrometheus` / `snapshotToPrometheus`；本轮可复用 `serializePrometheus`，但 `snapshotToPrometheus` 输出的 6 个 metric family 不变。
3. `apps/server/src/routes/metrics.ts` — 确认 `/metrics` 端点拼装流程；本轮在 `snapshotToPrometheus(snapshot)` 输出后追加 DB-derived metric family。
4. `packages/db/src/schema/canvas-pipeline-runs.ts` — 确认 `phase` / `status` / `startedAt` / `finishedAt` 字段名；9 个 phase 枚举值；4 个终态（succeeded / failed / cancelled）+ 2 个中间态（pending / running）。
5. `packages/db/src/schema/tasks.ts` 或 `unified-tasks.ts` — 确认 `domain`（canvas / generate / subtitle / gateway）+ `status`（queued / running / retrying / succeeded / failed / cancelled）字段名。
6. `apps/server/test/metrics.test.ts` — 确认既有 in-memory 测试覆盖范围；本轮新增 DB-derived 测试用 mock repository（不真打 DB）。

把字段名 / 枚举值 / 既有 metric family 命名约定（`excuse_*` 前缀 + snake_case）记下来。

## 第二步：在 packages/db 新增聚合 repository

新建：

```txt
packages/db/src/repositories/metrics.repo.ts
```

骨架（最终实现按 Drizzle query builder 风格）：

```ts
import { db, canvasPipelineRuns, tasks } from '../index' // 或对应 schema 入口
import { eq, gt, isNotNull, sql } from 'drizzle-orm'

/** Canvas 阶段聚合行 — 每行对应一个 (phase, status) 组合 */
export interface CanvasPhaseStatRow {
  phase: string
  status: string
  count: number
  /** 该 (phase, status) 下 duration 的 p50（ms）；仅 succeeded/failed/cancelled 有 finishedAt */
  durationP50Ms: number
  durationP95Ms: number
  durationAvgMs: number
}

/** 任务队列聚合行 — 每行对应一个 (domain, status) 组合 */
export interface TaskQueueStatRow {
  domain: string
  status: string
  count: number
}

/**
 * 查询最近 windowHours 内 Canvas 各 (phase, status) 的计数 + duration 量化。
 *
 * - 仅统计 `finishedAt IS NOT NULL` 且 `finishedAt > now() - window` 的行。
 * - duration = finishedAt - startedAt（毫秒）；未 started 的行排除。
 * - 窗口默认 24 小时，避免历史数据稀释当前性能画像。
 * - 用 PostgreSQL 原生 percentile_cont 而非 JS 计算，保证准确性。
 */
export async function getCanvasPhaseStats(windowHours = 24): Promise<CanvasPhaseStatRow[]> {
  const windowMs = windowHours * 60 * 60 * 1000
  const cutoff = new Date(Date.now() - windowMs)

  const rows = await db
    .select({
      phase: canvasPipelineRuns.phase,
      status: canvasPipelineRuns.status,
      count: sql<number>`count(*)::int`,
      durationP50Ms: sql<number>`coalesce(percentile_cont(0.5) within group (order by extract(epoch from (${canvasPipelineRuns.finishedAt} - ${canvasPipelineRuns.startedAt})) * 1000), 0)::float8`,
      durationP95Ms: sql<number>`coalesce(percentile_cont(0.95) within group (order by extract(epoch from (${canvasPipelineRuns.finishedAt} - ${canvasPipelineRuns.startedAt})) * 1000), 0)::float8`,
      durationAvgMs: sql<number>`coalesce(avg(extract(epoch from (${canvasPipelineRuns.finishedAt} - ${canvasPipelineRuns.startedAt})) * 1000), 0)::float8`,
    })
    .from(canvasPipelineRuns)
    .where(sql`${canvasPipelineRuns.finishedAt} IS NOT NULL AND ${canvasPipelineRuns.startedAt} IS NOT NULL AND ${canvasPipelineRuns.finishedAt} > ${cutoff}`)
    .groupBy(canvasPipelineRuns.phase, canvasPipelineRuns.status)

  return rows.map(row => ({
    phase: String(row.phase),
    status: String(row.status),
    count: Number(row.count),
    durationP50Ms: Number(row.durationP50Ms),
    durationP95Ms: Number(row.durationP95Ms),
    durationAvgMs: Number(row.durationAvgMs),
  }))
}

/**
 * 查询当前任务队列深度（per domain × status 计数）。
 *
 * - 不限制时间窗：队列深度是即时的。
 * - 含 queued / running / retrying（活跃）+ succeeded / failed / cancelled（累计）。
 * - 如果只想看积压，调用方可在 Prometheus 端用 `{status=~"queued|running|retrying"}` 过滤。
 */
export async function getTaskQueueStats(): Promise<TaskQueueStatRow[]> {
  const rows = await db
    .select({
      domain: tasks.domain,
      status: tasks.status,
      count: sql<number>`count(*)::int`,
    })
    .from(tasks)
    .groupBy(tasks.domain, tasks.status)

  return rows.map(row => ({
    domain: String(row.domain),
    status: String(row.status),
    count: Number(row.count),
  }))
}
```

实现要点：

- 用 PostgreSQL 原生 `percentile_cont` 计算 p50/p95，保证准确性（JS 端排序在大数据集上慢）。
- `coalesce(..., 0)` 兜底空值（如某 (phase, status) 全是 cancelled 但无 finishedAt）。
- 类型断言：Drizzle 的 `sql<number>` 返回 unknown，需 `Number()` 强转；用 `String()` 同理。
- 不引入 N+1：单条 GROUP BY 查询，O(1) round trip。
- **不要**新建 service 层封装：repository 直接被 route 调用，符合既有 `*.repo.ts` 模式。

在 `packages/db/src/index.ts` 追加 barrel export：

```ts
export * from './repositories/metrics.repo'
```

注意：

- 不要改既有 repository 文件。
- 不要改 schema / migration。
- 如果 Drizzle 的 `sql` 模板对 `extract(epoch from (ts1 - ts2))` 支持不佳，回退用 `EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000` 字符串拼接，并在最终回复说明。

## 第三步：在 packages/metrics 新增 db-derived 聚合函数

新建：

```txt
packages/metrics/src/db-derived.ts
```

骨架：

```ts
import type { PrometheusMetric } from './prometheus'

/** Canvas 阶段聚合行 — 与 packages/db 的 CanvasPhaseStatRow 对齐（避免循环依赖，本包重新声明） */
export interface CanvasPhaseStatInput {
  phase: string
  status: string
  count: number
  durationP50Ms: number
  durationP95Ms: number
  durationAvgMs: number
}

/** 任务队列聚合行 */
export interface TaskQueueStatInput {
  domain: string
  status: string
  count: number
}

/**
 * 把 Canvas 阶段聚合行映射为 Prometheus metric family：
 * - counter `excuse_canvas_phase_total{phase, status}`：每个 (phase, status) 一条样本。
 * - gauge `excuse_canvas_phase_duration_seconds{phase, quantile}`：每个 phase 输出 p50/p95/avg 3 条样本（取 status='succeeded' 的 duration，因为只有成功完成才有意义；如果输入缺 succeeded 则跳过 duration 输出）。
 *
 * 命名约定：与既有 `excuse_*` 前缀 + snake_case 对齐。
 * 单位：duration 输出秒（Prometheus 约定 base unit 是秒），输入毫秒。
 */
export function aggregateCanvasPhaseMetrics(rows: CanvasPhaseStatInput[]): PrometheusMetric[] {
  const phaseTotalSamples: PrometheusMetric['samples'] = rows.map(row => ({
    labels: { phase: row.phase, status: row.status },
    value: row.count,
  }))

  // duration 只取 succeeded（cancelled / failed 的 duration 不反映模型性能）
  const succeededByPhase = new Map<string, CanvasPhaseStatInput>()
  for (const row of rows) {
    if (row.status === 'succeeded')
      succeededByPhase.set(row.phase, row)
  }

  const durationSamples: PrometheusMetric['samples'] = []
  for (const [phase, row] of succeededByPhase) {
    durationSamples.push({ labels: { phase, quantile: '0.5' }, value: msToSeconds(row.durationP50Ms) })
    durationSamples.push({ labels: { phase, quantile: '0.95' }, value: msToSeconds(row.durationP95Ms) })
    durationSamples.push({ labels: { phase, quantile: 'avg' }, value: msToSeconds(row.durationAvgMs) })
  }

  return [
    {
      name: 'excuse_canvas_phase_total',
      help: 'Canvas pipeline run counts by phase and status within the query window.',
      type: 'counter',
      samples: phaseTotalSamples,
    },
    {
      name: 'excuse_canvas_phase_duration_seconds',
      help: 'Canvas pipeline phase duration in seconds (p50/p95/avg), succeeded runs only.',
      type: 'gauge',
      samples: durationSamples,
    },
  ]
}

/**
 * 把任务队列聚合行映射为 Prometheus metric family：
 * - gauge `excuse_task_queue_depth{domain, status}`：每个 (domain, status) 一条样本。
 *
 * gauge 而非 counter：队列深度是即时的（每次 scrape 都重新查 DB），
 * 但 Prometheus 端把同 (domain, status) 的时间序列视为单调累积也无妨（数值只会增长，因为 status 终态后不再回退）。
 */
export function aggregateTaskQueueMetrics(rows: TaskQueueStatInput[]): PrometheusMetric[] {
  const samples: PrometheusMetric['samples'] = rows.map(row => ({
    labels: { domain: row.domain, status: row.status },
    value: row.count,
  }))

  return [
    {
      name: 'excuse_task_queue_depth',
      help: 'Unified task queue depth by domain and status (instantaneous count, all-time cumulative per status).',
      type: 'gauge',
      samples,
    },
  ]
}

function msToSeconds(ms: number): number {
  return ms / 1000
}
```

实现要点：

- **本包不依赖 `@excuse/db`**：重新声明 `CanvasPhaseStatInput` / `TaskQueueStatInput` 接口，与 DB 层结构对齐（字段名一致）。route 层负责把 DB 行映射到 input 类型，避免 `@excuse/metrics → @excuse/db` 依赖（违反 pure 包纪律）。
- duration 仅取 `status='succeeded'`：failed/cancelled 的耗时反映失败路径（重试 + 错误处理），不反映模型本身性能。如果未来需要 failed duration，可加 `quantile='failed-p95'` 或第二个 metric family。
- 空输入：返回 `[metric family with empty samples]`，`serializePrometheus` 仍输出 `# HELP` + `# TYPE` 头部（既有行为）。

## 第四步：apps/server/src/routes/metrics.ts 合并输出

修改：

```txt
apps/server/src/routes/metrics.ts
```

在 `/metrics` route 内，IP/token 鉴权通过后：

```ts
import { serializePrometheus, snapshotToPrometheus } from '@excuse/metrics'
import { aggregateCanvasPhaseMetrics, aggregateTaskQueueMetrics } from '@excuse/metrics' // 新增
import { getCanvasPhaseStats, getTaskQueueStats } from '@excuse/db' // 新增

// ...（既有鉴权代码不变）

// 3. 序列化为 prometheus exposition format
const uptime = Math.floor((Date.now() - startTime) / 1000)
const snapshot = getMetrics(getOnlineUserCount(), uptime)
const inProcessMetrics = snapshotToPrometheus(snapshot)

// DB 派生指标（每 scrape 一次查询；PostgreSQL 默认 15-30s scrape 频率下负载可忽略）
const [phaseStats, queueStats] = await Promise.all([
  getCanvasPhaseStats(24).catch(() => []), // DB 异常时不阻塞 in-memory 输出
  getTaskQueueStats().catch(() => []),
])
const dbDerivedMetrics = [
  ...aggregateCanvasPhaseMetrics(phaseStats),
  ...aggregateTaskQueueMetrics(queueStats),
]

const body = serializePrometheus([...inProcessMetrics, ...dbDerivedMetrics])
```

实现要点：

- **DB 查询异常兜底**：`getCanvasPhaseStats().catch(() => [])` 返回空数组，让聚合函数输出空 samples（仅 `# HELP` + `# TYPE` 头部）；不阻塞 in-memory 输出。这与既有 `pgClient` 健康检查的 silent fallback 模式一致。
- **并发查询**：用 `Promise.all`，避免串行让 scrape latency 翻倍。
- **不加缓存**：每 scrape 一次查询是可接受的（PostgreSQL GROUP BY 索引覆盖即 < 10ms）；如未来 scrape 频率提升或数据量爆炸，可在 service 层加 5-15s TTL 缓存（独立任务）。
- **不修改 in-memory 输出顺序**：DB 派生追加到 in-memory 之后，保持既有测试断言稳定。

## 第五步：补 packages/metrics 单元测试

新建：

```txt
packages/metrics/test/db-derived.test.ts
```

至少覆盖：

1. **空输入**：`aggregateCanvasPhaseMetrics([])` 返回 2 个 metric family，每个 samples=[]，name/help/type 字段正确。
2. **单条 succeeded**：`aggregateCanvasPhaseMetrics([{ phase: 'analyze', status: 'succeeded', count: 5, durationP50Ms: 1000, durationP95Ms: 2000, durationAvgMs: 1200 }])` → `excuse_canvas_phase_total{phase='analyze',status='succeeded'}=5` + 3 条 duration 样本（p50=1s, p95=2s, avg=1.2s）。
3. **succeeded + failed 混合**：duration 仅取 succeeded；failed 行只出现在 `excuse_canvas_phase_total`，不出现在 `excuse_canvas_phase_duration_seconds`。
4. **缺失 succeeded 的 phase**：仅 failed/cancelled 行时，duration metric family 的 samples 为空（保留 HELP/TYPE 头部）。
5. **task queue 空输入**：`aggregateTaskQueueMetrics([])` 返回 1 个 metric family，samples=[]。
6. **task queue 多 domain × status**：每行一条样本，labels 字典序输出（与既有 `serializePrometheus` 约定一致）。
7. **单位转换**：duration 输入毫秒，metric value 是秒（1000ms → 1.0）。
8. **`PrometheusMetric` 类型守卫**：每个返回的 metric 都有 `name` / `help` / `type` / `samples` 字段；`type ∈ ['counter', 'gauge']`。

测试注意：

- 用 `bun test` 直接运行（pure 包，无 jsdom 需求）。
- 用 `expect(metric).toMatchObject({ name: 'excuse_canvas_phase_total', type: 'counter' })` + 精确 samples 数组断言。
- 不要 import `@excuse/db`（pure 包纪律）；input 类型在本测试内构造 fixture。

## 第六步：补 apps/server/test/metrics.test.ts DB-derived 测试

修改：

```txt
apps/server/test/metrics.test.ts
```

既有 in-memory 测试**不能破坏**。新增 describe('DB-derived metrics', ...)：

1. **mock `getCanvasPhaseStats` + `getTaskQueueStats`** 返回 fixture → /metrics 输出含 `excuse_canvas_phase_total{phase="analyze",status="succeeded"} 5` + `excuse_canvas_phase_duration_seconds{phase="analyze",quantile="0.5"} 1` + `excuse_task_queue_depth{domain="canvas",status="queued"} 3`。
2. **mock 抛错** → /metrics 输出仍含既有 6 个 in-memory metric family；DB 派生 family 有 HELP/TYPE 头部但 samples=[]（兜底生效）。
3. **既有 in-memory metric**：`excuse_http_requests_total` / `excuse_uptime_seconds` 等仍正常输出（既有测试断言不破坏）。

测试注意：

- 用 `mock.module('@excuse/db', ...)` 替换 `getCanvasPhaseStats` / `getTaskQueueStats`（Bun 自动 hoist；既有 server test 都用这个模式）。
- 测试文件如果与既有 `metrics.test.ts` 其他 describe 共用 `mock.module`，需要 `--isolate`（参考 CLAUDE.md 关于 server test 的说明）。

## 第七步：更新 TODO 和 CHANGELOG

修改 `docs/TODO.md`：

- 把 P2.5「Metrics / Health」第一条：

```txt
- 补 provider 错误率、模型耗时、任务队列积压、Canvas 阶段耗时。
```

**改为**：

```txt
- 补 provider 错误率、模型耗时。
```

（删除「任务队列积压」「Canvas 阶段耗时」两个已完成子项）

- 保留 P2.5 第二条「线上排障检查命令或文档」与第三条「Prometheus 跨 worker 进程聚合」。
- 不要碰 P0 / P1 / P2.1-2.4 / P2.6 / P3 章节，避免与 Claude A 在 client 改动撞行。
- 不要碰 P0 Canvas 章节、P4.1 react-query 章节（Claude A 当前在动）。

修改根目录 `CHANGELOG.md`：

- 在 `[Unreleased]` 的 Added 区追加：

```txt
- Prometheus 指标扩展（DB 派生）：`packages/metrics` 新增纯聚合函数 `aggregateCanvasPhaseMetrics` + `aggregateTaskQueueMetrics`（接 SQL 聚合行 → Prometheus metric family，pure 无 DB 依赖）；`packages/db` 新增 `metrics.repo.ts` 提供 `getCanvasPhaseStats(windowHours=24)`（用 PostgreSQL 原生 `percentile_cont` 算 per-(phase, status) p50/p95/avg duration + count，仅统计 finishedAt IS NOT NULL）+ `getTaskQueueStats()`（per-(domain, status) 即时计数）；`apps/server/src/routes/metrics.ts` `/metrics` 端点并发查两个新 repository 并合并 in-memory snapshot + DB-derived family 输出，新增 metric family `excuse_canvas_phase_total{phase,status}` / `excuse_canvas_phase_duration_seconds{phase,quantile}` / `excuse_task_queue_depth{domain,status}`；DB 查询异常兜底空数组，不阻塞 in-memory 输出；补 packages/metrics db-derived 单元测试（空输入 / succeeded-only duration / 单位转换 / 类型守卫）+ apps/server metrics.test.ts DB-derived mock 测试（commit: `<本轮 hash>`）。
```

- 写入本轮 commit 短 hash（commit 完成后回填）。

如果文档与 Claude A 冲突：

- 不要覆盖 Claude A 的 Canvas polling 改造记录。
- 可以先提交代码，文档冲突在最终回复里说明。

## 验证命令

至少运行（**server test 必须加 `--isolate`**）：

```bash
bun test packages/metrics/test/db-derived.test.ts
bun test --isolate apps/server/test/metrics.test.ts
bun run --cwd apps/server typecheck
```

如时间允许，再运行：

```bash
bun run typecheck
bun run lint
bun test packages/metrics
```

如果 lint 因 Claude A 并行未提交文件失败，不要修改 Claude A 文件；最终回复说明。

## 推荐 commit

```bash
git add packages/metrics/src/db-derived.ts \
  packages/metrics/src/index.ts \
  packages/metrics/test/db-derived.test.ts \
  packages/db/src/repositories/metrics.repo.ts \
  packages/db/src/index.ts \
  apps/server/src/routes/metrics.ts \
  apps/server/test/metrics.test.ts \
  docs/TODO.md \
  CHANGELOG.md

git diff --name-only --cached
```

**强制检查**：commit 前必须确认 `git diff --name-only --cached` 输出**不包含**：

- `packages/db/src/schema/`
- `packages/db/src/repositories/`（除新建 `metrics.repo.ts`）
- `packages/shared/`
- `packages/gateway/`
- `packages/provider/`
- `packages/auth/`
- `packages/events/`
- `packages/workflow-engine/`
- `packages/task-engine/`
- `packages/rate-limit/`
- `packages/subtitle-engine/`
- `packages/canvas-engine/`
- `packages/canvas-runtime/`
- `packages/prompt-engine/`
- `packages/billing/`
- `packages/ffmpeg/`
- `packages/storage/`
- `apps/client/`
- `apps/worker/`
- `apps/server/src/services/`
- `apps/server/src/routes/`（除 `metrics.ts`）
- `apps/server/src/index.ts`
- `apps/server/src/config.ts`

确认无误后提交：

```bash
git commit -m "feat(metrics): expose canvas phase timing and task queue depth"
```

最终回复必须包含：

- 本轮 commit hash。
- 实际运行的验证命令（特别是 metrics + db-derived 测试输出）。
- `git diff --name-only --cached` 的最终输出（证明未跨界）。
- 第一步「调研」结果：`canvas_pipeline_runs` / `tasks` 表的关键字段名 + 枚举值。
- 第二步「PostgreSQL percentile_cont」结果：Drizzle `sql` 模板对 `extract(epoch from (...))` 的支持情况；如回退字符串拼接，说明原因。
- 第四步「route 合并」结果：DB 异常兜底是否生效（mock 抛错测试输出）。
- 一个真实的 `/metrics` 输出片段（含新 3 个 metric family 各一条样本），便于后续维护。
- 与 Claude A 是否有冲突（特别是 `docs/TODO.md` / `CHANGELOG.md`）。
