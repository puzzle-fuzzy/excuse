# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> 本文件是面向 AI 编程助手（Claude Code）的架构与约定详解。

## Project Overview

AI 内容生成平台（"让想象力拥有生产力"）— Bun monorepo，含 React 前端、ElysiaJS 后端与后台任务 Worker。所有 AI 调用走阿里云 DashScope（Qwen 文本/图像、Wan/HappyHorse 视频）。包含从故事文本到成片的 Canvas 自动化流水线，以及基于 ASR 的字幕烧录管线（Subtitle）。

## Common Commands

```bash
# 开发（同时启动 server :5007 + client :8007 + worker :5100 health）
bun run dev

# 单独的 dev server
bun run dev:server    # apps/server — Elysia API
bun run dev:client    # apps/web-business — Vite React SPA
bun run dev:worker    # apps/worker — 统一任务轮询 + Canvas 流水线驱动

# 构建
bun run build

# 类型检查（并发跨 server / client / worker）
bun run typecheck

# 测试
bun run test            # 跨 server、worker 与全部 package 的 bun test
                          #（server 套件以 --isolate 运行，避免 mock.module 污染）
bun run test:client     # vitest（前端）
bun run test:all        # 两者都跑
bun run test:db         # packages/db 的 test-db 脚本（需 PG）
bun run test:isolate    # 带 --isolate 的 bun test
bun run test:coverage   # 两者都带 --coverage

# 跑单个 package 的测试
bun test --cwd packages/workflow-engine
bun test --cwd apps/worker
# Server 套件 mock.module 较多，默认走 --isolate：
bun run --cwd apps/server test

# 跑单个 bun 测试文件
bun test apps/server/test/auth-routes.test.ts
bun test packages/billing/test/calculate.test.ts
# 同时跑多个调用 mock.module 的 server 文件需 --isolate：
#   bun test --isolate apps/server/test/a.test.ts apps/server/test/b.test.ts

# 跑单个 vitest 测试（在 apps/web-business 下）
cd apps/web-business && bun vitest src/__tests__/some.test.tsx

# Lint
bun run lint
bun run lint:fix

# 包边界检查
bun run check:boundaries
bun run check:assets       # 资产一致性检查（scripts/check-assets-consistency.ts）

# 单独构建
bun run build:server       # 仅构建 apps/server
bun run build:worker       # 仅构建 apps/worker
bun run build:client       # 仅构建 apps/web-business

# E2E
bun run test:e2e           # E2E 测试（Bun）
bun run typecheck:e2e      # E2E 类型检查

# 数据库（在 packages/db 下）
cd packages/db
bun run db:generate     # 由 schema 变更生成迁移
bun run db:migrate      # 执行迁移（bun --env-file ../../.env src/migrate.ts）
bun run db:push         # 直接推送 schema（仅开发）
bun run db:studio       # Drizzle Studio GUI

# PostgreSQL（Docker）
docker compose up -d    # 在宿主机 5433 端口启动 PG
```

**重要**：`packages/db` 的脚本用 `bun --env-file ../../.env <file>`（不是 `bun run`）。`--env-file` 只在直接执行文件时生效，用 `bun run` 子命令时不生效。委托给 workspace 的根脚本用 `bun run --cwd <pkg> <script>`。

## Architecture

### Monorepo 布局

仓库正处于重构中：曾经的单体 package 正被拆分为职责聚焦、尽量**纯**的 package。分两层 —— 纯规则/逻辑包（无 DB/provider/app 运行时依赖）与运行时包（持有 IO）。App 通过 adapter 把两者拼装起来。

```
apps/
  client/   — React 19 + Vite + Tailwind CSS 4 + shadcn/ui（端口 8007）
  server/   — ElysiaJS API（端口 5007）
  worker/   — 统一任务轮询：claim 任务、驱动 Canvas 流水线、轮询遗留 video/ASR 队列
packages/
  shared/          — 跨应用类型 + Pino logger 单例（BASE 层，无依赖）
  db/              — Drizzle ORM schema + repositories + services（PostgreSQL 16）
  provider/        — DashScope client + model-configs + ASR client（遗留 façade，re-export storage/ffmpeg）
  storage/         — 阿里云 OSS / 本地文件存储（AssetStorage）
  ffmpeg/          — FFmpeg 操作：抽音频、烧字幕、媒体探测
  billing/         — 费用计算（token/image/video-second/audio）+ 统计
  canvas-engine/   — Canvas 领域逻辑：连贯性、schema
  canvas-runtime/  — Canvas 阶段执行（phases/ 目录）+ LLM 辅助 + 归一化
  prompt-engine/   — Prompt 构建 + JSON 抽取辅助
  task-engine/     — 纯：统一任务生命周期（claim/lock/retry/failure），通过 *Adapter 接口
  workflow-engine/ — 纯：Canvas 阶段顺序 + pipeline-run 状态 + 自动推进规则
  events/          — 纯：SSE 分发 hub + PG NOTIFY 载荷解析/映射
  gateway/         — 纯：OpenAI 兼容请求/响应归一化
  metrics/         — 纯：MetricsCollector（状态码/延迟分位数）
  rate-limit/      — 纯：滑动窗口限流 + 429 响应构建
  subtitle-engine/ — 纯：字幕样式预设 + ASS 生成 + ASR 解析
  auth/            — 纯：API key 哈希/创建/前缀识别（SHA-256）
  error-recovery/  — 纯：失败 → 用户可执行 action 的分类映射
  provider-health/ — 纯：provider 连续失败 → 降级/半开恢复策略
```

**依赖方向**：`shared` ← 一切。纯包（`task-engine`、`workflow-engine`、`events`、`gateway`、`metrics`、`rate-limit`、`subtitle-engine`、`auth`、`error-recovery`、`provider-health`）只依赖 `shared`（与标准库）——绝不依赖 `db`、`provider`、server 路由或 worker 运行时。运行时包（`db`、`provider`、`storage`、`ffmpeg`、`billing`、`canvas-engine`、`canvas-runtime`、`prompt-engine`）可依赖 `shared` 及彼此；app 在最上层。

> **已知违规（待修）**：`canvas-runtime` 当前直接 import `@excuse/db` 和 `@excuse/provider`，违反纯包纪律。需通过 `CanvasRuntimeAdapters` 接口提取 IO。详见 `TODO.md` §P0-1。

### 关键架构模式

**Adapter 注入（中心模式）** — 纯包绝不触碰 IO。它们声明 `*Adapter` 接口（如 `TaskCompletionAdapter`、`CanvasPipelineTaskAdapter`、`GenerationNotifyDispatcherOptions.dispatchToUser`）与接收 adapter 的纯函数（`completeTaskWithAdapter`、`createNextCanvasPipelineTask`、`applyTaskFailureWithAdapter`）。App 用真实 DB/provider 调用实现 adapter 并注入。**黄金法则**：若你发现自己在给 `task-engine`/`workflow-engine`/`events`/`gateway`/`metrics`/`rate-limit`/`subtitle-engine`/`auth` 加 `@excuse/db` 或 `@excuse/provider` 的 import，停下 —— 规则属于纯包，IO 调用属于 app 注入的 adapter。提取路线图见 `TODO.md`（§P4「基础设施和通用能力治理」）。

**统一任务队列** — `tasks` 表是唯一的异步执行层（domain：`canvas`/`generate`/`subtitle`/`gateway`；type 如 `canvas.analyze`、`media.burn-subtitle`）。状态机：`queued → running → succeeded | failed | cancelled`，含重试路径 `running → retrying → queued`（由 `nextRunAt` 延迟）。Worker 经 `FOR UPDATE SKIP LOCKED`（`claimNextTask`）认领，设 `lockedBy`/`lockedUntil` 锁，经 heartbeat 续期，并清扫锁过期超 5 分钟的孤儿任务。所有生命周期决策走 `@excuse/task-engine`（分类错误 → retry vs fail → 算 backoff）。输出/计费仍在 `generation_records`；task 只管执行生命周期。

> 注：统一队列当前只接管 **12 个 canvas 阶段 + 2 个 media task**（`media.extract-audio` / `media.burn-subtitle`）。**`category='video'` 整条线仍走 `generation_records` 旧轮询**（`pollPendingVideoTasks`，无 claim/锁/孤儿回收），ASR 同理 —— 这是「没做完的半成品」，迁移 vs 显式带外见 `TODO.md` §一（待决策）。


**声明式模型配置** — 所有 AI 模型在 `packages/provider/src/model-configs.ts` 声明其参数、端点、输入映射与定价。共享映射片段（`TEXT_MAPPING`、`IMAGE_MAPPING`、`VIDEO_T2V_MAPPING`、`VIDEO_MEDIA_MAPPING`）减少重复。`DashScopeClient` 无任何模型特定分支 —— `applyMappings()` 依据 `InputMapping` 判别联合（`prompt | parameter | media | mediaField | ignored`）路由每个参数，再由 `buildRequestBody()` 按 `requestType`（`chat | openai-chat | image | video-t2v | video-media`）塑形最终 payload。新增模型只需编辑 model-configs.ts。

**类型推导链** — Drizzle schema → `InferSelectModel` → `Serialize`（Date→string）→ API 类型。类型从 DB schema 单向流向 API，无重复。关键领域类型（`CostDetail`、`OutputResult`、`GenerationInputParams`、`CharacterProfile`、`ShotCamera`、`TaskInput`、`TaskOutput`、`TaskErrorInfo` 等）的真身在 `packages/shared/src/domain-types.ts`（无运行时依赖的纯接口，属 BASE 层）；`packages/db/src/domain-types.ts` 已退化为 re-export shim 仅作向后兼容。Schema 文件用 `$type<T>()` 把领域类型附着到 JSONB 列。**运行时序列化** `serialize<T>()`（`packages/db/src/types.ts`）递归把 `Date` 转 ISO，取代路由层各自手写的 `serializeXxx`。

**Eden treaty** — Client 经 `@elysia/eden` import server 的 `App` type，获得端到端类型安全的 API 调用。`apps/web-business/src/api/client.ts` 的 `unwrapEden<T>()` 从 Eden 的 `{ data, error }` 响应提取 `data` 并抛出结构化错误（401/403 自动清理）。无独立 API client 定义 —— 不要手写 fetch。

**Repository 模式** — DB 访问经 `packages/db/src/repositories/*.repo.ts` 导出的 async 函数（非类）。每个函数调 `getDb()` → Drizzle query builder → 返回可空单记录或数组。`getDb()`/`setDb()` 单例用于测试注入。

**Factory 路由** — 多数路由组用 `export function createXxxRoutes(config: ServerConfig)` 返回带 scope 的 `new Elysia({ prefix: '/api/xxx' })`。简单路由（health、models）导出普通 `new Elysia()`。每个路由文件显式接收 `ServerConfig` 而非读 process.env，便于测试注入。

**Auth 双通道** — `apps/server/src/plugins/auth.ts` 两个 auth plugin：`createAuthPlugin`（可空 userId，用于公开/保护混合路由）与 `createRequireAuthPlugin`（resolve-mode 401 守卫，用于完全保护路由）。Auth 优先级：httpOnly cookie → JWT，`exc_` 前缀 → API Key hash 查找（`@excuse/auth`），其他 Bearer → JWT verify。Auth 按路由组应用（非全局），以传播 Elysia 的 `derive` 类型。

**Canvas Worker 驱动流水线** — `CANVAS_PHASE_ORDER` 中 12 个阶段（`analyze → characters → locations → characterRefs → locationRefs → storyboard → continuity → rebuild → dialogue → videos → bgm → assemble`）。每个阶段是一条 `canvas.<phase>` 类型的 `tasks` 行，关联 `canvas_pipeline_runs` 行。Pipeline 端点用 `fireAndForget` —— 立即返回 `{ accepted: true, runId }`。task 成功后 worker 的 `pipeline-stepper.ts` 调 `@excuse/workflow-engine`（`decideCanvasAutoAdvance` + `canAdvanceToPhase`）创建下一阶段 task，**除非** `autoProgress=false` 或下一阶段是 pause-before 门槛（`storyboard`、`videos`、`assemble`，需用户确认）。经 `filterActivePipelineRuns` 的并发守卫防止重复阶段 run。非 pipeline 的 Canvas 操作（PATCH/DELETE 子资源、layout、model-preferences）同步返回 `{ success: true }`。

**Subtitle 流水线** — 基于 ASR 的字幕生成：上传视频 → 抽音频 → 经 DashScope ASR（`ASRClient`）转写 → 解析为 `SubtitleSentence[]`（`@excuse/subtitle-engine`）→ 渲染 ASS → 经 `@excuse/ffmpeg` 烧录。路由组在 `/api/subtitle`，自有状态机。Worker 经 `subtitle-processor.ts` 处理 ASR 轮询与字幕导出。

**Provider façade（待治理）** — `@excuse/provider` 仍 re-export `storage` 与 `ffmpeg`（薄 shim 文件：`provider/src/storage.ts`、`subtitle-burner.ts`、`audio-extractor.ts`、`compose.ts`）以向后兼容。**但当前 `@excuse/storage` / `@excuse/ffmpeg` 在各自包之外、provider 之外零消费者** —— 拆了两个包却没人直连。迁移 vs 合回的决策见 `TODO.md` §3.1（待决策）。

**SSE 经 PostgreSQL LISTEN/NOTIFY** — Worker 更新 DB → `pgClient.notify()` → Server 的 `startSSEListener()` 接收 → 来自 `@excuse/events` 的 dispatcher 把 NOTIFY 载荷（`generation_status`、`notification` 频道）映射为 SSE 事件 → `UserEventHub.dispatchToUser()` 推送到内存 SSE 连接 → client 收到。30 秒心跳。Client 的 `SSEClient` 类（`apps/web-business/src/api/sse.ts`）用 `@microsoft/fetch-event-source`（非原生 EventSource，以支持自定义 header 如 Bearer token）。经 `on<K extends keyof SSEEventMap>()` 的类型化事件 handler。错误层级：`RetriableError`（5xx，重连）、`FatalError`（4xx 非 auth）、`UnauthorizedError`（401/403，停重连 + 清 auth）。

### Server Route Structure

所有路由在 `/api` 下，于 `apps/server/src/index.ts` 挂载：

- `/api/auth/*` — register、login、me（JWT via `@elysia/jwt`，bcrypt via `Bun.password`）
- `/api/api-keys/*` — API key CRUD（bearer auth）
- `/api/health` — 健康检查（`/live`、`/ready`、`/db`、`/metrics`）
- `/api/models` — 列出支持的模型
- `/api/canvas/*` — Canvas CRUD + pipeline 端点 + PATCH/DELETE 子资源
- `/api/generate` — 提交生成任务（text/image/video）
- `/api/records/*` — generation records CRUD + retry/cancel
- `/api/upload` — multipart 文件上传 + delete
- `/api/subtitle/*` — 字幕流水线（upload、transcribe、burn）
- `/api/notifications/*` — 通知 CRUD
- `/api/sse` — SSE 事件流
- `/api/billing/statistics` — 费用统计
- `/api/admin/*` — 管理后台（用户/充值/provider-health/资产 retention）
- `/api/openai/*` — OpenAI 兼容网关（chat completions，经 `@excuse/gateway` 归一化）
- `/openapi` — OpenAPI 文档（Scalar UI；生产环境门禁关闭）

Server 内部：领域逻辑在 `src/modules/{canvas,generation,subtitle}/`，横切服务在 `src/services/{audit,metrics,sse-manager}.ts`，中间件在 `src/plugins/`，helper 在 `src/utils/`。全局插件（路由之前应用）：OpenAPI docs、`loggerPlugin`、`requestIdPlugin`、`rateLimitPlugin`（`@excuse/rate-limit`）、CORS、uploads 静态文件服务。导出 `export type App = typeof app` 供 Eden treaty 类型推断。

### Worker Structure (`apps/worker/src`)

单 poll 循环（`index.ts`）每周期遍历三个 PollSource（`poll-sources.ts`）：
1. **统一任务队列** — `claimNextTaskWithAdapter` → `handleTask`（按 `task.type` 分发，含 `canvas-handlers.ts`/`canvas-execution.ts` 中所有 `canvas.*` 阶段 handler + `media.extract-audio`/`media.burn-subtitle`）→ `completeTaskWithAdapter` → `advancePipelineAfterTaskSuccess`（workflow-engine 自动推进）。失败经 `handleTaskError` → task-engine retry/fail 决策。
2. **遗留 video 轮询** — `pollPendingVideoTasks()` → `task-processor.ts`（DashScope 异步 video 任务，`generation_records`，4h 超时守卫 + 退款）。**无 claim/锁/孤儿回收** —— 见 `TODO.md` §一。
3. **ASR 字幕轮询** — `pollPendingASRProjects()` → `processASRTask`（含 `asrStaleTimeoutMs` 默认 1h 超时守卫）。

> 字幕导出已迁到 `media.burn-subtitle` task（走统一队列），不再有独立的导出轮询。

另有：`startTaskHeartbeat`（续锁）、`runOrphanSweep`（恢复死锁 task，5 分钟宽限）、SIGINT/SIGTERM 优雅退出（等待当前 task 最长 30s）、`WORKER_HEALTH_PORT`（默认 5100）上的 health server。


### Database

Schema 文件在 `packages/db/src/schema/`，从 `index.ts` barrel 导出。Repository 在 `src/repositories/*.repo.ts`，service 在 `src/services/`。

| 表 | 用途 |
|------|---------|
| `accounts` | 用户：username、email、hashed password、avatar、isActive |
| `generation_records` | AI 生成任务，含 JSONB `inputParams`/`outputResult`/`cost`，按 `dedupeKey` 去重（text，无长度限制），`totalPriceCents` 整数供 SQL 聚合，`traceId` 跨服务关联 |
| `tasks` | 统一异步任务队列 — `type`/`domain`/`priority`，claim 锁（`lockedBy`/`lockedUntil`），重试（`attempts`/`maxAttempts`/`nextRunAt`），`errorJson`（`TaskErrorInfo`）。关联 `generation_records` 与 `canvas_pipeline_runs` |
| `canvas_projects` | Canvas 项目，含 status enum、JSONB analysis/layout/modelPreferences，`isDeleted` 软删 |
| `canvas_characters` / `canvas_locations` / `canvas_shots` / `canvas_continuity` | 抽取的 Canvas 子资源 |
| `canvas_pipeline_runs` | Pipeline 执行跟踪（phase、status、timing、`taskId` 关联） |
| `canvas_assets` | Canvas 资产生命周期（references、generated media；active/hidden/deleted/retained） |
| `subtitle_projects` | 字幕流水线任务，含 status enum |
| `uploaded_files` | 文件上传跟踪，含 purpose enum + 探测的真实 MIME |
| `workflows` + `workflow_steps` | 工作流模板（尚未激活） |
| `credit_accounts` + `credit_transactions` + `usage_events` | 积分/计费系统 |
| `notifications` | 用户通知 |
| `api_keys` | API key 管理（hashed） |
| `audit_logs` | 审计跟踪 |
| `password_reset_tokens` | 密码重置（hashed、30 分钟、一次性） |
| `provider_model_health` | Provider 模型降级状态（连续失败计数、冷却截止） |

用 pgEnum 表达 `category`（text/image/video/subtitle）、generation `status`（pending/submitting/processing/saving_output/succeeded/failed/cancelled）、task `status`（queued/running/retrying/succeeded/failed/cancelled）、task `domain` 及 Canvas 专属 status。Drizzle 配置在 `packages/db/drizzle.config.ts`，默认 `localhost:5433`。

### Billing

基于 cents 的算术，用 `currency.js`（`precision: 4`）。`totalPriceCents`（整数）是权威值；`totalPrice`（元）是派生显示。计费经 credit ledger：reserve → debit/refund。四个计算单元：
- **Token**：inputTokens × price/1M + outputTokens × price/1M
- **Image**：count × price（尊重 `params.n`）
- **Video**：duration × price（720P vs 1080P，按 `params.resolution`）
- **Audio**：duration × price（ASR 字幕成本）

`aggregateStatistics()` 计算总/今日/周/月成本，按 category 与 model 拆分，30 天日趋势。

### Client Structure

React Router v6 路由：`/login`、`/register`、`/`（Workspace）、`/canvas`、`/canvas/:projectId`（CanvasEditor）、`/subtitle`、`/subtitle/:id`、`/assets`、`/billing`。所有认证路由包在 `ProtectedRoute` 守卫内。token 存在时 mount 即建立 SSE 连接。

用 React Compiler（`@rolldown/plugin-babel`）自动 memoize。**注意**：React Compiler 在 try/finally 等模式下会 bailout（本仓库有 25+ 处），因此手动 `useMemo`/`useCallback` **不冗余**，勿删。详见 `docs/注意/手动memo调查-ReactCompiler.md`。Vite proxy 把 `/api` 转发到 `localhost:5007`。

**状态管理** — Zustand store：
- `useWorkspaceStore` — 模型选择、参数编辑、生成提交。category 变更时自动选首个模型。
- `useGenerationStore` — record 列表、SSE 驱动更新
- `useRealtimeSync` — SSE 事件路由、项目版本计数器供 Canvas 刷新、阶段完成信号
- `useSubtitleStore` — 字幕项目管理

**Token 存储** — Auth token 仅存内存（不进 localStorage）。浏览器 API 请求用 httpOnly cookie auth；SSE 用 Bearer header。

### Environment

必需 env：`DATABASE_URL`、`DASHSCOPE_API_KEY`、`JWT_SECRET`。

可选 env（常用）：`PORT`（默认 5007）、`FRONTEND_URL`、`NODE_ENV`（默认 development）、`LOG_LEVEL`、`STORAGE_ROOT`（默认 ./uploads）、`WORKER_POLL_INTERVAL_MS`（默认 5000）、`WORKER_STALE_TIMEOUT_MS`（默认 4h）、`WORKER_HEALTH_PORT`（默认 5100）、`WORKER_METRICS_URL`（跨进程延迟聚合）、`JWT_EXPIRES_IN`、`ADMIN_USER_IDS`（逗号分隔）、`VITE_API_BASE_URL`。

可选 env（Provider）：`PROVIDER_HTTP_TIMEOUT_MS`（默认 60000）、`PROVIDER_STREAM_IDLE_TIMEOUT_MS`（默认 30000）。

可选 env（存储/监控/邮件）：`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`、`OSS_BUCKET`、`OSS_REGION`、`OSS_ENDPOINT`、`OSS_UPLOAD_PREFIX`、`OSS_GENERATED_PREFIX`（阿里云 OSS，缺则回落本地文件系统）。`METRICS_ACCESS_TOKEN`、`METRICS_ALLOWED_CIDRS`（Prometheus `/metrics` 端点访问控制）。`SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASS`、`SMTP_FROM`（邮件发送）。完整模板见 `.env.example`。

## Conventions

- **Runtime**：处处 Bun（包管理器、测试运行器、脚本执行）
- **Linting**：`@antfu/eslint-config` + React + TypeScript —— 兼顾格式化（无 Prettier）
- **TypeScript**：strict mode、`verbatimModuleSyntax`、`noUncheckedIndexedAccess`
- **Logging**：Pino，敏感字段脱敏。用 `@excuse/shared` 的共享 logger。
- **Client API 调用**：用 `src/api/client.ts` 的 Eden treaty 实例 —— 绝不手写 fetch。
- **Client 组件**：shadcn/ui（Radix primitives）。Tailwind CSS v4。路径别名 `@/*` → `./src/*`。
- **纯包纪律**：规则包不得 import `@excuse/db`/`@excuse/provider`/apps。把 IO 移到 adapter 接口后从 app 注入。提取新规则时同步 `TODO.md`（活跃提取路线图在 §P4）。
- **Server test helper** — `apps/server/test/helpers/test-factory.ts` 提供 `makeAccount`、`makeRecord`、`makeFailedRecord`、`makeTestConfig`、`makeValidatedParams`（branded type 绕过）、`signTestToken`、`extractEdenError`。经 `mock.module()` mock `@excuse/db`（Bun 自动 hoist 到 import 之前）。针对最小 Elysia 实例用 `treaty<App>()` 测试。
- **纯包测试**：无需 mock DB/IO —— 直接传 fake adapter 或内存 fixture 给被测函数。
- **Worker 测试**：接受 `deps` override（`TaskProcessorDeps` 接口）做依赖注入。
- **DB 测试**：用事务 scope 的 Drizzle 实例 + `setDb()` 注入。
- **Client 测试**：Vitest + jsdom + @testing-library/react + @testing-library/user-event。
- **DrizzleQueryError**：Drizzle ORM 查询失败时，错误消息只显示 SQL + params。真正的 PostgreSQL 错误在 `error.cause`（如 PG 错误码 `23505` 唯一约束在 `cause.code`）。务必检查 `cause` 找真实错误。
- **错误处理**：路由 throw `AppError` 子类（`apps/server/src/utils/app-errors.ts`：`BadRequestError`/`UnauthorizedError`/`PaymentRequiredError`/`ForbiddenError`/`NotFoundError`/`ConflictError`/`ValidationError`/`RateLimitError`/`InternalError`/`ServiceUnavailableError`），由 `errorHandlerPlugin` 的全局 `onError` 统一序列化。不要在 handler 里手写 `set.status` 响应。
- **CI**：GitHub Actions（`.github/workflows/ci.yml`）跑 typecheck + lint + boundaries + build + test + test-db + client-test + docker 共 8 个 job。
- **参考文档**：`docs/注意/` 含数据库索引策略、模型配置更新流程、计费与积分账本、监控指标接入、部署指南等专项笔记。DashScope API 规格在 `docs/bailian/`。

## 项目治理（TODO / CHANGELOG 约定）

- `TODO.md`（仓库根目录）是后续产品迭代、技术治理与验收的唯一入口。
- 每完成一个独立待办：必须从 TODO.md 删除对应条目，把完成记录与 commit 写入根目录 `CHANGELOG.md`（不要写回 TODO）。不在 TODO 中保留 commit 历史。
- 不混入多个待办到一个 commit；每个独立待办对应一个 commit。
- 验收每轮整改后至少跑：`bun run typecheck`、`bun run lint`、`bun run build`、`bun run test`、`bun run test:client`；涉及 DB 时补 `bun run test:db`。
