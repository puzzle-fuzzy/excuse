# Excuse 项目架构设计审核报告

审核时间：2026-06-12
审核范围：全项目源码（apps/server、apps/worker、packages/*）
审核维度：架构设计合理性、文件单一职责、模块边界、代码复用

---

## 一、架构优点（做得好的地方）

在指出问题之前，先确认项目中值得保留的架构设计：

1. **Packages 层边界清晰** — `events`、`gateway`、`task-engine`、`workflow-engine` 都是纯规则包（无 IO 依赖），通过 adapter 模式注入 DB 操作，单测覆盖极好
2. **Config 注入模式** — 所有路由通过 `ServerConfig` 获取配置，不直接读 `process.env`，测试友好
3. **Repository 模式一致** — `packages/db/src/repositories/` 全部是导出函数，`getDb()/setDb()` 单例注入
4. **Factory 路由模式** — `createXxxRoutes(config)` 返回独立 Elysia 实例，路由间解耦
5. **Canvas service barrel export** — `modules/canvas/service.ts` 做统一重导出，15 个文件按职责拆分，是项目内最佳实践
6. **Task Engine adapter 模式** — `claimNextTaskWithAdapter`、`completeTaskWithAdapter` 等将 DB 操作通过 adapter 注入，纯逻辑包零 DB 依赖

---

## 二、架构问题与解决方案

### 问题 1：canvas.ts 路由文件过大（899 行）— 严重违反单一职责

**现状**：`apps/server/src/routes/canvas.ts` 是全项目最大的路由文件，混合了 5 类完全不同的职责：

- 项目 CRUD（list/create/delete/patch）
- Pipeline Run 查询（list runs / get run by id）
- 9 个流水线阶段执行（analyze → characters → locations → refs → storyboard → continuity → rebuild → videos）
- 资源 PATCH/DELETE（角色、场景、镜头编辑删除）
- 辅助操作（layout、model-preferences、retry、retry-failed）

**问题**：
- 每个 pipeline 阶段都有 30-50 行的并发守卫 + fireAndForget + 错误处理代码，大量重复模式
- 路由 handler 内嵌业务逻辑（直接调用 DB、构造 notify payload），不像其他路由那样委托给 `modules/`
- 新增功能（如新 phase）必须在这个 900 行文件里找位置插入

**解决方案**：参照 `modules/canvas/service.ts` 的拆分模式，将路由层也拆分：

```
routes/
  canvas.ts              → 只做 barrel，组装子路由 (~30 行)
  canvas/projects.ts     → 项目 CRUD (~100 行)
  canvas/pipeline.ts     → pipeline run 查询 (~60 行)
  canvas/phases.ts       → 9 个阶段执行端点 (~300 行，可进一步拆分)
  canvas/resources.ts    → 角色/场景/镜头 PATCH/DELETE (~150 行)
  canvas/helpers.ts      → 辅助操作 (layout, retry) (~80 行)
```

**工作量**：约 2-3 天，纯重构无风险

---

### 问题 2：admin.repo.ts 巨型仓库（1179 行）— 所有管理查询集中在一文件

**现状**：`packages/db/src/repositories/admin.repo.ts` 包含 11 个导出函数，覆盖 6 个不同业务域：

| 函数 | 业务域 |
|------|--------|
| `getAdminOverview` | 全局统计 |
| `listAdminTasks` / `getAdminTaskDetail` / `requeueAdminTask` / `cancelAdminTask` | 任务管理 |
| `listAdminUsers` / `getAdminUserDetail` | 用户管理 |
| `getAdminProviderStats` | Provider 健康 |
| `listAdminProjects` | 项目管理 |
| `listAdminGatewayClients` / `getAdminGatewayClientDetail` | Gateway 客户 |

**问题**：
- 文件顶部 import 了 8 张表（accounts, apiKeys, canvasPipelineRuns, canvasProjects, canvasShots, creditAccounts, generationRecords, tasks），违反最小知识原则
- 新增管理功能（如审计日志查询）只能继续往这个文件追加
- 内部类型定义（`AdminOverview`, `AdminTaskItem` 等）共 80+ 行，应从 schema 推导

**解决方案**：按业务域拆分为独立 repo 文件：

```
repositories/
  admin.repo.ts          → barrel re-export (~30 行)
  admin-overview.repo.ts → getAdminOverview + AdminOverview 类型
  admin-tasks.repo.ts    → listAdminTasks / getAdminTaskDetail / requeue / cancel
  admin-users.repo.ts    → listAdminUsers / getAdminUserDetail
  admin-providers.repo.ts → getAdminProviderStats
  admin-projects.repo.ts  → listAdminProjects
  admin-gateway.repo.ts   → listAdminGatewayClients / getAdminGatewayClientDetail
```

**工作量**：约 1 天，纯文件拆分

---

### 问题 3：task-processor.ts 职责过载（421 行）— Worker 的「上帝函数」

**现状**：`apps/worker/src/task-processor.ts` 的 `processTask` 函数内包含：

1. 超时检测 + 退款 + 审计 + canvas 资产标记 + 通知推送（~50 行）
2. SUCCEEDED 分支：下载 + 计费 + debit + 审计 + canvas 资产标记 + shot 更新 + 通知推送 + canvas 完成通知（~100 行）
3. FAILED 分支：退款 + 审计 + canvas 资产标记 + shot 更新 + 通知推送（~50 行）
4. PENDING/RUNNING 分支（~5 行）
5. 底部工具函数：`refundReservedCredit`、`updateCanvasShotAndProject`、`checkProjectCompletion`、`extractVideoUrl`、`extractVideoDuration`

**问题**：
- SUCCEEDED 分支内有 7 个 `.catch(err => logger.warn(...))` 的 fire-and-forget 调用，错误处理散落各处
- Canvas 逻辑（shot 更新、资产标记、项目完成检查）和视频轮询逻辑紧密耦合
- 通知推送代码在超时/成功/失败三处重复（只是 title/body 不同）

**解决方案**：

```
task-processor.ts         → 只保留 switch dispatch + 接口定义 (~80 行)
video-completion.ts       → SUCCEEDED 分支的完整处理 (~100 行)
video-failure.ts          → FAILED 分支 + 超时处理 (~80 行)
video-canvas-bridge.ts    → Canvas shot/asset/project 联动逻辑 (~60 行)
video-notifications.ts    → 统一通知推送构造 (~40 行)
```

**工作量**：约 1-2 天

---

### 问题 4：server 和 worker 之间的代码重复

**现状**：以下代码在 server 和 worker 中各存在一份几乎相同的实现：

| 模块 | Server 路径 | Worker 路径 | 行数 |
|------|------------|------------|------|
| Provider Health | `services/provider-health.ts` (84 行) | `services/provider-health.ts` (84 行) | 完全相同 |
| Metrics | `services/metrics.ts` (32 行) | `services/metrics.ts` (32 行) | 完全相同 |
| Audit | `services/audit.ts` (55 行) | `services/audit.ts` (56 行) | 几乎相同 |
| Observer 注册 | `index.ts` 第 45-58 行 | `index.ts` 第 28-39 行 | 模式相同 |

**问题**：
- 修改断路器阈值需要同时改两处
- Audit 服务的 `setAuditWriter` / `resetAuditWriter` 在两个进程中独立维护
- 未来添加新功能（如 tracing）需要 4 处修改

**解决方案**：提取到共享 package：

```
packages/
  observability/          → 新 package
    src/
      audit.ts            → audit() + setAuditWriter()
      metrics.ts          → recordProviderCall() + getProviderCallsSnapshot()
      provider-health.ts  → providerCallGuard() + warmProviderHealthCache()
      observer-setup.ts   → registerDefaultProviderObservers() 一键注册
```

Server 和 Worker 各自只需：
```ts
import { setupObservability } from '@excuse/observability'
setupObservability({ processName: 'server' | 'worker' })
```

**工作量**：约 2 天

---

### 问题 5：canvas-runtime 包职责过宽（384 行 + 子模块）

**现状**：`packages/canvas-runtime` 包含 4 类不同职责：

1. **资产生命周期管理**：`runCanvasAssetStep`、`generateCanvasImageAsset`（通用步骤模板）
2. **视频模型推荐**：`recommendCanvasVideoModel`、`getCanvasVideoModel`（纯规则）
3. **视频提交**：`submitCanvasShotVideo`、`prepareCanvasVideoParams`（IO 操作）
4. **引用解析**：`resolveShotVideoReferences`（纯函数）
5. **9 个 LLM phase 实现**：通过 `export * from './phases/xxx'` 导出

**问题**：
- `submitCanvasShotVideo` 直接调用 `createGenerationRecord`（DB 写操作），让这个「runtime 包」变成了有 IO 依赖的 service
- 视频模型推荐是纯规则函数，不应和 IO 操作放在同一个包
- 9 个 phase 实现各自依赖 `DashScopeClient` + `AssetStorage`，使得整个包无法在纯规则层面测试

**解决方案**：

```
packages/
  canvas-runtime/         → 保留：资产步骤模板 + 引用解析（纯函数/通用模板）
  canvas-phases/          → 新包：9 个 LLM phase 实现（依赖 DashScope + AssetStorage）
  canvas-video/           → 新包：视频模型推荐 + 视频提交（IO 操作）
```

或者更轻量的方案：保持一个包，但内部拆分为 `pure/` 和 `io/` 子目录，barrel 分别导出。

**工作量**：约 3 天（大重构）或 1 天（内部目录拆分）

---

### 问题 6：notifications.ts 既是路由又是工具库

**现状**：`apps/server/src/routes/notifications.ts`（283 行）承担双重角色：

1. **路由定义**：`createNotificationRoutes` 提供 `/api/notifications` 的 CRUD 端点
2. **通知发送工具**：导出 `notifyInsufficientBalance`、`notifyCanvasPhaseFailed`、`notifyApiKeyRevoked` 等函数，被 `generate.ts`、`canvas.ts`、`admin.ts`、`openai-gateway.ts` 等路由 import

**问题**：
- 路由文件 import 另一个路由文件的导出函数，形成隐式依赖链
- 通知发送函数（`notifyNotification` 的封装）混在路由定义中，违反层级
- 通知冷却逻辑在 `services/notification-cooldown.ts`，但通知构造在路由文件

**解决方案**：

```
routes/
  notifications.ts        → 只保留路由定义 (~120 行)
services/
  notifications.ts        → 新建：所有 notify* 函数 + 冷却逻辑 (~150 行)
```

其他路由改为 `import { notifyInsufficientBalance } from '../services/notifications'`

**工作量**：半天

---

### 问题 7：worker/index.ts 主循环过于庞大（298 行）

**现状**：Worker 入口文件混合了 6 类关注点：

1. Observer/Guard 注册（第 28-39 行）
2. ASR Client 初始化（第 40-43 行）
3. Health State 初始化（第 63-81 行）
4. 优雅退出信号处理（第 84-108 行）
5. Orphan Sweep 定时器（第 112-134 行）
6. 主轮询循环（第 146-297 行）— 内含 3 种任务处理（claim task、video poll、ASR poll）

**问题**：
- 主循环内直接处理 3 种不同轮询源（task queue、generation_records、subtitle_projects），新增任务类型需修改主循环
- 错误处理（ECONNREFUSED、UNDEFINED_TABLE）散落在循环内外多处
- `currentTaskPromise` 全局变量用于优雅退出等待，状态管理脆弱

**解决方案**：

```
worker/
  index.ts                → 只做启动编排 (~50 行)
  lifecycle.ts            → 优雅退出 + 信号处理 (~60 行)
  poll-loop.ts            → 统一轮询调度器 (~80 行)
  poll-sources/
    task-queue.ts         → claim task 逻辑
    video-records.ts      → pollPendingVideoTasks 逻辑
    asr-projects.ts       → pollPendingASRProjects 逻辑
```

每个 poll source 实现统一接口 `PollSource { poll(): Promise<void>, name: string }`，主循环只遍历 sources。

**工作量**：约 2 天

---

### 问题 8：generate.ts 路由与 modules/generation/service.ts 边界模糊

**现状**：
- `routes/generate.ts`（459 行）包含：参数校验、dedupe 检查、credit 预留、provider 调用、序列化、retry/cancel 端点
- `modules/generation/service.ts`（299 行）包含：dedupe 检查、reference 解析、provider 调用三分支处理、取消

**问题**：
- `generate.ts` 的 POST `/generate` handler 有 ~200 行，内部调用了 service 但自己也做了大量业务逻辑（category 限流、dedupe key 构造、credit reserve、参数校验）
- 部分函数在 route 和 service 之间重复定义（如 `serializeRecord` 在 route 中，但 `parseProviderOutput` 在 service 中）
- retry 和 cancel 端点直接在 route 文件中实现完整逻辑，没有走 service

**解决方案**：
- route 只负责 HTTP 层（参数解析、状态码、响应序列化）
- 所有业务逻辑（dedupe、reserve、execute、retry、cancel）统一到 service
- `serializeRecord` 移到 service 或 shared 类型中

**工作量**：约 1 天

---

### 问题 9：openai-gateway.ts 路由过大（456 行）且逻辑内嵌

**现状**：`routes/openai-gateway.ts` 包含：

1. API Key 认证 + scope 校验
2. Chat Completions（同步 + 流式两条路径）
3. Models 列表
4. Usage 查询
5. 内嵌的 `generateRecordFromGateway` 函数（~50 行的生成记录创建逻辑）

**问题**：
- 流式和非流式两个分支各 50+ 行，逻辑高度相似但没提取公共部分
- Gateway 的 credit 扣款逻辑和 `generate.ts` 中的逻辑重复（`reserveCredit` → `debitCredit` / `refundCredit`）
- `packages/gateway` 是纯规则包，但路由内有大量 IO 操作不属于 gateway 包的职责

**解决方案**：

```
routes/
  openai-gateway.ts       → 只保留路由定义 + 参数解析 (~150 行)
modules/
  gateway/
    service.ts            → Gateway 业务逻辑（创建记录、计费、流式/非流式分流）
    stream-handler.ts     → 流式响应的 SSE 管道
    auth.ts               → API Key 认证 + scope 校验
```

**工作量**：约 1-2 天

---

### 问题 10：assets.ts 路由过大（513 行）— 统一资产中心的查询逻辑全在路由层

**现状**：`routes/assets.ts` 包含 4 个查询端点（生成记录资产、Canvas 资产、上传文件资产、资产详情），每个端点内有 30-60 行的查询参数构造 + 结果序列化 + 标签聚合。

**问题**：
- 3 种资产类型的查询/过滤/分页逻辑高度相似但各自独立实现
- 标签聚合（`getAssetTagsForAccount`）直接在路由中调用，没有 service 层
- 搜索关键词过滤的 SQL 拼接在 `generation-records.repo.ts` 和 `canvas-assets.repo.ts` 中重复

**解决方案**：提取 `modules/assets/service.ts` 统一 3 种资产的查询逻辑，路由只做参数解析和响应。

**工作量**：约 1 天

---

## 三、横切面问题

### 问题 11：错误处理缺乏统一中间件

**现状**：每个路由文件自行 import `{ forbidden, notFound, validationError }` 并手动返回错误响应：

```ts
if (!modelConfig) return validationError(set, `Unknown model: ${model}`)
if (!project) return notFound(set, '项目不存在')
```

**问题**：
- 每个 handler 都需要 `set` 参数来设置 HTTP 状态码，增加了函数签名复杂度
- 错误响应格式不完全一致（有些用 `{ error: string }`，有些用 `{ success: false, message: string }`）
- 没有全局错误捕获中间件 — 未预期的异常直接变成 500

**解决方案**：
- 引入 Elysia `onError` 全局钩子
- 业务逻辑抛出自定义错误类（`ValidationError`、`NotFoundError`、`ForbiddenError`），由中间件统一序列化
- 去掉所有 `validationError(set, ...)` / `notFound(set, ...)` 调用

**工作量**：约 2 天，需要修改所有路由

---

### 问题 12：序列化函数散落各处

**现状**：以下序列化函数分散在路由文件中，模式高度一致：

- `serializeRecord` — `generate.ts`
- `serializePipelineRun` — `canvas.ts`
- `serializeNotification` — `notifications.ts`
- `toHealthSummary` — `admin.ts`
- `serializeProviderCancelStatus` — `generate.ts`

每个函数都是 `Date → ISO string` 的字段映射。

**问题**：
- 新增字段时需要同时修改 schema 类型和序列化函数
- 不同路由对相同实体（如 `GenerationRecord`）的序列化方式可能不一致

**解决方案**：
- 在 `packages/shared` 或 `packages/db` 中定义 `serialize<T>(row: RawRow): DTO` 函数
- 或使用 Drizzle 的 `$returning()` 插件自动做 Date→string 转换
- 路由层不再手写序列化

**工作量**：约 1-2 天

---

### 问题 13：Worker 内 DashScopeClient / AssetStorage 重复实例化

**现状**：Worker 中以下文件各自 `new DashScopeClient(...)` 和 `new AssetStorage(...)`：

- `task-processor.ts`
- `canvas-handlers.ts`
- `media-handlers.ts`
- `subtitle-processor.ts`

**问题**：
- 每个 handler 创建独立的 client 实例，无法共享连接池
- Provider observer/guard 虽然通过全局注册覆盖了所有实例，但语义不清晰
- 测试时需要 mock 多个实例

**解决方案**：在 Worker 入口创建单例，通过 config/context 传递：

```ts
// worker/context.ts
export interface WorkerContext {
  config: WorkerConfig
  client: DashScopeClient
  storage: AssetStorage
  asrClient: ASRClient
}
```

**工作量**：约半天

---

## 四、优先级排序

| 优先级 | 问题 | 影响 | 工作量 |
|--------|------|------|--------|
| **P0** | #1 canvas.ts 路由拆分 | 可维护性瓶颈，新功能开发越来越困难 | 2-3 天 |
| **P0** | #11 统一错误处理 | 未预期异常直接 500，错误格式不一致 | 2 天 |
| **P1** | #3 task-processor 拆分 | Worker 核心逻辑难以测试和扩展 | 1-2 天 |
| **P1** | #7 worker/index.ts 重构 | 新增轮询源需改主循环 | 2 天 |
| **P1** | #4 server/worker 代码去重 | 每次修改需同步两处 | 2 天 |
| **P1** | #2 admin.repo.ts 拆分 | 仓库越来越大，新增功能只能追加 | 1 天 |
| **P2** | #6 notifications 路由/工具分离 | 路由间隐式依赖 | 半天 |
| **P2** | #8 generate route/service 边界 | 业务逻辑分散 | 1 天 |
| **P2** | #9 gateway 路由拆分 | 路由过大 | 1-2 天 |
| **P2** | #5 canvas-runtime 包拆分 | 包职责过宽 | 1-3 天 |
| **P2** | #12 序列化统一 | 散落各处，不一致风险 | 1-2 天 |
| **P3** | #10 assets 路由提取 service | 代码重复 | 1 天 |
| **P3** | #13 Worker client 单例化 | 资源浪费 | 半天 |

---

## 五、总体架构评估

**当前架构评分**：7.5/10

**优点**：
- Package 层设计优秀，纯规则包 + adapter 模式是教科书级别的实现
- Config 注入 + Factory 路由 + Repository 模式三大基础架构扎实
- Canvas pipeline 的状态机设计（workflow-engine）和阶段实现（canvas-runtime）分离合理
- Credit 计费闭环和 SSE 实时推送链路完整

**主要短板**：
- **路由层膨胀**：canvas.ts(899)、admin.repo.ts(1179)、assets.ts(513)、openai-gateway.ts(456) 四个大文件是最大瓶颈
- **Worker 层缺乏抽象**：主循环 + task-processor 承担了过多职责
- **横切面缺失**：错误处理、序列化、通知发送缺乏统一中间件

**核心建议**：先做 P0 的两项（canvas 路由拆分 + 统一错误处理），可以立即改善 80% 的可维护性问题。其余 P1/P2 可在后续迭代中逐步推进。
