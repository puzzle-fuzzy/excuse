# 端到端冒烟测试（E2E）

`docs/TODO.md §三、1` 的落地。关键用户旅程跑在**真实 server + 真实 worker 处理器 + 真实 Postgres + 真实 SSE 桥接**之上，但 **provider 由 fake 适配器注入**，全程不访问真实 DashScope。

这是对「provider 依赖注入地基」（`createServerContext` / `createWorkerContext` 的 `overrides` 注入口）的直接验证：fake provider 经该口注入后，server 与 worker 的所有 provider 调用都命中桩，而非真实网络。

## 覆盖的旅程

| # | 旅程 | 验证点 |
|---|------|--------|
| 1 | 健康就绪 | `/api/health/live` `/db` `/ready` — 真实 PG + 可写存储 |
| 2 | 注册 / 登录 | httpOnly cookie + JWT（E2E 用 Bearer 第 3 通道）；未认证 → 401 |
| 3 | 提交文本生成 | **server 侧 fake provider**：`generate` 被调用、输出落库、记录 `succeeded`；**sub-cent 计费落库**（fake usage 1000/500 token → 0.72 分，numeric(20,4) 列 reserve→debit 验证） |
| 4 | API Key + Gateway | **gateway 侧 fake provider**：创建 `exc_` key、`/v1/chat/completions` 返回 OpenAI 形态 |
| 5 | Canvas analyze 阶段 | **canvas 路径 fake provider**：创建项目 → analyze（in-process fire-and-forget）→ run `succeeded`、项目 `analyzed` |
| 6 | 视频生成 → worker | **worker 侧 fake provider**：提交 → worker 处理器 `queryTask` → `succeeded`，覆盖 reserve→debit 计费闭环 |

每个 provider 相关旅程都断言 `control.calls.*` 增长，即 provider 注入确实生效。

## 运行

```bash
# 前置：Postgres 已起且 schema 已 push（CI 自动；本地见下）
bun run test:e2e
```

### 本地

E2E 需要一个已 `db:push` 的库。默认回落开发库（`localhost:5433/excuse`）；推荐用独立库隔离：

```bash
# 1. 建独立库（docker PG 已在 :5433）
docker exec excuse-postgres psql -U excuse -d excuse -c "CREATE DATABASE excuse_e2e;"

# 2. push schema 到该库
DATABASE_URL="postgres://excuse:excuse_dev@localhost:5433/excuse_e2e" \
  bun --cwd packages/db drizzle-kit push

# 3. 跑 E2E 指向该库
DATABASE_URL="postgres://excuse:excuse_dev@localhost:5433/excuse_e2e" bun run test:e2e
```

测试用唯一用户名（`e2e_<pid>-<ts>_<seq>`），可重复运行不撞唯一约束。

## CI

`e2e` job（`.github/workflows/ci.yml`）复用 `test` job 的 postgres service + `db:push` 口径，关键旅程失败即阻断发布。`typecheck:e2e` 已纳入根 `typecheck` 并发链。

## 架构

- `fixtures/fake-provider.ts` — `FakeDashScopeClient`，实现 `DashScopeClient` 全部公开方法面，返回确定性结果 + 记录调用。经 `as unknown as DashScopeClient` 单点转换注入（context 类型为具体类，含私有字段）。
- `fixtures/stack.ts` — `startTestStack()`：临时本地存储 → `createServerContext` / `createWorkerContext` 注入 fake → `createElysiaApp`（从 `apps/server/src/app.ts` 抽出的装配工厂）→ `listen(0)` → `startSSEListener`。`processVideoRecord()` 驱动 worker 的 `createTaskProcessor`（fake `queryTask` + 桩 `downloadAndMap`）。

## 已知限制（非 E2E 范围）

- **媒体下载桩化**：视频旅程的 `downloadAndMap` 桩化（不真下载）。真实下载由 `packages/storage` 单测与 assemble 真实冒烟覆盖，E2E 不重复其 flaky 风险。
- **浏览器层未覆盖**：本套件为 HTTP 全栈 E2E（非 Playwright 浏览器自动化）。TODO 原文「Playwright（或等价 E2E）」——HTTP 全栈同等覆盖关键旅程，且更 CI 稳定（无浏览器二进制、无跨层时序 flaky）。浏览器专属交互（httpOnly cookie 在真实浏览器、SSE `fetch-event-source`）可后续按需加 Playwright 层。
