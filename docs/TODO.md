# 项目统一 TODO

更新时间：2026-06-18

本文是 `excuse` 后续产品迭代、技术治理和验收标准的唯一入口。后续 Claude / Codex 只处理本文，不再拆分处理多份清单。

> 本文由一轮覆盖全部源码（19 package + 3 app，~84k LOC）的「设计 / UX / 架构 / 拓展性 / 文件职责 / 运行时可靠性」六维度审计产出。`docs/TODO2.md`（架构冗余/复杂化审计）已全部完成，本文**不重复**其已解决项（provider 门面、双账本、错误协议、adapter 仪式、迁移 journal、video/ASR 迁队列、claim/锁/孤儿/drain 等），只收录本轮新发现、尚未推进的事项。
>
> 严重度图例：🔴 CRITICAL（生产会炸 / 资损 / 静默正确性 bug） · 🟠 HIGH（真实缺陷 / 拓展成本高） · 🟡 MEDIUM（打磨 / 治理债） · 🟢 LOW（清理）。每项给：**证据**（`file:line`，可点击） · **影响** · **解法**（可执行） · **验收**。

## ⚠ Drizzle 迁移纪律

**正常流程：修改 TS schema → `db:generate`（自动生成 SQL + snapshot + journal 条目）→ `db:migrate`（应用到数据库）。**

- **禁止使用 `db:push`**（开发快捷命令，绕过迁移系统，直接把 schema 推到 DB）。`db:push` 不生成迁移文件，导致迁移 journal 出现缺口——新数据库 `db:migrate` 会漏掉这些变更。
- 历史教训（0034–0038 缺口）：曾有人连续 5 次 `db:push` 而未跑 `db:generate`，导致空库 `db:migrate` 缺 5 张表/列。后经手动补录 SQL + snapshot + journal 修复（commit `4a06b7ea`）。
- **今后所有 schema 变更只走 `db:generate` → `db:migrate`，迁移文件由 drizzle-kit 自动生成，不需要手动编写 SQL。**

## 使用规则

- 本文只记录仍需推进、仍需决策或仍需验收的事项。
- 已完成事项直接从本文删除，不在 TODO 中保留 commit 历史。
- 每完成一个独立待办，必须从本文删除对应待办，并把完成记录与 commit 写入根目录 `CHANGELOG.md`。
- 不再新增「项目整改总清单」等平行清单（`docs/TODO2.md` 为已归档的架构审计，不再追加）。
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
- **「镜像而不 import」是 drift 的温床**：跨层同名 enum/union/常量（DB pgEnum ↔ shared type ↔ 纯包 union）必须由单一权威源派生（codegen 或 `$type<>()`），否则必然失同步（本轮已实证 `CanvasCostPhase` / `PipelineRunStatus` 两处 drift）。
- **拓展性以「新增 X 要改几处文件」衡量**：理想是注册表/声明式（改 1-2 处），而非散弹式 if/switch（改 10+ 处）。

---

## 一、运行时可靠性（生产风险，最高优先）

> 这些是真实运行中会炸、会资损、会静默错乱的隐患。多数改动小、收益大，应优先处理。

### 1.2 🔴 text prompt 零长度限制 — 计费穿负 / DB 膨胀

- **证据**：grep `maxLength|MAX_PROMPT|truncate` 在 provider/db/shared/server 路由层零命中（仅 prompt-engine 内部自生成文本有 truncate）。[generate.ts:209](apps/server/src/routes/generate.ts#L209) body schema `parameters: t.Record(t.String(), t.Any())` 完全开放；CLAUDE.md 自承「dedupeKey（text，**无长度限制**）」。
- **影响**：用户可提交 10MB prompt：文本按 token 计费单次可达数十~数百元，`reserveCredit` 预留不足时 `actualCost > reserved`，余额穿负或 throwing 后状态不一致；`inputParams` JSONB 存全量导致表膨胀。OpenAI 网关对外（[openai-gateway.ts:245](apps/server/src/routes/openai-gateway.ts#L245)）更难追责。
- **解法**：(a) 路由参数校验层给 `prompt`/`messages[].content` 加 maxLength（text ~100k 字符、image ~8k、gateway messages 同理）；(b) billing 在 `actualCost > reserved × 1.5` 时拒绝执行并 refund（防超额扣，宁可少生成不可穿负）。
- **验收**：提交超长 prompt 返回 422 + 明确错误；提交接近 reserve 上限的请求在 actualCost 超阈值时被拒绝并退款而非穿负。

### 1.3 🔴 credit reserve 后崩溃 / 流式中断 → frozen 余额永久泄漏

- **证据**：credit reserve/debit/refund 是原子 SQL（`UPDATE ... WHERE availableCents >= N` + 幂等唯一索引，设计扎实），但 reserve → debit 之间无超时释放、无对账。gateway 流式路径若 provider 慢但不超时（见 1.1）或客户端中途断开，`reservedCents` 会一直 frozen。
- **影响**：server/worker 崩溃、流式断开、长任务中途失败但 refund 未走到，都会让用户余额被「冻死」在 reserved 状态，长期累积即资损 + 用户被锁死。
- **解法**：加一个对账 job（worker 周期任务）：扫描 `credit_transactions` 中 `type=reserve` 且超过阈值时长（如 1h）无对应 debit/refund 收尾的记录，自动 refund 并审计。
- **验收**：构造 reserve 后无收尾的 fixture，对账 job 能识别并 refund；正常 debit/refund 流程不被误伤。

### 1.4 🟠 FFmpeg 操作无超时 / 无强制 kill

- **证据**：[ffmpeg](packages/ffmpeg/src/) 的 concat/烧字幕/抽音频可能跑很久甚至卡死（坏文件、超大文件、编码死循环）。当前依赖 Bun 子进程默认行为，无显式 `timeout` + kill 兜底。
- **影响**：单条坏媒体可让 worker 卡在某 phase 直到 4h 视频超时（且只覆盖 video），临时目录泄漏，assemble 阶段尤其危险（多镜头拼接）。
- **解法**：FFmpeg 调用统一加超时（env 可配，默认如 10min）+ 超时 kill 子进程 + 失败抛可重试错误；临时目录 `finally` 清理已有，补「进程强杀时也清」。
- **验收**：构造一个会卡死的 ffmpeg 调用，确认超时后被 kill、临时目录被清、task 进入失败/重试。

### 1.5 🟠 三套状态机写入无原子性 → crash drift

- **证据**：`tasks.status`（[schema/tasks.ts](packages/db/src/schema/tasks.ts)）、`canvas_pipeline_runs.status`、`generation_records.status` 三套独立 enum。一个 canvas 阶段的「完成」由**两次分别写入**：task 经 `completeTaskWithAdapter`，run 经 `markPipelineRunSucceeded`（[canvas-handlers.ts](apps/worker/src/canvas-handlers.ts)）；失败路径 [task-handler.ts:177-196](apps/worker/src/task-handler.ts#L177-L196) 同时更新两者。**两次写之间无事务**。
- **影响**：worker 在两次写之间崩溃 → task=succeeded 但 run=running（或反之），永久漂移、不可自愈；排查需 join 多表。
- **解法**（二选一）：(a) 用单一事务/单一 adapter 原子更新 task 与 run；(b) 加 reconcile 任务定期 `WHERE task.status != run.status` 修复并告警。推荐 (b)（改动小、且能兜历史漂移）。
- **验收**：构造两次写之间崩溃的 fixture，reconcile 能修复；正常流程不误改。

### 1.6 🟠 重复提交 / retry 双扣费（dedupeKey TOCTOU）

- **证据**：[generation_records](packages/db/src/schema/generation-records.repo.ts) 按 `dedupeKey` 去重，但「查询无命中 → INSERT」非原子（TOCTOU）。retry 路径（[generate.ts](apps/server/src/routes/generate.ts) `/records/:id/retry`）不经 dedupeKey。用户连点「生成」或网络重试可能并发穿透。
- **影响**：同一请求被生成两次 → 双扣费、双产物、双 SSE。
- **解法**：dedupeKey 加唯一索引 + 捕获唯一冲突直接返回既有记录（而非 INSERT）；retry 路径加客户端幂等键（`Idempotency-Key` header）或服务端去重。
- **验收**：并发提交相同 text 请求只生成一次；retry 连点只执行一次。

### 1.7 🟠 task 锁 heartbeat 失败无防御性检查

- **证据**：[lifecycle](apps/worker/src/) 的 `extendTaskLock` 抛错时仅记日志后继续（DB 临时中断时）；执行中途不复查 `lockedBy=workerId`。长任务（assemble 可达数分钟）期间锁若静默丢失，孤儿 sweep 可能把任务重新 claim 给另一 worker → 双跑。
- **影响**：DB 抖动叠加长任务 → 两个 worker 同时执行同一 task → 双扣费、双写产物。
- **解法**：(a) 长任务（assemble/burn-subtitle/video）适当加大 `claimTtl`；(b) 在耗时的子操作之间（如 assemble 的 concat 与 mixBgmTrack 之间）复查 `SELECT ... WHERE lockedBy=workerId AND lockedUntil>now()`，不再持锁即中止；(c) heartbeat 失败重试 2-3 次（退避）而非直接吞。
- **验收**：模拟 DB 中断使锁过期，确认原 worker 在下一个 checkpoint 主动中止而非继续跑。

### 1.8 🟠 SSE 死连接回收

- **证据**：[events](packages/events/src/) 的 `UserEventHub` 已有全局 10000 + 单用户 3 上限（设计扎实），但**慢客户端/半开连接**未在心跳超时后被 server 主动移除——`pgClient.notify()` 仍向死连接 dispatch。
- **影响**：长期运行 server 内存里累积死连接，NOTIFY 往死连接推造成延迟堆积，极端 OOM。
- **解法**：SSE 连接加空闲超时（如 60s 心跳无响应即 close 并移除）；定期清理超时连接。
- **验收**：构造一个不读流的客户端连接，确认 N 秒后被 server 回收且从 hub 移除。

### 1.9 🟡 rate-limit key 可被伪造 + 限流 Map 无 GC

- **证据**：[rate-limit/index.ts:59-64](packages/rate-limit/src/index.ts#L59-L64) `buildRateLimitKey` 用 token 前 50 字符当 user key，且 rate-limit 全局中间件在 auth 之前应用。恶意客户端发不同伪造 token → 每个一个限流 bucket → 绕过单用户限流 + Map 无限增长（未被 check 命中的 key 永不清）。
- **影响**：限流绕过 + 内存增长。
- **解法**：限流 key 应在 auth 之后的 `userId` 上构建，无效 token 统一落到 IP bucket（需 trusted proxy 配置防 `x-forwarded-for` 伪造）；SlidingWindowRateLimiter 增加周期性 sweep 清理空窗口 key。
- **验收**：伪造 N 个不同 token 的并发请求被收敛到同一 IP bucket；空窗口 key 被周期清理。

---

## 二、架构设计与拓展性

### 2.1 🔴 Canvas 阶段列表 4 份手抄 + 已 drift

- **证据**：阶段序列目前存在 **4 份手抄副本**：[workflow-engine](packages/workflow-engine/src/index.ts) `CANVAS_PHASE_ORDER`、[shared/canvas.ts:141-153](packages/shared/src/canvas.ts#L141-L153) `CanvasPipelinePhase`、[shared/canvas.ts:492-501](packages/shared/src/canvas.ts#L492-L501) `CanvasCostPhase`、[db schema](packages/db/src/schema/canvas-pipeline-runs.ts) `canvasPipelinePhaseEnum`。**已实证 drift**：`CanvasCostPhase` 只有 9 阶段，缺 `dialogue`/`bgm`/`assemble`（本轮复核确认）。
- **影响**：新增一个 Canvas 阶段需散弹式改 11-15 个文件（含前端 [PipelineController.tsx:63-73](apps/client/src/components/canvas/PipelineController.tsx#L63-L73) 独立维护的 `PHASES` 数组与 `pauseBefore` 标志，不读后端 `CANVAS_PAUSE_BEFORE`）；drift 已实际发生（成本展示会漏掉后 3 阶段）。
- **解法**：阶段元数据收敛为**单一注册表**（推荐放纯包 `canvas-engine`）：每阶段一项 `{ phase, taskType, pauseBefore, costVisible, statusTransition }`，workflow-engine / db pgEnum / shared / 前端全部从该表派生（db enum 由代码生成迁移，前端从 `/api/canvas/phases` 拉取或 codegen）。先修已 drift 的 `CanvasCostPhase`。
- **验收**：新增一个测试阶段只改 1-2 处（注册表 + 实现）；`CanvasCostPhase` 含全 12 阶段；前端 `pauseBefore` 与后端 `CANVAS_PAUSE_BEFORE` 同源。

### 2.2 🔴 PipelineRunStatus 三份 union drift（幽灵 `paused`）

- **证据**：[workflow-engine:209](packages/workflow-engine/src/index.ts#L209) `PipelineRunStatus` 含 `'paused'`，但 [shared/canvas.ts:155](packages/shared/src/canvas.ts#L155) 的 `CanvasPipelineRunStatus` 与 DB `canvasPipelineRunStatusEnum` **均不含 `paused`**。`WorkflowCommand = 'pause'|'resume'`、`canCancelPipelineRun` 等基于这个含 `paused` 的 union（本轮复核确认）。
- **影响**：类型允许 `paused`，但 DB 无法持久化该值（写入会报 invalid enum）——「镜像不 import」反模式的直接代价。若 pause/resume 路径可达，是 live bug；若不可达，是误导性死代码。
- **解法**：二选一——(a) 让 db 把 status enum 导出为派生类型（codegen 或 `$type<>()`），三处 union 强制同源；(b) 删除 `paused`，把「逻辑暂停」建模为 active run + `pauseRequested` flag。修 [canvas-pipeline-runs.ts](packages/db/src/schema/canvas-pipeline-runs.ts) 注释（写「9 阶段」实为 12）。
- **验收**：三处 status union 同源；grep 确认 pause/resume 要么端到端可达、要么彻底删除，无半接线状态。

### 2.3 🟠 category 散弹式 ~20 处（新增一种 category 要碰 20 个文件）

- **证据**：`category === '...'` / `switch(category)` 命中遍布：[provider/dashscope-client.ts:905-916](packages/provider/src/dashscope-client.ts#L905-L916) switch、[generate.ts](apps/server/src/routes/generate.ts) 6+ 处、[generation/service.ts](apps/server/src/modules/generation/service.ts)、[notifications.ts:57,72](apps/server/src/services/notifications.ts#L57)（**二元 text/image 判断无 default，会静默漏新 category**）、[assets/service.ts:58-66](apps/server/src/modules/assets/service.ts#L58-L66)（`default: 'text'` 静默兜底）、client `CATEGORY_CONFIG`/`category-labels`/`ModelLab CATEGORY_ORDER`。`audio` 已是合法 `ModelCategory` 但**不在** `generationCategoryEnum` 中——DB 枚举与 provider 枚举已分裂。
- **影响**：新增 category 触碰 ~20 处，且 `notifications.ts` 二元判断会静默漏掉，`assets/service.ts` 静默 fallback 掩盖错误。
- **解法**：把 `VALID_CATEGORIES`、notifications 文案、`genCategoryToKind`、client 地图收敛为以 category 为 key 的注册表/数据表；DB enum 与 shared union 单一源派生；删除静默 fallback，未知 category 显式报错。
- **验收**：新增一个测试 category 只改注册表 1 处；未知 category 不再静默兜底。

### 2.4 🟠 task-engine 反向耦合 workflow 词汇（纯包纪律）

- **证据**：[task-engine/index.ts](packages/task-engine/src/index.ts) `getTaskPriority`（:179-193）与 `computeRetryDelay`（:351-360）用 if 链硬编码具体 type 字符串（`'generate.video'`/`'canvas.videos'`/`'subtitle.asr'`）和子串匹配 `taskType.includes('video')`。源码注释自承这是「straddle workflow-engine vocabulary」。
- **影响**：纯包 `task-engine` 本应与具体业务类型解耦，但优先级/退避里写死了业务 type——新增一个长耗时 type（如 `generate.3d`）必须改 task-engine；`includes('video')` 子串匹配是隐性耦合。
- **解法**：把优先级/退避表抽成**注入的策略对象**（与现有 `*Adapter` 纪律一致），由 app/worker 注入；或声明式 `TASK_TYPE_POLICY: Record<type, {priority, backoff}>` 数据表。
- **验收**：task-engine 不再含任何具体业务 type 字符串；新增 type 只在 app/worker 注入策略。

### 2.5 🟠 配置硬编码：退避 / 优先级 / 限流 / 错误分类双轨

- **证据**：(1) task-engine 退避/优先级见 2.4 的魔数 if 链；(2) [rate-limit/index.ts:46-51](packages/rate-limit/src/index.ts#L46-L51) 全路由共享单一 `DEFAULT_GLOBAL_RATE_LIMIT`，无 per-route 声明式表；(3) 错误分类**两套形状**：task-engine 是 if 链 + inline 字符串比较，[error-recovery/index.ts:112-159](packages/error-recovery/src/index.ts#L112-L159) 是声明式 `Array<{match, domain}>` 表——新增可重试错误码要在两处分别改。
- **影响**：调参需改代码发版；新增限流规则/错误码易漏改其中一套。
- **解法**：统一为「声明式规则 + 纯函数 apply」形状（error-recovery 已是范本）：退避/优先级/限流/错误分类全部表式化；限流支持 per-route 声明。
- **验收**：调参只改数据表/配置不改逻辑；错误分类单一来源。

---

## 三、前端设计 / 美观度

> 当前前端是**未经改动的 shadcn 默认值**——功能完备但视觉上与无数 AI SaaS 雷同，缺品牌识别。多为感知层，但「给产品上色」是单文件最高杠杆改动。

### 3.1 🔴 零品牌身份 — 整个 token 系统是去色灰度

- **证据**：[index.css:51-118](apps/client/src/index.css#L51-L118) 每个颜色 token 都是 `oklch(x 0 0)`（色度 0 = 纯灰），`--primary`/`--accent`/`chart-1..5` 全灰度。无品牌强调色、无渐变。
- **影响**：产品看起来像通用 AI demo，「让想象力拥有生产力」的定位在视觉上不可见，无记忆点。
- **解法**：选 2-3 个品牌强调色（可与 category 色呼应：文本/图像/视频各一），接入非零色度的 oklch；定义 `--gradient-brand` token 用于登录页与「生成」CTA。**单文件改动，改变整体观感。**
- **验收**：primary/accent 不再是纯灰；CTA 与登录页有品牌渐变。

### 3.2 🔴 深色模式是「僵尸功能」——定义了但无法开启

- **证据**：[index.css:86-118](apps/client/src/index.css#L86-L118) 定义 `.dark` 变量，但全局 grep 无 dark 切换、无 `next-themes`、无添加 `.dark` 类的逻辑；[sonner.tsx:8](apps/client/src/components/ui/sonner.tsx#L8) Toast 硬编码 `theme="light"`；组件里 `dark:` 前缀永远不激活。
- **影响**：~35 行 CSS + 组件 dark 变体是死代码；创意工具无深色模式是明显缺失。
- **解法**：二选一——(a) 实装（`next-themes` + Navbar 切换 + Toast `theme="system"`）；(b) 删除 `.dark` 块停止误导。推荐 (a)。
- **验收**：要么深色模式端到端可用并切换 Toast 主题，要么 `.dark` 相关代码全部移除。

### 3.3 🟠 152 处硬编码 Tailwind 颜色 + 4 份重复状态色 map

- **证据**：grep 硬编码调色板 152 处 / 17 文件。状态色 map 有 **4 份副本**：[generation-utils.ts:26-34](apps/client/src/lib/generation-utils.ts#L26-L34) `STATUS_CONFIG`、[Canvas.tsx:27-41](apps/client/src/pages/Canvas.tsx#L27-L41) `STATUS_COLORS`、[CanvasStatusBar.tsx:22-36](apps/client/src/components/canvas/CanvasStatusBar.tsx#L22-L36) 第三份、[ShotNode.tsx:8-14](apps/client/src/components/canvas/nodes/ShotNode.tsx#L8-L14) 第四份；[Billing.tsx](apps/client/src/pages/Billing.tsx) 另有 `CATEGORY_COLORS`/`TX_TYPE_COLORS`。
- **影响**：(a) 无单一颜色源；(b) 这些 `bg-*-100 text-*-700` 在深色模式下不可读（3.2 实装后会暴露）；(c) 「失败」在多处是红、Toast 里却是橙，不一致。
- **解法**：建单一 `lib/status-tokens.ts`（基于 token 的类名 map，CSS 加 `--warning` 等），用 `<Badge variant="warning">` 替换内联 `rounded-full ${color}`；删 4 份重复 map。
- **验收**：状态色单一来源；`grep "bg-(red|green|yellow|blue)-[0-9]"` 在业务组件归零（仅 token 文件保留）。

### 3.4 🟡 排版 / 按钮尺寸 / 触摸目标

- **证据**：[button.tsx:24](apps/client/src/components/ui/button.tsx#L24) `default` 高 `h-8`(32px)、`lg` `h-9`(36px)；核心「生成」CTA（[Workspace.tsx](apps/client/src/pages/Workspace.tsx)）`size="lg"` 仅 36px；页面标题散落 `text-lg`/`text-sm` 无统一层级。
- **影响**：UI 局促、核心操作不显眼；按钮 <44px 在移动端难点击。
- **解法**：主操作按钮提到 `h-10`/`h-11`；定义标题工具类（`text-title-lg`/`text-title`/`text-body`）统一层级；触摸目标 ≥44px。
- **验收**：核心 CTA ≥40px；标题层级有统一 token；窄屏按钮可点。

---

## 四、用户体验 (UX) / 可访问性

### 4.1 🔴 regenerate 静默丢弃参考图（正确性 bug）

- **证据**：[workspace.ts:258-263](apps/client/src/stores/workspace.ts#L258-L263) `regenerate()` 调 `generate()` 只传 `model` + `parameters`，**不传 `referenceFileIds`**（对比 `submit()` 会传）。本轮复核确认。
- **影响**：用户用参考图生成失败后点「重新生成」，结果静默用不同输入（无参考图）→ 得到不同输出，用户无法理解。**这是静默正确性缺陷，非外观问题。**
- **解法**：把 `record.referenceFileIds`（或从 `record.inputParams` 推导）传入 regenerate 调用；补测试。
- **验收**：带参考图的失败记录 regenerate 后请求体含相同 referenceFileIds；单测覆盖。

### 4.2 🟠 加载态全是「菊花」/纯文本，零骨架屏

- **证据**：grep `Skeleton` **零文件**。所有页面二选一：居中「加载中...」（[Canvas.tsx:131](apps/client/src/pages/Canvas.tsx#L131)、[Billing.tsx:86](apps/client/src/pages/Billing.tsx#L86)、[CanvasEditor.tsx:122](apps/client/src/components/canvas/CanvasEditor.tsx#L122)）或内联 `<Loader2 animate-spin>`。路由切换 [App.tsx:25-31](apps/client/src/App.tsx#L25-L31) 是全屏「页面加载中...」。
- **影响**：慢网下页面闪烁空白再弹出内容，列表布局抖动，廉价感。
- **解法**：为 3 个主列表（RecordCard、Canvas 项目、Billing 卡片）加 `Skeleton`；裸「加载中...」换骨架屏。
- **验收**：列表加载显示骨架而非空白文字。

### 4.3 🟠 空状态无引导、无 CTA

- **证据**：[Workspace.tsx:361-364](apps/client/src/pages/Workspace.tsx#L361-L364) 仅图标 + 「暂无生成记录」；[Billing.tsx:202,238,275](apps/client/src/pages/Billing.tsx#L202) 「暂无数据」重复三次；[Navbar.tsx:184](apps/client/src/components/Navbar.tsx#L184) 「暂无通知」。
- **影响**：首次用户到达空状态是死胡同，没有继续路径。
- **解法**：抽共享 `EmptyState`（图标 + 标题 + 可选 CTA slot）；Workspace 空状态指向左侧表单（「← 输入 Prompt 开始生成」）。
- **验收**：核心空状态有明确下一步动作。

### 4.4 🟠 流水线 UI 只显示 9/12 阶段 + 无耗时提示

- **证据**：[PipelineController.tsx:63-73](apps/client/src/components/canvas/PipelineController.tsx#L63-L73) `PHASES` 数组只有 9 项，后端 `CANVAS_PHASE_ORDER` 已是 12 阶段（含 dialogue/bgm/assemble）；无 ETA / 典型耗时提示；auto 模式失败时仅 toast，后台标签页用户不知流水线已停。
- **影响**：videos 之后用户看不到在发生什么；不知道一个阶段要等多久；静默中断。
- **解法**：(a) 前端 `PHASES` 与后端 12 阶段同源（见 2.1 注册表）；(b) 加每阶段历史平均耗时提示；(c) auto 失败在状态栏留持久红色徽章而非仅 toast。
- **验收**：流水线 UI 显示全 12 阶段；各阶段有耗时范围提示；失败有持久视觉中断。

### 4.5 🟠 上传失败静默吞 + 无草稿/未保存警告

- **证据**：[workspace.ts:286-328](apps/client/src/stores/workspace.ts#L286-L328) `uploadReferenceFiles`/`uploadMediaParam` 失败只翻 `uploadingRefs` 无 toast；Canvas 创建故事 textarea（[Canvas.tsx:150-156](apps/client/src/pages/Canvas.tsx#L150-L156)）与 Workspace prompt 无持久化、无 `beforeunload`。
- **影响**：参考图上传静默失败 → 下次生成在降级输入上跑；用户粘 2000 字故事误点导航 → 全丢。
- **解法**：(a) 两处上传路径加 `toast.error`；(b) Canvas 创建故事 + Workspace prompt 持久化到 sessionStorage（按路由 key）；未保存的长输入加 `beforeunload`。
- **验收**：上传失败有提示；长输入跨刷新/导航不丢。

### 4.6 🟡 Toast 位置 / 导航栏拥挤 / 表单校验 / 快捷键 / a11y（一组打磨项）

> 接触相关区域时顺手做，不专门开冲刺。

- **Toast 刷屏风险**：[App.tsx:57](apps/client/src/App.tsx#L57) `top-center richColors` 遮挡状态栏/标题，级联失败时多个 toast 叠加。→ 移 `bottom-right`，批量操作合并为单 toast。
- **导航栏 10 项拥挤**：[Navbar.tsx:37-48](apps/client/src/components/Navbar.tsx#L37-L48) 10 个 `NAV_ITEMS` 单行内联，无响应式/溢出菜单/汉堡，「资产」与「资产库」近义混淆。→ 主导航（工作台/画布/加字幕）+ 「更多 ▾」次级；窄屏折叠汉堡；重命名区分。
- **表单校验**：[Login.tsx:19-22](apps/client/src/pages/Login.tsx#L19-L22) react-hook-form 无 `mode:'onBlur'`，错误只在提交后整块显示，无字段级提示；Workspace 必填项禁用按钮但无「为何禁用」提示。→ `mode:'onBlur'` + 字段下提示 + 禁用原因 title。
- **无快捷键 / 批量 / 撤销**：无全局 keymap（Cmd/Ctrl+Enter 生成）、记录无多选批量删、[NodeDetailPanel.tsx:38-52](apps/client/src/components/canvas/NodeDetailPanel.tsx#L38-L52) shot prompt 编辑即时 PATCH 无撤销。→ 绑定 Cmd/Ctrl+Enter；记录多选；节点编辑加防抖 + 保存指示 + 本地撤销栈。
- **a11y**：图标按钮（通知/删除/复制/关闭）缺 `aria-label`，动态状态无 `aria-live`，自定义 `<button>`（阶段按钮等）无 `focus-visible` 样式。→ 仅图标按钮补 `aria-label`，动态状态包 `aria-live="polite"`，自定义按钮加 focus ring。
- **验收**：Toast 不遮挡核心内容；窄屏导航可用；表单字段级报错；核心操作有快捷键；图标按钮屏幕阅读器可读。

---

## 五、文件单一职责 / 大文件拆分（接触时顺手做）

> 原则同 CLAUDE.md：**接触相关区域时顺手拆，不专门开冲刺**。下列是当前**仍存在**的过大/职责混乱文件（canvas.ts/Admin.tsx/task-processor.ts 等已拆的不列）。

### 5.1 🟠 generate.ts 生成编排去重（隐式 bug 源，最高 ROI）

- **证据**：[generate.ts](apps/server/src/routes/generate.ts) POST `/generate`（:81-218）与 POST `/records/:id/retry`（:306-429）有 ~110 行 validate→reference→cost→prepare→execute→createTask 几乎逐行复制。
- **影响**：任何生成流程/credit/audit 改动需双改两处，是隐式 bug 源。
- **解法**：抽 `modules/generation/orchestration.ts` 共享编排。
- **验收**：两路径共享同一编排函数；既有 retry/cancel 测试全绿。

### 5.2 🟠 dashscope-client.ts（918 行）拆四模块

- **证据**：[dashscope-client.ts](packages/provider/src/dashscope-client.ts) 全局 hook 注册表 + 纯请求构造器（applyMappings/buildRequestBody）+ SSE 解析器 + Client 类四职责混一处；5 个 fetch 方法各重复 ~30 行 guard/build/observe 骨架；两 SSE 解析器 80% 重叠。
- **影响**：最大文件、跨 server/worker 多人协作点；SSE 解析器无法脱离 client 单测。
- **解法**：抽 `provider-hooks.ts`（observer/guard registry）、`dashscope-request-builder.ts`（纯函数）、`dashscope-sse.ts`（`iterSSEEvents` + 两解析器）；Client 内抽私有 `invokeEndpoint(model, body)` 压缩重复。
- **验收**：Client 收缩至 ~400 行；SSE 解析器可独立单测；既有 provider 测试全绿。

### 5.3 🟠 admin.ts（707 行）路由按子域拆

- **证据**：[admin.ts](apps/server/src/routes/admin.ts) 单文件 17+ 路由跨 6+ 子域（tasks/users/providers/projects/audit/api-keys），且 17 个 handler 内手写 `if (!adminAllowed) return adminDenied()`，`/overview` 还重复了 `canAccessAdmin` 检查。
- **影响**：多人并行改 admin 必撞车；手写守卫重复。
- **解法**：按域拆 `routes/admin/{tasks,users,providers,projects,audit,api-keys,gateway,credit}.ts` + `_shared.ts` 收 helper；auth 守卫下沉到 plugin，handler 直接信任 derive 结果。
- **验收**：admin 路由按域分文件；手写守卫归零；admin 测试全绿。

### 5.4 🟡 其余大组件拆分（接触时）

| 文件 | 行数 | 拆分方向 |
|---|---|---|
| [Assets.tsx](apps/client/src/pages/Assets.tsx) | 1133 | URL 同步 + 卡片网格 + 标签管理 + 详情/删除对话框 → `AssetsGrid`/`AssetTagManager`/`AssetDetailDialog`/`AssetDeleteDialog` |
| [ModelLab.tsx](apps/client/src/pages/ModelLab.tsx) | 919 | 表单 + 参考上传 + 多模型对比 + Canvas 默认值 + 6 面板 → 拆子组件 + 公共 `ParameterInput` |
| [NodeDetailPanel.tsx](apps/client/src/components/canvas/NodeDetailPanel.tsx) | 565 | shot/character/location/project 四面板揉在一起 → 路由 + `{Shot,Character,Location,Project}DetailPanel` |
| [admin-dialogs.tsx](apps/client/src/pages/admin-dialogs.tsx) | 604 | 5 个无关组件塞「dialogs」名下（含表格/状态卡）→ 按 `dialogs/` vs `components/` 正名拆 |
| [lib/asset-library.ts](apps/client/src/lib/asset-library.ts) | 602 | Canvas deep-link（与资产无关）+ shot-reference helpers 混进 → `lib/canvas-deep-link.ts`/`lib/shot-reference-assets.ts` |
| [PipelineController.tsx](apps/client/src/components/canvas/PipelineController.tsx) | 753 | 恢复 + auto + trigger 逻辑与渲染同处 → 抽 `usePipelineController` hook + 阶段子组件 |
| [gateway/index.ts](packages/gateway/src/index.ts) | 469 | 错误工厂 + 协议映射 + usage 聚合 → `errors.ts`/`protocol.ts`/`usage.ts` |

**不应误拆（大但合理）**：`client.ts`（Eden 薄封装）、`domain-types.ts`/`shared/canvas.ts`/`shared/admin.ts`（纯类型契约）、`model-configs.ts`（声明式目录）、`generation-records.repo.ts`（单表 repo）、`modules/assets/service.ts`（单一职责 query+map）、`Developers.tsx`（文档页）。这些是「内容多」非「关注点混」，保持现状。

**验收（通用）**：拆分后行为不变（既有测试全绿），新增子文件单一职责，barrel 对外 API 不变。

### 5.5 🟡 跨文件重复抽取（接触时）

- **Admin 列表分页模板**：[Admin/ApiKeys.tsx:451-576](apps/client/src/pages/Admin/ApiKeys.tsx#L451-L576) 与 [Admin/Users.tsx:336-473](apps/client/src/pages/Admin/Users.tsx#L336-L473) 逐字复制（debounce + queryParams + refetchInterval 30s + footer + prev/next）。→ 抽 `useAdminListPagination` + `AdminListCard`。
- **API key 表格**：`AdminGatewayKeysTable`（ApiKeys）与 `AdminUserApiKeysSection`（Users）渲染同列。→ 抽 `ApiKeyTable.tsx`。
- **参数输入渲染**：[Workspace.tsx:128-197](apps/client/src/pages/Workspace.tsx#L128-L197) `renderParamInput` 与 [ModelLab.tsx:389-488](apps/client/src/pages/ModelLab.tsx#L389-L488) `renderParam` 对同一 `ModelParameter` 重复实现。→ 抽 `ParameterInput.tsx`。
- **参考图多上传 UI**：Workspace 与 ModelLab 重复虚线框 + 缩略图网格。→ 抽 `ReferenceImageUploader.tsx`。
- **状态集合枚举散落**：`IN_PROGRESS_STATUSES`/`ACTIVE_GENERATION_STATUSES`/`REQUEUEABLE_STATUSES`/`GEN_RUNNING_STATUSES` 在 generation/service、generation-records.repo、admin/tasks、assets/service 各自定义、成员重叠。→ 单一 `@excuse/shared` status-set 模块。
- **验收**：重复收敛为单一来源，导出项均有生产消费者。

---

## 六、可观测性

### 6.1 🟠 traceId 不贯穿统一队列 / Canvas 流水线

- **证据**：`tasks` 表与 `canvas_pipeline_runs` 表**均无 `traceId` 列**；worker 日志（task-handler/pipeline-stepper/poll-sources/canvas-handlers）只带 taskId/projectId/部分 runId，**无 traceId**。仅 generation_records 链路（generate-video-handler/media-handlers）透传 traceId。CLAUDE.md 称「traceId 跨服务关联」——对 records 成立，对统一队列/Canvas 不成立。
- **影响**：排查 Canvas 流水线问题无法用单一 traceId 串起 server 提交 → task 排队 → worker 执行 → run 状态 → SSE，必须手工 join 多表。
- **解法**：`tasks` 表加 `traceId`（task 创建时从 server 透传）；worker logger 在 task scope bind `{taskId, runId, projectId, traceId}`；SSE 事件载荷带 task 的 traceId。
- **验收**：一次 Canvas 流水线全过程可用单一 traceId 在 server/worker/DB/SSE 日志中检索到。

### 6.2 🟡 错误日志 / SSE 可能含 prompt 全文

- **证据**：[dashscope-client.ts](packages/provider/src/dashscope-client.ts) `parseDashScopeError(data)` 进 errorMessage → 进 DB errorMessage → 推 SSE 给前端；[error-recovery/index.ts:270](packages/error-recovery/src/index.ts#L270) 有 `truncate(detail, 500)` 但只在 recovery 分类层。
- **影响**：DashScope 错误响应可能 echo 请求 prompt 片段 → 敏感内容泄露到前端/日志。
- **解法**：errorMessage 入库/入 SSE 前统一截断 + 脱敏（在 DB 写入或 SSE 分发边界层）。
- **验收**：DB/SSE 中的 errorMessage 长度有界且不含原始 prompt 全文。

---

## 七、暂缓事项（需路线图 / 显式设计假设）

> 这些不是缺陷，而是「当前设计假设未预留」。需相应路线图触发时再立项；本轮仅显式标注，避免误判为漏做。

- **多租户 / 团队 / 工作空间**：当前是**架构级单租户**——`accounts` 无 `organizationId`/`workspaceId`，积分账本 `unique per user` 强约束（无法共享余额），行级隔离逐查询手抄 `eq(accountId)` 无 RLS。全仓 grep `team|organization|tenant` 零业务命中。转团队模式是 schema + 15+ repo 签名 + auth + 积分语义的横切重构，非增量。**触发条件**：确定要做团队/企业版时立项；在此之前显式标注「单租户设计假设」。
- **i18n 国际化**：零预留——无 react-intl/i18next，中文 CJK 全仓 ~14.5k 处 / 250 文件，含 throw 的错误消息（`app-errors.ts` 20 处中文）。**触发条件**：确定出海时立项；短期至少把 throw 的中文换成 error code + 边界层格式化。
- **限流 Redis 化**：见原 §暂缓，单实例下进程内 Map 够用，多副本时迁 Redis + Lua（接口已预留）。
- **DB migration advisory lock**：单实例下 `migrate()` 无并发保护够用，多实例时外包 `pg_advisory_xact_lock`。

---

## 参考项目迁移要点

> G:\tmp\puzzle-bobble/https://github.com/puzzle-fuzzy/puzzle-bobble
`puzzle-bobble` 更适合作为工程可靠性参考：长任务状态机、可靠任务队列、Workflow run/step/task；SSE + PostgreSQL NOTIFY；预授权/结算/退款；模型目录、能力、定价、参数 schema；Worker 健康检查、锁续期、孤儿任务恢复、重试分类。**本轮 §一（运行时可靠性）的 credit 对账、超时、状态机原子化可重点参考其 run/step/task 与预授权结算。**

> https://github.com/puzzle-fuzzy/lumora
`lumora` 更适合作为产品平台化参考：creative / model-lab / admin / customer / gateway 多产品线边界；统一资产轮询契约（`assets` / `bindings` / `activeTasks` / `costs`）；API Gateway 的 customer / key / scope / quota / rate limit / usage / credit ledger；`TaskTypeRegistry` 为每类任务声明 billing / asset / recovery 策略。**本轮 §二（拓展性）的 category/阶段/task 注册表化可参考其 `TaskTypeRegistry`。**

后续不再把参考项目细节展开到本文。需要时只按当前 TODO 的具体任务去对应项目找实现参考。

---

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

---

## 本轮总览（截至 2026-06-18）

本轮六维度审计新发现 **运行时 🔴×3 / 架构 🔴×2 / 前端 🔴×2 / UX 🔴×1** 等共约 40 项，按 ROI 建议推进顺序：

1. **P0（立刻，生产风险）**：§1.1 fetch 超时 · §1.2 prompt 长度限制 · §1.3 credit 对账 · §4.1 regenerate 修复。
2. **P1（短期，drift / 体验）**：§2.1 阶段注册表 · §2.2 status union 同源 · §3.1 品牌上色 · §3.2 深色模式 · §4.2 骨架屏 · §4.4 流水线 12 阶段 · §5.1 generate 去重 · §6.1 traceId 贯穿。
3. **P2（治理 / 打磨）**：§2.3-2.5 拓展性注册表化 · §3.3 状态色收敛 · §4.3/4.5/4.6 空状态/上传/Toast/导航/a11y · §5.2-5.5 文件拆分与去重。
4. **暂缓**：§7 多租户 / i18n / Redis 限流（待路线图）。
