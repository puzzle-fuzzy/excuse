# 项目统一 TODO

更新时间：2026-06-16

本文是 `excuse` 后续产品迭代、技术治理和验收标准的唯一入口。后续 Claude / Codex 只处理本文，不再拆分处理多份清单。

> 2026-06-16 整合说明：本文已并入三份外部审计文档（`qwen-max-TODO.md` 上线审核、`qwen-max-architecture-review.md` 架构与安全审核、`phase-2-plan.md` 阶段二产品方案）的有效结论。每条结论都按当前代码复核过：已完成 / 失效的审计断言未录入（见文末「审计复核记录」）；确认仍存在的录入对应优先级；架构重构与产品阶段二作为 backlog / 路线图单列。三份原始文档已删除。

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

`excuse` 的核心链路已跑通。**生产可靠性基线已扎实，产品闭环已合上**：本轮收口了计费入账（P0-1 充值/初始额度）、账号自助恢复（P0-2 密码重置）、上传文件真实类型校验与单用户频次（P1-3）、SSE 连接数上限（P1-4）、nginx 上传体积上限与 HTTPS 终止说明（P1-2）、Billing 页面余额与交易流水展示（P1-1）。安全与产品缺口已补齐，可支撑内测阶段真实业务。

其余为规模化（多实例限流 / 迁移锁 / API 版本）、大文件重构 backlog、阶段二产品路线图，以及已暂缓的 P2-1 Canvas 性能 / P4-1 E2E。

## P0：上线阻断项
**（以下 P0 与 P1 条目已于 2026-06-16 完成，详见 CHANGELOG.md）**

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

## P3：规模化与一致性（多实例部署前）

> 这些问题单实例部署不暴露；水平扩展或多实例并发执行时才成为真问题。当前按「需要多实例时再处理」排期。

### 1. 限流 Redis 化

> 审计 `qwen-max-TODO` #8 复核确认。`packages/rate-limit` 的 `SlidingWindowRateLimiter` 与 `plugins/auth.ts` 的 `apiKeyRateLimiter` 均为进程内 `Map`，文档自述「多副本部署时实际配额 = 实例数 × maxRequests」。

**任务**：需要多实例时迁移到 Redis + Lua（滑动窗口），保持现有接口不变（包已为替换预留接口）。

**验收**：多实例下全局 / per-key 限流配额与单实例一致。

### 2. DB migration advisory lock

> 审计 `qwen-max-architecture-review` #15 复核确认。`packages/db/src/migrate.ts` 直接 `migrate()` 无并发保护；多实例/多进程同时执行迁移会竞争 DDL。当前风险有界（迁移作为一次性 init job，非进程内并发），但多实例部署需补。

**任务**：迁移外包一层 `pg_advisory_xact_lock`（固定 key），或 CI 中单独运行迁移、进程启动跳过。

**验收**：并发执行迁移只有一方真正执行 DDL，其余等待或跳过。

### 3. API 版本管理【低优先 — 设计决策】

> 审计 `qwen-max-architecture-review` #20 复核确认。所有业务路由在 `/api/` 下无版本号，仅 OpenAI gateway 用 `/v1`。

**判断**：项目尚未上线、无外部消费者，引入 `/api/v1/...` 前缀现在成本最低、未来收益最大；但也属可选设计决策，不阻断上线。

**任务（若采纳）**：业务路由前缀升 `/api/v1`；或通过 `Accept: application/vnd.excuse.v1+json` 头做版本路由。

**验收**：外部调用方（尤其 OpenAI Gateway 客户）能锁定特定版本；不兼容变更有版本隔离。

## P4：可观测性、CI 和测试体系

### 1. 缺少端到端冒烟测试【暂缓 — 需独立排期 + provider 注入前置】

> 状态：暂不动。依赖前置的 provider 依赖注入重构，且需全栈起停编排 + 浏览器二进制，验证环境重，应单独排期。下述任务/范围/风险供排期时参考。（审计 `qwen-max-TODO` #10「缺少 E2E 冒烟测试」复核确认，与本条同一缺口，不重复立项。）

**任务（要做什么）**

1. 引入 Playwright（或等价 E2E）+ test DB + fake provider adapter，跑关键用户旅程。
2. 最小冒烟集：注册/登录、提交文本生成、创建 Canvas 项目并跑 mock phase、资产中心查看生成结果、创建 API Key 并调用 gateway mock。
3. `bun run test:e2e` 可在 CI 稳定运行；关键旅程失败阻断发布；失败保留 screenshot/trace。
4. E2E 默认不访问真实 DashScope，provider 由测试环境 mock。

**触及范围（blast radius）**

- 前置阻塞 — provider 依赖注入重构：`DashScopeClient` 当前在路由里直接 `new`（`apps/server/src/routes/generate.ts`、canvas routes、`subtitle`、`openai-gateway.ts`），必须先抽成可注入（构造期注入 fake adapter）才能挂载 mock。这与代码治理 backlog「Worker client 单例 / 可注入」对称，server route 同样需要。
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

## 产品阶段二：主体资产库 + HappyHorse 对话音视频

> 来源：`phase-2-plan.md`（已删除并整合）。阶段一 Canvas 9 阶段流水线已成熟；阶段二聚焦两大能力：① 跨项目主体资产库（角色/场景从「项目绑定」升级为「用户资产」）；② HappyHorse 对话式音视频（利用模型原生对话/音效能力 + R2V 角色一致性）。这是产品路线图，非审计缺陷，按业务节奏推进。

成本结论先行：R2V 与 T2V 同价（¥1.6/秒 1080P），升级 R2V 零成本增量；BGM + LLM 对话设计仅增加约 10% 成本。

### Phase 2.1：HappyHorse 对话 Prompt 优化（1-2 周，不改数据模型）

**任务**

1. 修改 `canvas-prompt-builder.ts` 的 `buildVideoPrompt()`：从 storyboard 提取每个 shot 的 dialogue / narration，融入 prompt（角色名 + 对白 + 语气），加环境音效描述。
2. shot 生成时优先用 R2V（角色有 turnaround sheet 时）：自动收集 `turnaround_sheet_url` / `reference_image_url`，构建 `media: [{type:"reference_image", url}]`，prompt 中用 `[Image N]` 指代角色。
3. 测试对话式 prompt 的音频生成效果；前端 shot 卡片显示音频标识（有/无对话音频）。

**验收**：生成的视频带对话/环境音频；R2V 在有参考图时自动启用。

### Phase 2.2：主体资产库 MVP（2-3 周）

**数据模型**（新增表）

- `subject_library`：用户级主体资产（`subject_type` ∈ character/location），含 `identity_prompt` / `negative_prompt` / `scene_prompt` / `profile_json` / `reference_image_url` / `turnaround_sheet_url`、来源追溯（`source_project_id` / `source_entity_id`）、`tags`（GIN 索引）/ `is_favorite` / `usage_count`。索引 `(user_id, subject_type)` + `tags` GIN。
- `project_subject_refs`：项目 ↔ 主体多对多（`UNIQUE(project_id, subject_id)`），`override_json` 存本项目内差异化（如服装变化）。

**API**：`POST/GET/PATCH/DELETE /api/subjects`（列表支持搜索/标签/类型筛选）、`POST /api/canvas/:id/subjects/import`（从资产库导入到项目）。

**前端**：资产库页面；Canvas 编辑器「从资产库导入」按钮；项目完成时「保存到资产库」提示。

**验收**：角色/场景可从项目保存到资产库并在新项目复用；导入后视觉档案与参考图自动填充。

### Phase 2.3：对话设计阶段 + BGM（2-3 周）

**流水线扩展**（现有 9 阶段基础上）

- 新增阶段 8.5 `dialogue`：输入 storyboard + characters，LLM 为每个 shot 生成对话层 prompt（提取对白 + 语气/情绪/音量 + 环境音效），输出 `dialoguePrompt` + `dialogueJson`。
- 阶段 9 `videos` 升级：有角色+场景参考图 → R2V + 对话式 prompt（`[Image N]` 指代）；仅角色参考图 → R2V；无参考图 → 降级 T2V（当前逻辑）。
- 新增阶段 10 `bgm`：FunMusic（fun-music-v1）按项目 genre/mood 生成 BGM，存 OSS + 写 `canvas_projects.bgm_url`。
- 新增阶段 11 `assemble`：FFmpeg 合成视频（含对话音频）+ BGM，或前端音轨叠加。

**Shot 数据模型扩展**：`canvas_shots` 新增 `dialogue_prompt`（TEXT）、`dialogue_json`（JSONB：lines/soundEffects/ambientSound）、`reference_media`（JSONB：R2V 参考媒体列表 + subjectId/order）。

**R2V 构建器**：新增 `buildR2VRequest(shot, characters, locations)`，收集角色 turnaround + 场景参考图组装 `media`，prompt 用 `shot.dialoguePrompt || shot.prompt`，参数含 resolution/ratio/duration/watermark。

**验收**：对话阶段产出结构化对白；R2V 路径生成角色一致 + 带音频视频；BGM 生成并合成进最终视频。

### Phase 2.4：资产库智能匹配（1 周）

**任务**：`analyze` 阶段 LLM 提取角色/场景名时同时查询用户资产库，按名称相似度 + 描述匹配度自动关联或提示选择；`characters` / `locations` 阶段已关联主体跳过 AI 生成；资产按使用频率排序 + 「最近使用」入口。

**验收**：新项目分析时自动复用已有同名/相似资产，减少重复生成。

### 阶段二 Prompt 规范（要点）

- 结构优先级：场景建立 → 角色引入 + `[Image N]` 指代 → 动作+对话（按时间线交替）→ 运镜/视觉细节 → 环境音效。
- 明确指代说话角色（`[Image 1]中的角色说…`）、描述语气情绪、对白用中文引号、动作与对白交织、单镜头 2-3 轮对话、描述关键音效。
- R2V 参考图预算（最多 9 张）：主要角色 turnaround 2-3 张 → 次要角色 portrait 1-2 张 → 关键场景 1-2 张 → 预留 1-2 张。

### 阶段二风险

- 对话音频质量不稳定 → 保留 T2V 降级 + video-edit 后期调整。
- R2V 角色跨镜头漂移 → 优先用 turnaround sheet（三视图）而非单张 portrait。
- FunMusic 仍邀测 → 备选 Suno/Udio 或预置 BGM 库。
- 对话 prompt 超 2500 字被截断 → builder 控长，超长拆段。

## 代码治理与文件拆分 backlog

> 来源：`qwen-max-architecture-review` #1-#13 复核。项目工程化水平高（生产代码仅 1 处 `as any`，strict mode 全开，纯规则包 + adapter 模式教科书级），这些是**可维护性技术债**而非功能/安全缺口，不阻断上线。原则：**接触相关区域时顺手拆，不专门开重构冲刺**；唯一例外是两条横切面（统一错误处理、序列化统一），收益跨全路由，可独立排期。下列行号为复核当日实测值。

**大文件拆分（接触时顺手做，参照 `modules/canvas/service.ts` barrel 拆分模式）**

| 文件 | 行数 | 拆分方向 |
|------|------|----------|
| `packages/db/src/repositories/admin.repo.ts` | 1178 | 按业务域拆 overview/tasks/users/providers/projects/gateway，barrel re-export |
| `apps/server/src/routes/canvas.ts` | 898 | 拆 projects/pipeline/phases/resources/helpers，barrel 组装 |
| `apps/server/src/routes/assets.ts` | 708 | 提取 `modules/assets/service.ts` 统一三来源查询/序列化 |
| `apps/server/src/routes/openai-gateway.ts` | 504 | 路由只留参数解析，业务/流式/记录创建下沉 service（`services/gateway-service.ts` 已存在，继续抽薄） |
| `apps/server/src/routes/generate.ts` | 472 | POST `/generate` 业务逻辑（category 限流/dedupe key/credit reserve）下沉 `modules/generation/service.ts`，route 只做 HTTP 层 |
| `apps/worker/src/task-processor.ts` | 422 | SUCCEEDED/FAILED/timeout 三分支拆 video-completion/video-failure/video-canvas-bridge/video-notifications |
| `packages/canvas-runtime/src/index.ts` | 384 | 拆 pure/（资产模板/引用解析/模型推荐）与 io/（`submitCanvasShotVideo` 直接调 `createGenerationRecord` 的 DB 写移出 runtime 包） |
| `apps/worker/src/index.ts` | 299 | 拆 lifecycle/poll-loop/poll-sources，主循环只遍历 `PollSource[]` |
| `apps/server/src/modules/generation/service.ts` | 299 | 随 generate.ts 边界清理一并理 |
| `apps/server/src/routes/notifications.ts` | 282 | 拆 route / service：`notify*` 工具函数移到 `services/notifications.ts`，消除「路由 import 另一路由导出」+ service 反向依赖 route 的倒置层级 |

**横切面（跨全路由，可独立排期，收益最高）**

- **统一错误处理中间件**（审计 #11，复核确认：`validationError/notFound/forbidden` 三 helper 共 **113 处调用 / 10 个路由**，无 `onError` 全局钩子）：引入 Elysia `onError` + 自定义错误类（`ValidationError`/`NotFoundError`/`ForbiddenError`），统一序列化，去掉手写 `set.status` 响应。
- **序列化函数统一**（审计 #12，复核确认：`serializeRecord`/`serializePipelineRun`/`serializeNotification`/`toHealthSummary` 等各自手写 Date→ISO 映射）：在 `packages/shared` 或 `packages/db` 定义统一 `serialize<T>`，或用 Drizzle 序列化插件，路由层不再手写。

**其他**

- **server/worker 可观测性去重**（审计 #4，复核确认）：`provider-health.ts` / `audit.ts` 在 server 与 worker 各一份近乎相同（`metrics.ts` 已有意分化，不算重复）。需要多实例/统一阈值时抽 `packages/observability`，server/worker 各调 `setupObservability({processName})`。
- **Worker client 单例 / 可注入**（审计 #13，复核为**部分有效**）：无共享 `WorkerContext` 属实（`task-processor`/`canvas-execution`/`canvas-*-refs`/`media-handlers` 各自 `new DashScopeClient/AssetStorage`）。但审计点名 `subtitle-processor.ts` 不实（该文件无实例化），且 `task-processor.ts` 是工厂闭包内构造一次、非每任务 new —— 该文件「重复实例化」的描述误导。真实改进点：建 `WorkerContext` 单例 + 依赖注入（与 P4-1 E2E 的 provider 注入前置为同一件事）。

**验收（通用）**：拆分后行为不变（既有测试全绿），新增的子文件单一职责，barrel 保持对外 API 不变。

## 仓库清理（低优先）

> 来源：审计 `qwen-max-architecture-review` 第八节，逐项复核。

- **`.claude/settings.local.json` 已被 git 跟踪且未在 `.gitignore`**（复核确认）：`settings.local.json` 约定为机器本地配置，应加入 `.gitignore` 并 `git rm --cached`。注意：只清 `settings.local.json` 这类本地文件，不要整目录忽略 `.claude/`（团队共享的 settings / hooks / skills 可能需要保留入库，按文件区分）。
- **`docs/bailian/`（24 个百炼/DashScope 官方文档，已入库）**（复核确认）：属外部厂商参考文档，使 `git clone` 体积膨胀。**裁量项**：阶段二开发仍频繁参考 HappyHorse/FunMusic 文档，是否移外部 wiki / 加入 `.gitignore` 由团队决定，不强制。
- **`apps/server/src/utils/crypto.ts`（1 行 re-export `hashApiKey`）**（复核确认）：可选内联，让调用方直接 import `@excuse/auth`。非必须。
- **`CLAUDE.md`（根目录）**（复核为**非问题，审计建议错误**）：审计建议删除，但 `CLAUDE.md` 是 Claude Code 的标准指令入口，内容指向 `AGENTS.md`（见 `AGENTS.md` 第 3 行声明「`CLAUDE.md` 指向本文件，两工具共用单一真相源」）。**删除会破坏 Claude Code 指令发现，保留不动。**

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

## 审计复核记录（2026-06-16）

> 三份审计文档（`qwen-max-TODO.md` / `qwen-max-architecture-review.md` / `phase-2-plan.md`）已逐条对照当前代码复核。**已确认完成 / 失效的断言未录入上文**，仅在此留痕，避免重复立项。仍有效的已按优先级录入 P0 / P1 / P3 / 代码治理 / 仓库清理；产品路线图录入「产品阶段二」。

**已完成 / 失效的审计断言（不录入 TODO）**

- 健康探针（`qwen-max-TODO` #3）：`/api/health/ready`（DB down → 503）、`/live`、`/db`、`/metrics` 已存在。闭合于 commit `9d3c0b7`（P4 health）。
- CI 口径（`qwen-max-TODO` #5 / `arch` #19）：CI 已拆为 typecheck/lint/boundaries/build/test/test-db/client-test/docker 八 job，跑根脚本全量 + build + Docker build。闭合于 commit `4f42685`（P4-1 CI）。
- 用户错误恢复 UX（`qwen-max-TODO` #7）：纯规则包 `@excuse/error-recovery` 的 `classifyRecovery` 已覆盖 balance→top_up / content→edit_prompt / network→retry / provider→wait 等全映射。闭合于 commit `c52299d`（P2-3）。
- DB 连接池配置（`arch` #14）：`packages/db/src/db.ts` 已显式设 `max`（读 `DB_MAX_CONNECTIONS`，默认 10）/ `connect_timeout` / `idle_timeout`；`prepare:false` 刻意不设（无 PgBouncer，保留 prepared statement）。已完成。
- Server 优雅退出（`arch` #16）：`apps/server/src/index.ts` 已加 SIGINT/SIGTERM + `app.stop()` + 30s 超时，与 worker 对称。已完成。
- CORS 生产配置（`arch` #17）：`localhost:8007` 已用 `NODE_ENV!=='production'` 门禁，生产仅允许 `config.frontendUrl`。已完成。
- `qwen-max-TODO` #10「无 E2E 冒烟测试」与既有 P4-1 为同一缺口，已合并，不重复立项。
- `arch` #18 中「`/api/swagger` 裸露」半句失效（实际只有 `/openapi`），`/openapi` 生产门禁已补（P1-3，commit 待填）。
- `arch` #3 `task-processor`「重复实例化 client」描述误导（该文件工厂闭包内构造一次），仅保留「无 WorkerContext」真实点（见代码治理 backlog）。
- `arch` #13 点名 `subtitle-processor.ts` 实例化 client 不实，已剔除。
- `CLAUDE.md` 删除建议（`arch` 第八节）经核实为工具集成约定，非清理项（见仓库清理）。

**审计评分留档**：架构 7.5/10、命名 9.5/10、类型安全 9/10、测试 ~68%、综合 8.5/10 —— 工程化水平在同类全栈 AI 平台中属上游，主要短板是路由层膨胀（已录入代码治理 backlog）。

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
