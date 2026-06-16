# 项目统一 TODO

更新时间：2026-06-16

本文是 `excuse` 后续产品迭代、技术治理和验收标准的唯一入口。后续 Claude / Codex 只处理本文，不再拆分处理多份清单。

## 使用规则

- 本文只记录仍需推进、仍需决策或仍需验收的事项。
- 已完成事项直接从本文删除，不在 TODO 中保留 commit 历史。
- 每完成一个独立待办，必须从本文删除对应待办，并把完成记录与 commit 写入根目录 `CHANGELOG.md`。
- 不再新增“项目整改总清单”等平行清单。
- 如果一个任务已经完成且没有后续动作，可以直接从本文删除，避免占用上下文。

## 治理原则

- 项目尚未上线，不需要兼容历史脏数据或旧接口形态。
- TypeScript 类型要完整，尽量减少 `any` / `unknown` / 裸 `Record<string, unknown>`。
- 测试覆盖真实风险，不追求 100% 覆盖率。
- 业务编排自己写；通用基础能力优先使用成熟库或沉淀到 package。
- 文件职责清晰，跨模块边界必须有明确 DTO、parser 或 domain type。
- 生成过程要产品化为可见、可恢复、可重试的生产流程。
- 生成结果要沉淀为资产，而不是临时 task output。
- FFmpeg、视频合成、字幕烧录、存储、事件、任务、工作流、鉴权、限流、metrics、prompt、subtitle 等非编排能力优先下沉到 packages。

## 当前总判断

`excuse` 的核心链路已跑通，且本轮已收口上线阻断项（P0）、核心生产可靠性（P1）、CI 同口径（P4 CI）、JSONB 校验/索引（P3）、用户错误恢复（P2-3）、生产探针（P4 health）。剩余两项是规模较大的横向能力，**当前暂缓，需各自独立排期**：

- **P2-1 大项目 Canvas 性能**：跨层（DB→API→store→UI）的前端性能重构，工作量大、回归面广，需先做性能预算测量再定方案。
- **P4-1 端到端冒烟测试**：依赖前置的 provider 依赖注入重构（否则 fake adapter 无处挂载），且需全栈起停编排 + 浏览器二进制，验证环境重。

已完成但暂留验收结论的：P2-2 资产中心复用（四条验收标准已满足，见下）。

## P2：前端体验和产品闭环

### 1. 大项目 Canvas 性能风险【暂缓 — 需独立排期】

> 状态：暂不动。这是一个跨层、多文件的前端性能重构，回归面广，应单独排期 + 先做性能预算测量再定方案。下述任务/范围/风险供排期时参考。

**任务（要做什么）**

1. ProjectDTO 拆分：Canvas 主画布只加载 summary（节点摘要：id/类型/状态/缩略），右侧详情面板按需加载单节点详情（characters / locations / shots / continuity 的明细字段）。
2. 轮询 delta 局部 patch：现在 `projectVersion` 变化 → 整项目 reload（`getProjectDetail`）；升级为 shot status / asset URL / phase status 分别 patch 到 store，避免高频更新触发全量重拉。
3. 性能预算 + 测量：200 shots / 50 characters / 50 locations fixture 下，首次渲染 / 阶段更新 / 节点详情打开的 p95 基线，并落 Playwright 性能脚本或前端测试。

**触及范围（blast radius）**

- 后端 API：`apps/server/src/routes/canvas.ts`（GET project detail 需拆 summary + 分页 detail 子接口）、`apps/server/src/modules/canvas/service-crud.ts` 的 `getProjectDetail`（被 analysis/characters/locations/continuity-rebuild 等多处复用，拆分要保持这些调用方语义）。
- DB 查询：`packages/db/src/repositories/canvas-*.repo.ts`（summary 聚合 + 分页 detail 查询，注意索引；JSONB 索引已在 P3-1 补齐）。
- 前端：`apps/client/src/pages/CanvasEditor.tsx`、`apps/client/src/api/client.ts`（getCanvasProject）、`apps/client/src/hooks/use-canvas-assets-polling.ts` + `use-canvas-pipeline-runs-polling.ts`、`apps/client/src/stores/realtime-sync.ts`、节点详情面板 / 参考资产选择器组件。
- 类型：`packages/shared/src/canvas.ts` 的 `ProjectDTO`（`interface ProjectDTO` 在第 249 行，需拆 summary/detail 两套 DTO）。
- 测试：现有 canvas 集成测试需适配新接口形态 + 新增分页接口测试 + 性能脚本。

**可能出现的问题（风险）**

- summary/detail 一致性：summary 缺字段会导致画布渲染不全；detail 分页缓存的 invalidation（详情缓存与 summary 状态的同步）易出脏读。
- 局部 patch 状态不一致：shot 状态分散更新，store 合并逻辑复杂，回归风险高（现有 CanvasEditor 203 行 + 多 polling hook 紧耦合）。
- 真正瓶颈可能不在 DTO 拆分：React Flow 大量节点渲染（windowing / 虚拟化）可能是主因，拆 DTO 不一定够，需先 profiling 定位。
- 性能 p95 测量本身 flaky：依赖稳定 fixture + CI 环境，Playwright 性能脚本易抖动。
- `getProjectDetail` 被多个 phase handler 复用返回全量，拆分时要保证这些路径（如 pipeline 阶段执行后回写全量）不被破坏。
- 工作量大、跨层，单次会话难以完成且难以充分验证。

**验收（排期时达成）**

- 200 shots / 50 characters / 50 locations 的项目可流畅打开和操作。
- SSE 高频更新不会导致明显卡顿或重复全量请求。
- 前端测试或 Playwright 性能脚本覆盖大项目 fixture。

### 2. 资产中心和创作资产复用（已验收）

验收结论：四条验收标准均已满足，唯一待办（标签颜色/重命名/使用计数扩展）是显式条件项（"如果进入产品需求"），`asset_tags` schema 已声明 v1 不做颜色/图标/重命名，属延迟决策而非缺口。验收细节见 CHANGELOG（P2-2 验收复核）。

## P4：可观测性、CI 和测试体系

### 1. 缺少端到端冒烟测试【暂缓 — 需独立排期 + provider 注入前置】

> 状态：暂不动。依赖前置的 provider 依赖注入重构，且需全栈起停编排 + 浏览器二进制，验证环境重，应单独排期。下述任务/范围/风险供排期时参考。

**任务（要做什么）**

1. 引入 Playwright（或等价 E2E）+ test DB + fake provider adapter，跑关键用户旅程。
2. 最小冒烟集：注册/登录、提交文本生成、创建 Canvas 项目并跑 mock phase、资产中心查看生成结果、创建 API Key 并调用 gateway mock。
3. `bun run test:e2e` 可在 CI 稳定运行；关键旅程失败阻断发布；失败保留 screenshot/trace。
4. E2E 默认不访问真实 DashScope，provider 由测试环境 mock。

**触及范围（blast radius）**

- 前置阻塞 — provider 依赖注入重构：`DashScopeClient` 当前在路由里直接 `new`（`apps/server/src/routes/generate.ts`、canvas routes、`subtitle`、`openai-gateway.ts`），必须先抽成可注入（构造期注入 fake adapter）才能挂载 mock。这与 P6「worker handler 使用依赖注入」对称，server route 同样需要。
- 新增：`e2e/` 目录、Playwright config、fake provider adapter、global setup（起 server 5007 + worker 5100 against test DB + 健康等待 + teardown）。
- CI：`.github/workflows/ci.yml` 加 e2e job（Chromium 二进制 + postgres service，复用 P4-1 CI 已建的 DATABASE_URL 口径）。
- `package.json`：新增 `test:e2e` 脚本。

**可能出现的问题（风险）**

- provider 注入是硬前置：不做注入，fake adapter 无处挂载；注入重构触及所有 provider 调用路由，回归面广，本身就是一个独立子任务。
- 浏览器二进制：Playwright 需下载 Chromium，CI 镜像变大、install 变慢。
- 全栈起停编排 flaky：需同时起 server + worker + postgres，global setup/teardown 的时序、端口、健康轮询（可复用 P4-1 的 `/health/ready` 探针）容易抖动。
- 跨层行为难稳定：SSE、轮询 fallback、httpOnly cookie、内存 token、React Query cache invalidation 正是 E2E 要覆盖的，但时序敏感、易 flaky。
- Mock 与真实差异：fake provider 返回固定结果，无法覆盖真实 DashScope 协议边缘情况（与 P6「不建议补 DashScope 完整 mock」一致，需克制 mock 复杂度）。
- 本地/CI 环境差异导致 flaky，长期维护成本高；需明确只覆盖「关键旅程」而非追求广覆盖。

**验收（排期时达成）**

- `bun run test:e2e` 可在 CI 中稳定运行。
- 关键用户旅程失败能阻断发布。
- E2E 失败时保留 screenshot/trace。

## P5：成熟库和通用能力治理

待办：

- `p-limit` / `p-queue`：用于单个任务内部的批量上传、下载、生成、持久化并发控制；不替代 `packages/task-engine`。
- `date-fns`：等资产筛选时间、Billing 趋势、任务更新时间、中文时间格式化继续变复杂时再引入。
- `dompurify`：仅在未来展示 AI 生成 Markdown/HTML 时引入；如果一直渲染纯文本，不需要。

不建议替换：

- `crypto.randomUUID()`：当前够用，不需要换 `nanoid`。
- `currency.js`：计费已使用，继续保留。
- `zustand`：当前轻量够用，不急于替换。
- FFmpeg CLI 包装：应继续由 `packages/ffmpeg` 控制，不建议引复杂大库替代。
- Elysia route schema：服务端接口层继续用现有风格即可。

验收：

- 新增成熟库前必须说明替代了哪类手写通用逻辑。
- 不为了“少写代码”引入重依赖。
- 只在两个以上模块会复用，或手写维护成本明显偏高时引入。

## P6：测试体系与可注入设计

测试补齐原则：不追 100%，只补高 ROI 路径。

待办：

- Worker handler 新增或改造时继续使用依赖注入，不直接 import 全局 DB/provider。
- 新增复杂 worker handler 时优先写 fake adapter 单元测试，再补 DB 集成测试。
- 新增前端复杂交互时优先抽纯函数或 hook 测试，必要时补 E2E。

不建议补：

- shadcn UI 基础组件。
- FFmpeg CLI 包装的纯 mock。
- DashScope 完整 mock。

验收：

- 测试能覆盖真实失败路径。
- 不为了覆盖率数字添加脆弱断言。
- Worker handler 使用依赖注入，不直接 import 全局 DB/provider。

## P7：参考项目迁移要点

`puzzle-bobble` 更适合作为工程可靠性参考：

- 长任务状态机、可靠任务队列、Workflow run/step/task。
- SSE + PostgreSQL NOTIFY。
- 预授权、结算、退款。
- 模型目录、能力、定价、参数 schema。
- Worker 健康检查、锁续期、孤儿任务恢复、重试分类。

`lumora` 更适合作为产品平台化参考：

- creative、model-lab、admin、customer、gateway 多产品线边界。
- 统一资产轮询契约：`assets`、`bindings`、`activeTasks`、`costs`。
- API Gateway 的 customer、key、scope、quota、rate limit、usage、credit ledger。
- `TaskTypeRegistry` 为每类任务声明 billing、asset、recovery 策略。

后续不再把参考项目细节展开到本文。需要时只按当前 TODO 的具体任务去对应项目找实现参考。

## 验收命令

每轮整改后至少运行：

```bash
bun run typecheck
bun run lint
bun run build
bun run test
bun run test:client
```

涉及 DB 时补：

```bash
bun run test:db
```

类型逃逸检查：

```bash
rg -n "\bas any\b|@ts-ignore|@ts-expect-error" apps packages
```

包边界检查：

```bash
bun run check:boundaries
```

完成定义：

- 命令通过，或明确说明失败原因与是否由本轮改动引起。
- `rg any` 只允许出现在注释说明、tsconfig 模板注释或第三方声明不可控场景。
- 每个独立待办完成后，必须提交对应 git commit，不混入其他待办；完成记录和 commit 写入根目录 `CHANGELOG.md`，不要写回 TODO。
