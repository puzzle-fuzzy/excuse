# 项目统一 TODO

更新时间：2026-06-17

本文是 `excuse` 后续产品迭代、技术治理和验收标准的唯一入口。后续 Claude / Codex 只处理本文，不再拆分处理多份清单。

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

## 一、地基（优先级最高：多单元并行 + 可测试性的基础）

> ~~多工作单元同时改动 Canvas 相关代码时频繁 git 撞车，根因有二：① 路由/运行时大文件高耦合（`canvas.ts` 898 行、`Admin.tsx` 2249 行），拆分时与功能迭代抢占同一文件；② `DashScopeClient` 在路由与 worker 各 handler 就地 `new`，无共享 context、无注入边界。本节两项一起做，能让后续产品迭代与测试在更清晰的边界上并行。~~ 项② 已完成：WorkerContext ✅ + ServerContext ✅。

### 2. 大文件拆分（接触时顺手做，参照 `modules/canvas/service.ts` barrel 拆分模式）

> 原则：**接触相关区域时顺手拆，不专门开重构冲刺**。拆分降低单文件耦合，多工作单元可并行落在不同子文件上。
>
> ✅ `apps/worker/src/index.ts` 已完成（→ lifecycle + poll-sources）。
> ✅ `apps/server/src/routes/canvas.ts` 已完成（→ canvas/ helpers + 3 handlers + barrel）。

| 文件 | 行数 | 拆分方向 |
|------|------|----------|
| ~~`apps/client/src/pages/Admin.tsx`~~ | ~~2417~~ | ✅ 拆为 `Admin/index.tsx` + `shared.tsx` + `Providers.tsx` + `Projects.tsx` + `Audit.tsx` |
| ~~`apps/worker/src/task-processor.ts`~~ | ~~414~~ | ✅ 抽离 task-processor-utils.ts |
| ~~`packages/canvas-runtime/src/index.ts`~~ | ~~411~~ | ✅ 拆 pure/（引用解析/模型推荐）+ io/（资产步骤/视频提交） |

**验收**：拆分后行为不变（既有测试全绿），新增子文件单一职责，barrel 保持对外 API 不变。

## 二、产品迭代（统一待办，不再按阶段拆分）

> 阶段一 Canvas 9 阶段流水线已成熟，下列为在其基础上的增量能力，按业务价值排序。
>
> 成本结论先行：R2V 与 T2V 同价（¥1.6/秒 1080P），升级 R2V 零成本增量；BGM + LLM 对话设计仅增加约 10% 成本。

### 1. 主体资产库（跨项目复用角色/场景）✅

> 目标：角色/场景从「项目绑定」升级为「用户级资产」，跨项目复用，减少重复生成。全部完成。

- ✅ `subject_library` + `project_subject_refs` 表（含迁移 0034）
- ✅ Repository CRUD + `searchSubjectsByName` 名称模糊搜索
- ✅ `POST/GET/PATCH/DELETE /api/subjects` + 收藏切换
- ✅ `POST /api/canvas/:projectId/subjects/import` 导入到项目
- ✅ 前端资产库页面 `/subjects`（搜索/类型筛选/收藏/删除 + Navbar 链接）
- ✅ Canvas analyze 阶段 characters/locations 自动匹配库中已有资产
- ✅ Canvas 编辑器「资产库」快捷入口（CanvasStatusBar）

### 2. 对话式音视频 + BGM + 合成 🏗️

> 利用 HappyHorse 模型原生对话/音效能力 + R2V 角色一致性。

**已完成**
- ✅ 阶段枚举 + 流水线配置 + migration SQL
- ✅ Phase 8.5 `dialogue` — 对话层 LLM 生成（完整实现：prompt builder → canvas-runtime → server handler → worker handler）
- ✅ `canvas_shots` 新增 `dialogue_prompt`/`dialogue_json`/`reference_media` 列
- ✅ `shared/domain-types` `DialogueJson` 结构化数据定义
- ✅ Phase 10 `bgm` — 骨架（server module + handler stub）
- ✅ Phase 11 `assemble` — 骨架（handler stub）

**待实现**
- 🏗️ Phase 10 `bgm`: 需 `fun-music-v1` 模型配置 + provider audio 支持
- 🏗️ Phase 11 `assemble`: FFmpeg 视频拼接 + 对话音频合成 + BGM 叠加
- 🏗️ R2V builder: `buildR2VRequest` 组装多参考图模式（依赖 dialogue 产出 reference_media）

### 附：对话音视频 Prompt 规范要点

- 结构优先级：场景建立 → 角色引入 + `[Image N]` 指代 → 动作+对话（按时间线交替）→ 运镜/视觉细节 → 环境音效。
- 明确指代说话角色（`[Image 1]中的角色说…`）、描述语气情绪、对白用中文引号、动作与对白交织、单镜头 2-3 轮对话、描述关键音效。
- R2V 参考图预算（最多 9 张）：主要角色 turnaround 2-3 张 → 次要角色 portrait 1-2 张 → 关键场景 1-2 张 → 预留 1-2 张。

### 附：对话音视频风险

- 对话音频质量不稳定 → 保留 T2V 降级 + video-edit 后期调整。
- R2V 角色跨镜头漂移 → 优先用 turnaround sheet（三视图）而非单张 portrait。
- FunMusic 仍邀测 → 备选 Suno/Udio 或预置 BGM 库。
- 对话 prompt 超 2500 字被截断 → builder 控长，超长拆段。

## 三、可观测性与测试

### 1. 端到端冒烟测试【依赖地基一、1 的 provider 注入】

> 状态：依赖前置的 provider 依赖注入重构（地基一、1），且需全栈起停编排 + 浏览器二进制，验证环境重，应单独排期。下述任务/范围/风险供排期时参考。

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

> 下列为代码冗余/死代码/命名/a11y 债务，2026-06-17 逐条核对当前代码，仅录入「仍存在」与「待确认」项（关键问题与已修复项不录入）。原则：接触相关区域时顺手做，不专门开冲刺。

- ~~**Gateway 流式/非流式计费编排重复**~~ ✅ 已由 `setupGatewayCall` / `settleGatewaySuccess` / `settleGatewayFailure` 三条共用原语覆盖，流式非流式均使用。
- ~~**Admin 手动 Dialog 绕过 Radix**~~ ✅ 已替换 `Admin/index.tsx` 中全部 5 处手动遮罩为 `<DialogContent>`。
- ~~**`CATEGORY_LABELS` 命名/值不一致**~~ ✅ 已提取 `@/lib/category-labels` 共享模块，补齐 `audio`。
- ~~**`estimateCost` 死导出**~~ ✅ 已从 `@excuse/billing` barrel 移除。
- ~~**Developers.tsx 数据源是否走 Eden 待确认**~~ ✅ `fetchGatewayUsage` 已确认走 Eden treaty（`api.v1.usage.get`）。
- ~~**SSE `connect()` 双入口待确认**~~ ✅ `SSEClient.connect()` 已有 idempotent guard（`if (this.abortController || this.isConnecting) return`），双入口无害。

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

- **`docs/bailian/`（百炼/DashScope 官方文档，已入库）**：属外部厂商参考文档，使 `git clone` 体积膨胀。**裁量项**：对话音视频开发仍频繁参考 HappyHorse/FunMusic 文档，是否移外部 wiki / 加入 `.gitignore` 由团队决定，不强制。

## 六、参考项目迁移要点

> G:\tmp\puzzle-bobble/https://github.com/puzzle-fuzzy/puzzle-bobble
`puzzle-bobble` 更适合作为工程可靠性参考：长任务状态机、可靠任务队列、Workflow run/step/task；SSE + PostgreSQL NOTIFY；预授权/结算/退款；模型目录、能力、定价、参数 schema；Worker 健康检查、锁续期、孤儿任务恢复、重试分类。

> https://github.com/puzzle-fuzzy/lumora
`lumora` 更适合作为产品平台化参考：creative / model-lab / admin / customer / gateway 多产品线边界；统一资产轮询契约（`assets` / `bindings` / `activeTasks` / `costs`）；API Gateway 的 customer / key / scope / quota / rate limit / usage / credit ledger；`TaskTypeRegistry` 为每类任务声明 billing / asset / recovery 策略。

后续不再把参考项目细节展开到本文。需要时只按当前 TODO 的具体任务去对应项目找实现参考。

## 暂缓事项（需要时重新立项）

> 多实例相关需求本轮不纳入。当前为单实例部署，待真正需要水平扩展时再处理。

- **限流 Redis 化**：`packages/rate-limit` 的 `SlidingWindowRateLimiter` 与 `plugins/auth.ts` 的 `apiKeyRateLimiter` 均为进程内 `Map`，多副本部署时实际配额 = 实例数 × maxRequests。需要多实例时迁移到 Redis + Lua（滑动窗口），保持现有接口不变（包已为替换预留接口）。
- **DB migration advisory lock**：`packages/db/src/migrate.ts` 直接 `migrate()` 无并发保护；多实例/多进程同时执行迁移会竞争 DDL。需要多实例时外包一层 `pg_advisory_xact_lock`（固定 key），或 CI 中单独运行迁移、进程启动跳过。
- **server/worker 可观测性去重**：`provider-health.ts` / `audit.ts` 在 server 与 worker 各一份近乎相同（`metrics.ts` 已有意分化，不算重复）。需要多实例/统一阈值时抽 `packages/observability`，server/worker 各调 `setupObservability({processName})`。

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
