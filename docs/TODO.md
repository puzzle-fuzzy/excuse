# 项目统一 TODO

更新时间：2026-06-17

本文是 `excuse` 后续产品迭代、技术治理和验收标准的唯一入口。后续 Claude / Codex 只处理本文，不再拆分处理多份清单。

> **2026-06-17 重组说明（两轮合并）**
>
> 第一轮：① 删除全部「多实例部署前」需求（限流 Redis 化、migration advisory lock、server/worker 可观测性去重），多实例暂不纳入；② 不再区分产品阶段一/阶段二，原「产品阶段二」(Phase 2.2/2.3/2.4) 与 Canvas 性能合并为统一「产品迭代」列表，去掉 Phase 编号与周数估算；③ 把「大文件拆分 + provider/worker 依赖注入」提升为最高优先的「地基」层 —— 多个工作单元并行时的冲突根因即在此（高耦合大文件 + provider 就地 `new` 无注入边界）。
>
> 第二轮：① 删除「API 版本管理」—— 项目自用、无外部消费者、不计划引入 `/api/v1`；② 移除「大项目 Canvas 性能」—— 无实测性能瓶颈，且原条目与工作区残留的 delta-patch 改动由前序 Claude 自行触发，非真实需求（顺手的 delta-patch `apply-entity-patches.ts` 作为既有优化保留，不再单独立项）；③ 合并 `docs/审计.md`（qwen3.7-max 审计，25 项，原文已删）—— 逐条核对当前代码后，关键问题全部已修复，剩余 6 项录入「四、代码治理」；④ `docs/` 非 bailian 文件改为直白中文名（`计费与积分账本.md` / `数据库索引策略.md` / `部署指南.md` / `监控指标接入.md` / `平台功能清单.html`），`模型配置更新流程.md` 已是中文名保留。
>
> 2026-06-16 整合说明（历史）：本文曾并入三份外部审计文档（`qwen-max-TODO.md`、`qwen-max-architecture-review.md`、`phase-2-plan.md`）的有效结论，逐条按当时代码复核。三份原始文档已删除。复核留痕见文末「审计复核记录」。

## 使用规则

- 本文只记录仍需推进、仍需决策或仍需验收的事项。
- 已完成事项直接从本文删除，不在 TODO 中保留 commit 历史。
- 每完成一个独立待办，必须从本文删除对应待办，并把完成记录与 commit 写入根目录 `CHANGELOG.md`。
- 不再新增「项目整改总清单」等平行清单。
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

`excuse` 的核心链路已跑通，**生产可靠性基线已扎实、产品闭环已合上**：计费入账、账号自助恢复、上传真实类型校验、SSE 连接数上限、nginx 体积上限与 HTTPS 终止说明、Billing 流水展示均已收口；qwen3.7-max 审计的 3 个关键问题（Gateway 重试 422、drizzle-orm 版本冲突、Dockerfile CMD）已全部清零。

本轮推进重心收敛为四条线，**按下列顺序推进**：

1. **地基加固**（一）—— 大文件拆分 + provider/worker 依赖注入。多工作单元并行的基础，也是测试与 E2E 的前置。
2. **产品迭代**（二）—— 主体资产库 → 对话式音视频 + BGM + 合成，按业务价值排序。
3. **测试**（三）—— E2E 冒烟（依赖地基一、1）。
4. **代码治理 / 工程治理**（四 / 五）—— 审计残留的重复代码/死代码/命名/a11y 债务，接触时顺手做；成熟库与仓库清理低优先。

多实例相关需求（限流 Redis 化、migration advisory lock、跨进程可观测性统一）本轮全部移除，待真正需要水平扩展时重新立项。

## 一、地基（优先级最高：多单元并行 + 可测试性的基础）

> 多工作单元同时改动 Canvas 相关代码时频繁 git 撞车，根因有二：① 路由/运行时大文件高耦合（`canvas.ts` 898 行、`Admin.tsx` 2249 行），拆分时与功能迭代抢占同一文件；② `DashScopeClient` 在路由与 worker 各 handler 就地 `new`，无共享 context、无注入边界。本节两项一起做，能让后续产品迭代与测试在更清晰的边界上并行。

### 1. provider / worker 依赖注入（WorkerContext 单例 + route 可注入）

> 合并原 P4-1 E2E 的「provider 注入重构前置」与代码治理 backlog 的「Worker client 单例 / 可注入」（审计 `arch` #13，复核为**部分有效**）。

**任务**

1. Worker 建 `WorkerContext` 单例：`DashScopeClient` / `AssetStorage` 在工厂闭包内构造一次、注入到各 handler，消除 `task-processor` / `canvas-execution` / `canvas-*-refs` / `media-handlers` 各自 `new` 的散点。（审计点名 `subtitle-processor.ts` 重复实例化不实、`task-processor.ts` 是工厂闭包内构造一次而非每任务 new —— 这两处描述误导，仅保留「无共享 WorkerContext」的真实改进点。）
2. Server route 的 `DashScopeClient` 就地 `new`（`apps/server/src/routes/generate.ts`、canvas routes、`subtitle`、`openai-gateway.ts`）抽成构造期可注入，为 fake adapter 挂载留口。
3. 上述注入边界是「三、1 E2E 冒烟测试」的**硬前置** —— 不做注入，fake provider 无处挂载。

**验收**

- worker / server 全链路只有一个 provider/AssetStorage 构造点，handler / route 通过参数接收。
- 既有测试全绿；handler 可在测试中注入 fake adapter（见三、1）。

### 2. 大文件拆分（接触时顺手做，参照 `modules/canvas/service.ts` barrel 拆分模式）

> 原则：**接触相关区域时顺手拆，不专门开重构冲刺**。拆分降低单文件耦合，多工作单元可并行落在不同子文件上。

| 文件 | 行数 | 拆分方向 |
|------|------|----------|
| `apps/client/src/pages/Admin.tsx` | 2249 | 按 tab 拆 `pages/Admin/`：index（Tab 框架）/ Overview / Users / Providers / Projects / Gateway / Audit |
| `apps/server/src/routes/canvas.ts` | 898 | 拆 projects/pipeline/phases/resources/helpers，barrel 组装 |
| `apps/worker/src/task-processor.ts` | 422 | SUCCEEDED/FAILED/timeout 三分枝拆 video-completion/video-failure/video-canvas-bridge/video-notifications |
| `packages/canvas-runtime/src/index.ts` | 384 | 拆 pure/（资产模板/引用解析/模型推荐）与 io/（`submitCanvasShotVideo` 直接调 `createGenerationRecord` 的 DB 写移出 runtime 包） |
| `apps/worker/src/index.ts` | 299 | 拆 lifecycle/poll-loop/poll-sources，主循环只遍历 `PollSource[]` |

**验收**：拆分后行为不变（既有测试全绿），新增子文件单一职责，barrel 保持对外 API 不变。

## 二、产品迭代（统一待办，不再按阶段拆分）

> 合并原「产品阶段二」，去掉 Phase 编号与周数估算，按业务价值排序。阶段一 Canvas 9 阶段流水线已成熟，下列为在其基础上的增量能力。
>
> 成本结论先行：R2V 与 T2V 同价（¥1.6/秒 1080P），升级 R2V 零成本增量；BGM + LLM 对话设计仅增加约 10% 成本。

### 1. 主体资产库（跨项目复用角色/场景）

> 合并原 Phase 2.2（MVP）与 Phase 2.4（智能匹配）。目标：角色/场景从「项目绑定」升级为「用户级资产」，跨项目复用，减少重复生成。

**数据模型**（新增表）

- `subject_library`：用户级主体资产（`subject_type` ∈ character/location），含 `identity_prompt` / `negative_prompt` / `scene_prompt` / `profile_json` / `reference_image_url` / `turnaround_sheet_url`、来源追溯（`source_project_id` / `source_entity_id`）、`tags`（GIN 索引）/ `is_favorite` / `usage_count`。索引 `(user_id, subject_type)` + `tags` GIN。
- `project_subject_refs`：项目 ↔ 主体多对多（`UNIQUE(project_id, subject_id)`），`override_json` 存本项目内差异化（如服装变化）。

**API**：`POST/GET/PATCH/DELETE /api/subjects`（列表支持搜索/标签/类型筛选）、`POST /api/canvas/:id/subjects/import`（从资产库导入到项目）。

**前端**：资产库页面；Canvas 编辑器「从资产库导入」按钮；项目完成时「保存到资产库」提示。

**智能匹配**（原 2.4）：`analyze` 阶段 LLM 提取角色/场景名时同时查询用户资产库，按名称相似度 + 描述匹配度自动关联或提示选择；`characters` / `locations` 阶段已关联主体跳过 AI 生成；资产按使用频率排序 + 「最近使用」入口。

**验收**：角色/场景可从项目保存到资产库并在新项目复用；新项目分析时自动复用已有同名/相似资产；导入后视觉档案与参考图自动填充。

### 2. 对话式音视频 + BGM + 合成

> 原 Phase 2.3。利用 HappyHorse 模型原生对话/音效能力 + R2V 角色一致性。

**流水线扩展**（现有 9 阶段基础上）

- 新增阶段 8.5 `dialogue`：输入 storyboard + characters，LLM 为每个 shot 生成对话层 prompt（提取对白 + 语气/情绪/音量 + 环境音效），输出 `dialoguePrompt` + `dialogueJson`。
- 阶段 9 `videos` 升级：有角色+场景参考图 → R2V + 对话式 prompt（`[Image N]` 指代）；仅角色参考图 → R2V；无参考图 → 降级 T2V（当前逻辑）。
- 新增阶段 10 `bgm`：FunMusic（fun-music-v1）按项目 genre/mood 生成 BGM，存 OSS + 写 `canvas_projects.bgm_url`。
- 新增阶段 11 `assemble`：FFmpeg 合成视频（含对话音频）+ BGM，或前端音轨叠加。

**Shot 数据模型扩展**：`canvas_shots` 新增 `dialogue_prompt`（TEXT）、`dialogue_json`（JSONB：lines/soundEffects/ambientSound）、`reference_media`（JSONB：R2V 参考媒体列表 + subjectId/order）。

**R2V 构建器**：新增 `buildR2VRequest(shot, characters, locations)`，收集角色 turnaround + 场景参考图组装 `media`，prompt 用 `shot.dialoguePrompt || shot.prompt`，参数含 resolution/ratio/duration/watermark。

**验收**：对话阶段产出结构化对白；R2V 路径生成角色一致 + 带音频视频；BGM 生成并合成进最终视频。

### 附：对话音视频 Prompt 规范要点（供二、2 参考）

- 结构优先级：场景建立 → 角色引入 + `[Image N]` 指代 → 动作+对话（按时间线交替）→ 运镜/视觉细节 → 环境音效。
- 明确指代说话角色（`[Image 1]中的角色说…`）、描述语气情绪、对白用中文引号、动作与对白交织、单镜头 2-3 轮对话、描述关键音效。
- R2V 参考图预算（最多 9 张）：主要角色 turnaround 2-3 张 → 次要角色 portrait 1-2 张 → 关键场景 1-2 张 → 预留 1-2 张。

### 附：对话音视频风险（供二、2 参考）

- 对话音频质量不稳定 → 保留 T2V 降级 + video-edit 后期调整。
- R2V 角色跨镜头漂移 → 优先用 turnaround sheet（三视图）而非单张 portrait。
- FunMusic 仍邀测 → 备选 Suno/Udio 或预置 BGM 库。
- 对话 prompt 超 2500 字被截断 → builder 控长，超长拆段。

## 三、可观测性与测试

### 1. 缺少端到端冒烟测试【依赖地基一、1 的 provider 注入】

> 原 P4-1。状态：暂不动 —— 依赖前置的 provider 依赖注入重构（地基一、1），且需全栈起停编排 + 浏览器二进制，验证环境重，应单独排期。下述任务/范围/风险供排期时参考。（审计 `qwen-max-TODO` #10「缺少 E2E 冒烟测试」复核确认，与本条同一缺口，不重复立项。）

**任务**

1. 引入 Playwright（或等价 E2E）+ test DB + fake provider adapter，跑关键用户旅程。
2. 最小冒烟集：注册/登录、提交文本生成、创建 Canvas 项目并跑 mock phase、资产中心查看生成结果、创建 API Key 并调用 gateway mock。
3. `bun run test:e2e` 可在 CI 稳定运行；关键旅程失败阻断发布；失败保留 screenshot/trace。
4. E2E 默认不访问真实 DashScope，provider 由测试环境 mock。

**触及范围（blast radius）**

- 前置阻塞 —— provider 依赖注入（地基一、1）：注入重构触及所有 provider 调用路由，本身即一个独立子任务。
- 新增：`e2e/` 目录、Playwright config、fake provider adapter、global setup（起 server 5007 + worker 5100 against test DB + 健康等待 + teardown）。
- CI：`.github/workflows/ci.yml` 加 e2e job（Chromium 二进制 + postgres service，复用 CI 已建的 DATABASE_URL 口径）。
- `package.json`：新增 `test:e2e` 脚本。

**可能出现的问题（风险）**

- 浏览器二进制：Playwright 需下载 Chromium，CI 镜像变大、install 变慢。
- 全栈起停编排 flaky：需同时起 server + worker + postgres，global setup/teardown 的时序、端口、健康轮询（复用 `/health/ready` 探针）容易抖动。
- 跨层行为难稳定：SSE、轮询 fallback、httpOnly cookie、内存 token、React Query cache invalidation 正是 E2E 要覆盖的，但时序敏感、易 flaky。
- Mock 与真实差异：fake provider 返回固定结果，无法覆盖真实 DashScope 协议边缘情况，需克制 mock 复杂度。
- 本地/CI 环境差异导致 flaky，长期维护成本高；需明确只覆盖「关键旅程」而非追求广覆盖。

**验收（排期时达成）**

- `bun run test:e2e` 可在 CI 中稳定运行。
- 关键用户旅程失败能阻断发布。
- E2E 失败时保留 screenshot/trace。

### 2. 测试体系原则（持续，非专项待办）

测试补齐原则：不追 100%，只补高 ROI 路径。

- Worker handler 新增或改造时继续使用依赖注入，不直接 import 全局 DB/provider。
- 新增复杂 worker handler 时优先写 fake adapter 单元测试，再补 DB 集成测试。
- 新增前端复杂交互时优先抽纯函数或 hook 测试，必要时补 E2E。

不建议补：shadcn UI 基础组件、FFmpeg CLI 包装的纯 mock、DashScope 完整 mock。

验收：测试能覆盖真实失败路径；不为了覆盖率数字添加脆弱断言；Worker handler 使用依赖注入，不直接 import 全局 DB/provider。

## 四、代码治理（重复代码 / 死代码 / 命名 / a11y，接触时顺手做）

> 来源：qwen3.7-max 审计（原 `docs/审计.md`，2026-06-17 逐条核对，仅录入「仍存在」与「待确认」项；「关键问题」3 项与「已修复」16 项不录入，见文末审计复核记录）。原则：接触相关区域时顺手做，不专门开冲刺。

- **Gateway 流式/非流式计费编排重复**（审计 2.1，部分修复）：`gateway-service.ts`（非流式）已补 `incrementApiKeySpend`/`notifyApiKeyQuota`，行为差异消除；但流式 `openai-gateway.ts` 与非流式的「创建记录→预留→调用→扣款/退款→审计」编排仍各自实现、重复约 200 行。**修复**：抽 `beginGatewayRecord` / `finalizeGatewayRecord` / `failGatewayRecord` 三阶段共用函数，两条路径共用。
- **Admin.tsx 手动 Dialog 绕过 Radix**（审计 3.2，仍存在）：`Admin.tsx:695/951/1421` 用 `<div className="fixed inset-0 z-50">` 手动搭建遮罩，无焦点陷阱 / Escape / ARIA。**修复**：替换为 `DialogContent` + `DialogHeader` + `DialogTitle`（与 Admin.tsx 拆分一并做）。
- **`CATEGORY_LABELS` 命名/值不一致**（审计 2.8，仍存在）：`Billing.tsx` 用「文本生成/图像生成/视频生成/音频生成」；`Admin.tsx` 的 `PROVIDER_CATEGORY_LABELS` 用「文本/图片/视频」且缺 `audio` 键。**修复**：精确命名（`TASK_CATEGORY_LABELS` vs `BILLING_CATEGORY_LABELS`）或提取共享模块并补齐 `audio`。
- **`estimateCost` 死导出**（审计 3.7，仍存在）：`packages/billing/src/index.ts` 导出 `estimateCost`，生产代码 0 处使用（仅测试消费）。**修复**：从公开 API 移除，或生产代码改用它替换手动 `estimated: true` 标记。
- **Developers.tsx 数据源是否走 Eden 待确认**（审计 3.3，部分修复）：原始 `fetch(`${BASE_URL}/v1/usage`)` 已移除，但新数据源（独立 hook）是否经 Eden Treaty 未确认。**修复**：确认 hook 走 Eden，或在 `api/` 显式封装。
- **SSE `connect()` 双入口待确认**（审计 3.6，部分修复）：从三处收敛为两处（`client.ts` `setAuthToken` + `AuthProvider` cookie 自动登录），但两条入口并存的潜在重复连接隐患未确认。**修复**：确认无重复连接，或收敛为单一权威入口（`AuthProvider`）。

**验收（通用）**：拆分/清理后行为不变（既有测试全绿），重复定义收敛为单一来源，导出项均有生产消费者或显式删除。

## 五、工程治理（低优先）

### 1. 成熟库和通用能力治理

待办：

- `p-limit` / `p-queue`：用于单个任务内部的批量上传、下载、生成、持久化并发控制；不替代 `packages/task-engine`。
- `date-fns`：等资产筛选时间、Billing 趋势、任务更新时间、中文时间格式化继续变复杂时再引入。
- `dompurify`：仅在未来展示 AI 生成 Markdown/HTML 时引入；如果一直渲染纯文本，不需要。

不建议替换：`crypto.randomUUID()`（够用）、`currency.js`（计费已用）、`zustand`（轻量够用）、FFmpeg CLI 包装（继续由 `packages/ffmpeg` 控制）、Elysia route schema（继续现有风格）。

验收：新增成熟库前必须说明替代了哪类手写通用逻辑；不为了「少写代码」引入重依赖；只在两个以上模块会复用、或手写维护成本明显偏高时引入。

### 2. 仓库清理

> 来源：审计 `qwen-max-architecture-review` 第八节，逐项复核。

- **`docs/bailian/`（百炼/DashScope 官方文档，已入库）**（复核确认）：属外部厂商参考文档，使 `git clone` 体积膨胀。**裁量项**：对话音视频开发仍频繁参考 HappyHorse/FunMusic 文档，是否移外部 wiki / 加入 `.gitignore` 由团队决定，不强制。

## 六、参考项目迁移要点

`puzzle-bobble` 更适合作为工程可靠性参考：长任务状态机、可靠任务队列、Workflow run/step/task；SSE + PostgreSQL NOTIFY；预授权/结算/退款；模型目录、能力、定价、参数 schema；Worker 健康检查、锁续期、孤儿任务恢复、重试分类。

`lumora` 更适合作为产品平台化参考：creative / model-lab / admin / customer / gateway 多产品线边界；统一资产轮询契约（`assets` / `bindings` / `activeTasks` / `costs`）；API Gateway 的 customer / key / scope / quota / rate limit / usage / credit ledger；`TaskTypeRegistry` 为每类任务声明 billing / asset / recovery 策略。

后续不再把参考项目细节展开到本文。需要时只按当前 TODO 的具体任务去对应项目找实现参考。

## 审计复核记录

### 2026-06-17：qwen3.7-max 审计（原 `docs/审计.md`，25 项）

> 原文已删除，内容核对后合并：关键问题全部已修复（不录入 TODO），剩余「仍存在 / 待确认」6 项录入「四、代码治理」。

逐条状态：

| 编号 | 状态 | 说明 |
|------|------|------|
| 1.1 Gateway `requestedModel` 重试 422 | 已修复 | `routes/generate.ts` 重试 handler 已 `delete requestedModel`，五字段全剥离 |
| 1.2 drizzle-orm 版本冲突 | 已修复 | 仅 `packages/db` 声明 `^0.45.2`，根/server/worker 均移除直接依赖，收敛单一版本 |
| 1.3 Dockerfile CMD 引用 .env | 已修复 | CMD 已简化为 `bun apps/server/src/index.ts`，无 `--env-file .env` |
| 2.1 Gateway 编排重复 | 部分修复 | 见四（行为差异已补，重复仍在） |
| 2.2 `centsToYuan` 重复 | 已修复 | 收敛到 `billing/src/utils.ts`，两处 import |
| 2.3 admin API Key 序列化重复 | 已修复 | 抽出 `serializeApiKey`，两 handler 复用 |
| 2.4 `loadOSSConfig`/`isPublicMetricsCidrs` 重复 | 已修复 | 迁移到 `@excuse/shared` 的 `config-helpers.ts` |
| 2.5 `formatMs` 重复 | 已修复 | `SubtitleEditor.tsx` 改为 import `@/lib/generation-utils` |
| 2.6 字幕状态常量重复 | 已修复 | 提取到 `@/lib/subtitle-constants`，两处 import |
| 2.7 剪贴板函数 4 处重复 | 已修复 | 提取到 `@/lib/utils`，四页面 import |
| 2.8 `CATEGORY_LABELS` 不一致 | 仍存在 | 见四 |
| 2.9 tsconfig 不继承根 | 已修复 | server/shared/db 三 tsconfig 均 extends 根，严格标志对齐 |
| 2.10 server/worker 未用 drizzle-orm 直接依赖 | 已修复 | 两 app `package.json` 移除，src 直接 import 0 处 |
| 3.1 Admin.tsx 过大 | 仍存在 | 录入地基一、2 拆分表格（当前 2249 行） |
| 3.2 Admin Dialog 绕过 Radix | 仍存在 | 见四 |
| 3.3 Developers.tsx fetch | 部分修复 | 见四 |
| 3.4 generation store 死代码 | 已修复 | `projectMap`/`fetchProjects` 已删除 |
| 3.5 App.tsx 缺 404 | 已修复 | 已加 `<Route path="*" element={<NotFound />} />` |
| 3.6 SSE connect 三处 | 部分修复 | 见四 |
| 3.7 `estimateCost` 死导出 | 仍存在 | 见四 |
| 3.8 health/metrics 各自 startTime | 已修复 | 改用 `config.processStartTime`，本地 startTime 移除 |
| 3.9 Dockerfile COPY 全部源码 | 已修复 | runtime-deps 只 COPY 各 workspace 的 `package.json` |
| 3.10 currency.js 版本不一致 | 已修复 | 三处统一 `^2.0.4` |
| 3.11 worker 未用 canvas-engine/prompt-engine | 已修复 | `worker/package.json` 移除，src 直接 import 0 处 |

汇总：**已修复 16 / 部分修复 3 / 仍存在（含待确认）6**。关键问题（一节）全部清零。

### 2026-06-16：qwen-max 三份审计整合

> 三份审计文档（`qwen-max-TODO.md` / `qwen-max-architecture-review.md` / `phase-2-plan.md`）已逐条对照当时代码复核。**已确认完成 / 失效的断言未录入上文**，仅在此留痕。

- 健康探针（`qwen-max-TODO` #3）：`/api/health/ready`（DB down → 503）、`/live`、`/db`、`/metrics` 已存在。闭合于 commit `9d3c0b7`。
- CI 口径（`qwen-max-TODO` #5 / `arch` #19）：CI 已拆为 typecheck/lint/boundaries/build/test/test-db/client-test/docker 八 job。闭合于 commit `4f42685`。
- 用户错误恢复 UX（`qwen-max-TODO` #7）：`@excuse/error-recovery` 的 `classifyRecovery` 已覆盖全映射。闭合于 commit `c52299d`。
- DB 连接池配置（`arch` #14）：`db.ts` 已显式设 `max`/`connect_timeout`/`idle_timeout`；`prepare:false` 刻意不设。已完成。
- Server 优雅退出（`arch` #16）：已加 SIGINT/SIGTERM + `app.stop()` + 30s 超时，与 worker 对称。已完成。
- CORS 生产配置（`arch` #17）：`localhost:8007` 用 `NODE_ENV!=='production'` 门禁。已完成。
- `qwen-max-TODO` #10「无 E2E 冒烟测试」与既有 E2E 缺口为同一项，已合并（见三、1）。
- `arch` #18「`/api/swagger` 裸露」半句失效（实际只有 `/openapi`），生产门禁已补。
- `arch` #3 / #13 对 `task-processor` / `subtitle-processor`「重复实例化」描述误导，仅保留「无 WorkerContext」真实点（见地基一、1）。
- `CLAUDE.md` 删除建议经核实为工具集成约定，非清理项。

**本轮（2026-06-17）移除的待办**（多实例需求，暂不纳入，留痕待未来重新立项）：

- 限流 Redis 化（原 P3-1，审计 `qwen-max-TODO` #8）：`SlidingWindowRateLimiter` / `apiKeyRateLimiter` 为进程内 `Map`。需多实例时迁移 Redis + Lua 滑动窗口。
- DB migration advisory lock（原 P3-2，审计 `arch` #15）：`packages/db/src/migrate.ts` 直接 `migrate()` 无并发保护，需多实例时外包 `pg_advisory_xact_lock` 或 CI 单独跑迁移。
- server/worker 可观测性去重（原代码治理 backlog，审计 #4）：`provider-health.ts` / `audit.ts` 在两端近乎相同，需多实例/统一阈值时抽 `packages/observability`。

**审计评分留档**（qwen-max）：架构 7.5/10、命名 9.5/10、类型安全 9/10、测试 ~68%、综合 8.5/10 —— 主要短板是路由/页面层膨胀（已录入地基一、2）。

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
