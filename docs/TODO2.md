# 架构合理性审计 · 整改待办（TODO2）

更新时间：2026-06-18
来源：对全部源码（19 package + 3 app，~52k LOC）的逐文件架构审计。所有结论均经 grep / 读码复核，关键「critical」项已二次验证。
与 `docs/TODO.md` 的关系：本文聚焦**架构层面的冗余 / 破坏 / 过度复杂化**，是 TODO 的补充治理清单。治理规则同 TODO.md（完成即删 + 写 CHANGELOG，一待办一 commit）。

## 使用说明

- 严重度图例：🔴 CRITICAL（会炸 / 阻塞部署） · 🟠 HIGH（真实 bug） · 🟡 MEDIUM（冗余 / 复杂化 / 治理债） · 🟢 LOW（清理）。
- 每项给：**证据**（file:LINE）、**影响**、**解法**（可执行步骤）、**验收**。
- 行内文件引用均可点击跳转。
- 总评见文末「§七 子系统记分卡」与「§八 优先级总表」。

---

## §一、中心病根：统一任务队列是「没做完的半成品」

> `tasks` 表 + `task-engine` + `workflow-engine` 这套统一队列**设计是对的**，但只接管了 14 个 task type（12 个 canvas 阶段 + 2 个 media）。**最贵、最易失败的 `category='video'` 整条线永远停在旧的 `generation_records` 轮询上**。下列 5 个问题同根同源，要么一起迁完，要么一起显式声明带外处理——现状是「沉默的矛盾」，不能继续。

### 1.1 🔴 `generate.video` 是个「幽灵 type」——生产路径从不产生它

- **证据**：[generate.ts](apps/server/src/routes/generate.ts) 提交视频时**从不调用 `createTask`**（grep `createTask` 在 `modules/generation/` 与 `routes/generate.ts` 为 **0**）。`generate.video` 只活在 3 处：[task-engine computeRetryDelay 分支](packages/task-engine/src/index.ts#L387)、[tasks.ts docstring 举例](packages/db/src/schema/tasks.ts#L53)、测试 fixture。CLAUDE.md 把它写成队列公民，实际运行时不存在。
- **影响**：文档与代码矛盾；新贡献者会以为视频走统一队列（带重试/退避/孤儿回收），实则不然——直接连到下面 1.2/1.3 的安全缺口。
- **解法（二选一，必须在 §一 整体决策时定）**：
  - **A. 迁移**：让 `/api/generate`（`category==='video'`）写一条 `generate.video` 的 `tasks` 行，DashScope 轮询改走统一队列的 retry/heartbeat/orphan-sweep 信封；删除 `pollPendingVideoTasks` 与 `createVideoPollSource`。
  - **B. 显式带外**：在 CLAUDE.md 声明 video 故意走 `generation_records` 旧路径；删除 [task-engine](packages/task-engine/src/index.ts#L387) 的 `generate.video` 分支与 [tasks.ts](packages/db/src/schema/tasks.ts#L53) 的误导性 docstring，让测试不再为一个不存在的 type 断言。
- **验收**：代码与 CLAUDE.md 对「视频走哪条队列」的描述一致；`grep generate.video` 仅剩真实使用点。

### 1.2 🔴 旧的视频 / ASR 轮询**没有任何 claim / 锁 / 重试 / 孤儿回收**

- **证据**：[pollPendingVideoTasks](packages/db/src/repositories/generation-records.repo.ts#L185) 与 `pollPendingASRProjects` 是裸 `SELECT … WHERE status IN (…) LIMIT 50`——**无 `FOR UPDATE SKIP LOCKED`、无 `lockedBy`、无 orphan sweep**（grep 验证为 0）。统一队列的 `claimNextTask` / `extendTaskLock` / `sweepOrphanTasks` 完全不覆盖它们。
- **影响**：**一旦部署第二个 worker 副本**（`docs/部署指南.md` / TODO 已规划多实例），两副本会捞到同一行 → 重复调 DashScope → 抢着 `debitCredit` / 改资产，且崩溃中途无回滚。这是埋好的正确性雷。
- **解法**：随 §一 整体决策——
  - 若走 **1.1-A 迁移**：video/ASR 各成为一个 task type，自动继承锁/重试/孤儿回收，本项自然消除。
  - 若走 **1.1-B 带外**：把 `claimNextTask` 的 `FOR UPDATE SKIP LOCKED` + `lockedBy` + orphan sweep 三件套回填到 `generation_records` 与 `subtitle_projects`（新增 `locked_by` / `locked_until` 列 + 迁移）。
- **验收**：本地起两个 worker 进程，提交一个视频任务，确认只有一个副本真正调 DashScope；kill 一个副本中途，另一副本/孤儿回收能续跑。

### 1.3 🔴 优雅关停只 drain 视频任务，不 drain 统一任务

- **证据**：[currentTaskPromiseRef](apps/worker/src/worker-lifecycle.ts#L64) 只在 [poll-sources.ts:100](apps/worker/src/poll-sources.ts#L100) 的**视频轮询**里赋值（注释原话：「主循环在跑**视频任务**时设置其 value」）。统一队列最长的 `canvas.assemble`（FFmpeg 合成，动辄数分钟）收到 SIGTERM 直接被 `process.exit(0)` 砍掉，task 卡在 `running`、锁被带飞，只能等 5 分钟孤儿回收。
- **影响**：**最长的活反而最不安全**。滚动发布 / 缩容时 assemble 任务频繁被打断重跑，浪费已合成的中间产物与计费。
- **解法**：让 `createTaskPollSource`（[poll-sources.ts](apps/worker/src/poll-sources.ts)）也把 in-flight promise 写入 `currentTaskPromiseRef`（或重构为统一的 `inFlight: Promise[]` 列表，关停时全部 await）。让 `setupGracefulShutdown` drain 所有 poll source，不只视频。
- **验收**：跑一个 `canvas.assemble` 任务，中途 `kill -TERM` worker，确认进程等到任务完成（或 30s 超时）才退出，task 不卡 `running`。

### 1.4 🟠 错误处理裂成三套方言

- **证据**：统一队列走 `task-engine`（`classifyTaskError` → retry/fail → 指数退避）；视频 [task-processor.ts](apps/worker/src/task-processor.ts) 的 FAILED 分支直接退费 + 永久失败（**无重试**）；ASR [subtitle-processor.ts](apps/worker/src/subtitle-processor.ts) 同样手搓。同一个 DashScope 限流：落 canvas 阶段会重试，落视频上直接退费给用户。
- **影响**：对**最贵的品类（视频）反而最不友好**；三套重试语义，维护成本高。
- **解法**：随 §一 决策——迁移则自动统一；带外则把 `classifyTaskError` 的决策回填到 video/ASR 的 FAILED 分支（区分 retriable vs permanent）。
- **验收**：构造一次 DashScope Throttling，确认 video 与 canvas 阶段**行为一致**（都按 backoff 重试）。

### 1.5 🟡 CLAUDE.md「4 个 workload」已过时

- **证据**：CLAUDE.md「Worker Structure」列 4 个 workload 含 `pollExportingProjects → processExportTask`；实际 [index.ts](apps/worker/src/index.ts) 只有 3 个 poll source，字幕导出已迁到 `media.burn-subtitle` task；`pollExportingProjects`（[subtitle-projects.repo.ts:116](packages/db/src/repositories/subtitle-projects.repo.ts#L116)）与 `processExportTask` 均为**死代码**（零调用方）。
- **解法**：CLAUDE.md 改为 3 个 workload，注明字幕导出已是 `media.burn-subtitle` task；删除死函数 `pollExportingProjects`。
- **验收**：`grep pollExportingProjects` 仅剩删除记录；CLAUDE.md 与 index.ts 一致。

> **§一 决策点（需用户拍板）**：video/ASR 是迁进统一队列（推荐，一次性消灭 1.1/1.2/1.3/1.4 四个问题）还是显式带外保留？这决定后续 4 项的解法走向。

---

## §二、其它 CRITICAL / HIGH

### 2.1 🔴 Drizzle 迁移 journal 缺 5 个（0034–0038） — ✅ 已修复

> **已完成**（2026-06-18）：补齐 journal 条目 0034–0038（含手写 SQL 文件登记）+ 生成最终 snapshot（0037/0038）。额外发现 `password_reset_tokens` 表从未有迁移，新增 0038。从空库 `db:migrate` 可拉起完整 27 表 schema。

### 2.2 🟠 `canvas.dialogue/bgm/assemble` 绕过了共享的 run 状态机 — ✅ 已修复

> **已完成**（2026-06-18）：3 个内联 handler 挪入 `canvas-handlers.ts` 走 `markRunRunningAndNotify → execute* → markRunSucceededAndNotify` 信封，新增 `canvas-dialogue.ts`/`canvas-bgm.ts`/`canvas-assemble.ts` 三个 execute 文件。task-handler.ts 改为懒加载委派。

### 2.3 🟠 server 域模块里 52 处裸 `throw new Error`

- **证据**：grep `throw new Error` 在 `modules/` + `routes/` + `services/` 恰好 **52** 处（[modules/canvas/*](apps/server/src/modules/canvas/)、[modules/generation/service.ts](apps/server/src/modules/generation/service.ts)、[openai-gateway.ts](apps/server/src/routes/openai-gateway.ts) 等）。`errorHandlerPlugin` 只特殊处理 `AppError`，其余一律扁平化成 500。
- **影响**：「项目不存在」「镜头不存在」「只能重试失败的镜头」这种语义上 404/403/422 的业务错误，在**同步路径**上变成不透明的 500。`fireAndForget` 路径被 `.catch` 吞了无感，但同步路径（service-crud 详情、regenerate 校验、generation/service、openai-gateway 的 `throw new Error(res.error)`）是**真 API 正确性 bug**。
- **解法**：把域模块里的 `throw new Error(msg)` 换成 [app-errors.ts](apps/server/src/utils/app-errors.ts) 的 `NotFoundError` / `ForbiddenError` / `ValidationError` 等子类。优先同步路径。
- **验收**：请求一个不存在的 projectId，HTTP 状态为 404 而非 500；`grep "throw new Error" apps/server/src/{modules,routes,services}` 数量趋近 0（fireAndForget 内部的可保留或转 AppError）。

### 2.4 🟠 `generate.ts` 是个厚路由（441 LOC）

- **证据**：[generate.ts](apps/server/src/routes/generate.ts) 的 POST `/generate` 在 handler 里**直接** `createGenerationRecord` + `calculateCost` + credit reserve + provider validate（`@excuse/db` 被 19 个路由文件 import，但只有 generate 把这套编排留在路由层）。对比 Canvas：`routes/canvas/handlers-*.ts` 纯接线、逻辑全在 module。retry 路径（L295–407）还把校验重写了一遍。
- **影响**：全 server 最大的分层泄漏；违反 CLAUDE.md「route→service→repo」；retry 与 submit 校验重复，漂移风险高。
- **解法**：把 record-create + cost-estimate + credit-reserve 编排块（L142–173 及 retry 等价块 L353–377）下沉到 [modules/generation/service.ts](apps/server/src/modules/generation/service.ts) 的 `prepareGeneration` / `executeGeneration`；retry 复用同一 module 函数。路由只留参数校验 + 委托。
- **验收**：`generate.ts` 不再直接调 `createGenerationRecord`/`calculateCost`/`reserveCredit`；retry 与 submit 走同一 service 函数；既有测试全绿。

### 2.5 🟠 ASR 轮询无超时 + 静默吞错

- **证据**：[subtitle-processor.ts:128-137](apps/worker/src/subtitle-processor.ts#L128) 的 PENDING/RUNNING 只 log 后返回，**无 `staleTimeoutMs`**（视频有 4h 上限，ASR 无）；[poll-sources.ts:149](apps/worker/src/poll-sources.ts#L149) 的 catch 只 log，瞬时 fetch 失败让 project 永久滞留无重试。
- **影响**：DashScope ASR 卡 PENDING 或漏掉 SUCCEEDED 通知时，`subtitle_project` 行每 5s 被重查到天荒地老。
- **解法**：在 `processASRTask` 加 `staleTimeoutMs` 守卫（镜像视频路径 [task-processor.ts:99-152](apps/worker/src/task-processor.ts#L99)）；瞬时错误重试到阈值后标记 failed + notify。
- **验收**：mock 一个永不 SUCCEEDED 的 ASR 任务，确认超时后 project 进入 failed 并通知前端。

---

## §三、冗余（Redundancy）

### 3.1 🟡 provider 门面「零迁移」——storage/ffmpeg 包的唯一消费者就是 provider 自己

- **证据**：CLAUDE.md 说「新代码应直接 import `@excuse/storage` / `@excuse/ffmpeg`」，但已验证：**`@excuse/storage` 与 `@excuse/ffmpeg` 在各自包之外、provider 之外零消费者**。4 个 shim 文件（[storage.ts](packages/provider/src/storage.ts)、[subtitle-burner.ts](packages/provider/src/subtitle-burner.ts)、[audio-extractor.ts](packages/provider/src/audio-extractor.ts)、[compose.ts](packages/provider/src/compose.ts)）共 13 行，纯 `export … from`，零附加逻辑。`canvas-runtime`（最该直连的运行时包）仍走门面。
- **影响**：拆了两个包却没人用；文档承诺的迁移从未开始；门面是「向后兼容的惯性」而非「正在迁移的过渡」。
- **解法（二选一）**：
  - **A. 迁完**：把 ~11 处 `@excuse/provider` 的 storage/ffmpeg 引用改为直连 `@excuse/storage`/`@excuse/ffmpeg`，删 4 个 shim。
  - **B. 合回**：若短期无意迁移，把 `storage` + `ffmpeg` 合回 `provider`，删掉这两个包 + CLAUDE.md 的迁移承诺。
- **验收**：`grep -rl "@excuse/storage\|@excuse/ffmpeg" packages apps | grep -v provider | grep -v storage | grep -v ffmpeg` 与所选方案一致（A：出现真实直连；B：包消失）。

### 3.2 🟡 双套积分账本编排

- **证据**：[generation/service.ts](apps/server/src/modules/generation/service.ts) 的 `reserveGenerationCredit`/`debitReservedCredit`/`refundReservedCredit` 与 [gateway-service.ts](apps/server/src/services/gateway-service.ts) 的 `setupGatewayCall`/`settleGatewaySuccess`/`settleGatewayFailure` 各自实现 reserve→debit→refund + 各自的 audit 调用，无共享原语。
- **影响**：同一计费生命周期两份实现，漂移风险（一边漏处理某个 refund 边界）。
- **解法**：抽 `services/billing-ledger.ts`（或下沉到 `@excuse/billing`）的 `reserveAndTrack` / `settleOrRefund`，两处共用。
- **验收**：generation 与 gateway 的账本编排走同一函数；新增 audit 事件只改一处。

### 3.3 🟡 adapter 仪式——8 个接口里 2 个全死、3 个零逻辑透传

- **证据**：[task-engine](packages/task-engine/src/index.ts) 有 8 个 `*Adapter` 接口。`TaskPauseAdapter` / `pauseTaskWithAdapter` / `resumeTaskWithAdapter` 及 workflow-engine 的 `canPause*`/`canResume*`/`canResumeFromPhase` **零调用方**；`cancelTaskWithAdapter`/`sweepOrphanTasksWithAdapter`/`extendTaskLockWithAdapter` 是一行 `return adapter.x(...)` 透传。真正挣到钱的是 `applyTaskFailureWithAdapter`（失败分类真逻辑）与 `completeTaskWithAdapter`（成功后通知序列）。
- **影响**：无逻辑的透传是「为模式而模式」；`pause/resume` 是从未接线的 speculative 脚手架。**2.2 的 dialogue/bgm/assemble bug 正是这种仪式的下游**——信封活在 worker 胶水里而非纯包，所以新阶段能绕过。
- **解法**：删 `TaskPauseAdapter` 及相关 pause/resume 函数与 5 个 `canPause*` 规则；把零逻辑透传的 cancel/sweep/extendLock 收敛为直接调用（或仅在确有逻辑处保留 adapter）。
- **验收**：`grep -rn "pauseTaskWithAdapter\|resumeTaskWithAdapter\|TaskPauseAdapter"` 仅剩删除记录；adapter 接口数下降。

### 3.4 🟡 client 10 处手写 `fetch()` 违反「Eden treaty only」硬规则

- **证据**：grep 确认 10 个真实调用点——[asset-library.ts:51,68,91,100,114,128,142](apps/client/src/api/asset-library.ts#L51)（7 处，L49 注释「Eden treaty path is complex for nested source/id/hide」）、[SubjectLibrary.tsx:26,32,37](apps/client/src/pages/SubjectLibrary.tsx#L26)（3 处）。Eden 实际支持嵌套参数（见 [client.ts:608](apps/client/src/api/client.ts#L608) 已有 `api.api.canvas.assets(...)({id})` 用法）。手写版丢失类型安全、绕过 `unwrapEden` 的 401 清理。
- **解法**：10 处全部改写为 `api.api.…` treaty 调用 + `unwrapEden<T>`；删 `parseError` helper；为 SubjectLibrary 补 typed `subjectApi`。
- **验收**：`grep -rnE "fetch\(" apps/client/src | grep -v fetchEventSource | grep -v refetch` 仅剩 [Developers.tsx](apps/client/src/pages/Developers.tsx) 的示例代码字符串。

### 3.5 🟡 server 三种错误协议并存

- **证据**：AppError throw（绝大多数）/ gateway 的 `{status,response}` 手搓（[openai-gateway.ts](apps/server/src/routes/openai-gateway.ts) + `@excuse/gateway` 的 `*Error()` 工厂）/ auth 的 `status(401, …)`（[plugins/auth.ts:175](apps/server/src/plugins/auth.ts#L175)）。
- **影响**：一个 server 三种造错方式；gateway 错误不走统一 `onError`（日志/Retry-After/序列化路径不一致）。
- **解法**：让 `@excuse/gateway` 抛 AppError 子类（首选，统一契约）；auth 的 resolve 守卫改抛 `UnauthorizedError`。
- **验收**：`set.status =` / `status(…, …)` 业务错误造法收敛到「仅 errorHandlerPlugin」一处。

### 3.6 🟢 client 78 处手动 useMemo/useCallback（React Compiler 已开）

- **证据**：vite.config 确认 `babel({ presets: [reactCompilerPreset()] })` 已启用；client 仍有 78 处手动 memo（最密集：`ShotReferenceAssets.tsx` 13、`NodeDetailPanel.tsx` 10）。
- **影响**：Compiler 已自动 memoize，这些是死复杂度 + stale-closure 隐患，与 CLAUDE.md「auto-memoize」表述矛盾。
- **解法**：接触相关组件时顺手删纯派生/stable-dep 的 memo（先开 compiler eslint 插件校验）；仅保留经 profiling 确认的高耗时计算。
- **验收**：数量显著下降；既有交互无回归。

---

## §四、过度复杂化（Over-complexity，整体轻微）

### 4.1 🟡 `auth` 包 32 LOC 太小

- **证据**：[packages/auth](packages/auth/) 全包 32 行（`API_KEY_PREFIX` + SHA-256 hash + prefix 抽取），6 个 export 中 3 个零外部消费者。架构理由（保持 auth plugin 纯净、不 import db）成立，但 32 行不值得一个包边界 + package.json + tsconfig + 测试脚手架。
- **解法**：并入 `@excuse/shared`（已有 `domain-types.ts`/`config-helpers.ts` 等纯 helper），或保留但接受现状。
- **验收**：若并入，`@excuse/auth` 消失，import 改向 `@excuse/shared`，边界检查器规则同步移除 auth 条目。

### 4.2 🟡 `getTaskPriority` / `computeRetryDelay` 把 phase 名硬编码进 task-engine

- **证据**：[task-engine/src/index.ts:190-200](packages/task-engine/src/index.ts#L190) 的 `getTaskPriority` 硬编码 `canvas.videos`/`media.*`；[index.ts:386-391](packages/task-engine/src/index.ts#L386) 的 `computeRetryDelay` 硬编码 `canvas.videos`/`generate.video` 给指数退避。task-engine（生命周期）越界懂了 workflow-engine（phase 编排）的词汇。
- **影响**：缝漏——task/workflow-engine 的拆分概念正确不该合，但 priority/backoff 策略无处安放，只能字符串特判。每加一个「慢阶段」都要改 task-engine。
- **解法**：把 priority/backoff 策略挪到声明式表（canvas 的归 workflow-engine，generate 的归 gateway），task-engine 只留生命周期机制；或接受现状但文档化「task-engine 持有一张策略表」。
- **验收**：新增一个 canvas 阶段时，priority/backoff 无需改 task-engine（除非改默认策略）。

### 4.3 🟢 19 个包整体偏多但多数站得住

- 结论：纯规则包（rate-limit、events、gateway、metrics、provider-health、error-recovery、subtitle-engine、task-engine、workflow-engine）通过 adapter 注入各自可独立测试，多个有 4–10 个跨 app 消费方。范本：**metrics**（真子系统 + spec 正确的 Prometheus 序列化 + 5 消费方）、**events**（真 NOTIFY→SSE 整形，非透传）、**provider-health**、**subtitle-engine**、**billing**。砍掉 4.1（auth）+ §3.1（storage/ffmpeg）≈ 16–17 包，与实际耦合更匹配。**不建议大动包结构。**

---

## §五、文档同步（CLAUDE.md 漂移清单）

代码已走在文档前面，需一次性对齐（接触时顺手 / 专项均可）：

| CLAUDE.md 原文 | 实际 | 改法 |
|---|---|---|
| 「9 个阶段」`analyze→…→videos` | **12 个**（+ dialogue、bgm、assemble） | 改 12 阶段 |
| 「pause-before 门槛 storyboard、videos」 | **3 个**（+ assemble） | 改 3 个 pause 门 |
| 「Worker 跑 4 个 workload（含 pollExportingProjects）」 | **3 个** poll source | 见 §1.5 |
| 「Key domain types live in `packages/db/src/domain-types.ts`」 | 该文件已是 3 行 re-export shim，真身在 `packages/shared/src/domain-types.ts` | 改指向 shared；考虑删 shim |
| 「新代码优先直接从 `@excuse/storage`/`@excuse/ffmpeg` import」 | 零消费者直连 | 随 §3.1 决策改或删 |
| 「type `generate.video`」队列公民 | 幽灵 type | 随 §1.1 决策改 |

**验收**：逐项核对 CLAUDE.md 与代码一致；新贡献者按 CLAUDE.md 能找到正确文件。

---

## §六、边界检查器补强

- **证据**：[check-package-boundaries.ts](scripts/check-package-boundaries.ts) 的规则只覆盖 shared + 纯包白名单，**漏了 `error-recovery`、`canvas-engine`、`prompt-engine`**。目前它们恰好干净，但无机制阻止未来回归。
- **解法**：把 `error-recovery`（纯，应禁 db/provider）加入纯包规则；`canvas-engine`/`prompt-engine`（domain 包）加一条「禁 import db/provider/storage/ffmpeg」规则。
- **验收**：`bun run check:boundaries` 覆盖这三个包；故意写一个违规 import 能被拦下。

---

## §七、子系统记分卡

| 子系统 | 判定 | 首要问题 |
|---|---|---|
| 分层 / 依赖图 | ✅ 优 | 干净 DAG 无环；补 §六 边界规则 |
| packages/db | 🟡 良好 + 治理债 | 非 god-package；但 §2.1 迁移缺口(CRITICAL) + `CreditError` 漏进 db + 死代码 |
| canvas-engine / canvas-runtime | ✅ 优 | pure/io/phases 切分干净，类型不重复 |
| task-engine / workflow-engine | 🟡 缝漏 | 拆分正确不该合；§3.3 adapter 仪式 + §4.2 priority 越界 |
| 小包（12 个） | 🟡 多数优 | §4.1 auth 太小、§3.1 storage/ffmpeg 门面零迁移；其余范本级 |
| apps/server | 🟡 中上 | ServerConfig 注入是好；§2.3 52 处裸 Error + §2.4 generate.ts 厚路由 + §3.2 双账本 |
| apps/worker | 🔴 中心病根 | §一 统一队列半截迁移 → 锁/重试/关停/幽灵 type 四连 |
| apps/client | ✅ 良好 | 0 个 `as any`、token 内存态、store 分离；§3.4 手写 fetch + SSE 启动竞态 + Admin 1927 行 |

> **client 补遗（🟡 MEDIUM）**：
> - **SSE 启动竞态**：[App.tsx:47](apps/client/src/App.tsx#L47) 的 `initialize()` 与 [AuthProvider.tsx:26](apps/client/src/auth/AuthProvider.tsx#L26) 的 `connect()` 跨组件无握手，连上后若有早期 `pipeline_node_update` 会丢（仅 `generation_status` 在 onOpen 补刷）。解法：connect 改在 initialize 之后；或 onOpen 时也补刷 Canvas 项目。
> - **4 个 api 文件绕过 unwrapEden**：[api-keys.ts](apps/client/src/api/api-keys.ts)、[notifications.ts](apps/client/src/api/notifications.ts)、[admin.ts](apps/client/src/api/admin.ts) 手搓 `.data/.error` 映射，[api-keys.ts:7](apps/client/src/api/api-keys.ts#L7) 还丢了服务端错误信息。解法：统一走 `unwrapEden<T>`。
> - **Admin/index.tsx 1927 行巨组件**：拆出 Overview/Tasks/Users 子页（作者已会拆，见 sibling 文件）。

---

## §八、优先级总表（按 ROI 排序）

| 优先级 | 待办 | 条目 | 预估 |
|---|---|---|---|
| P0 立刻 | 补迁移 journal 0034–0037 | §2.1 | 小（生成 + 核对） |
| P0 本周 | 定 §一 video/ASR 去留（迁 or 带外） | §1.1–1.4 决策点 | 中–大 |
| P0 本周 | dialogue/bgm/assemble 走统一信封 | §2.2 | 小 |
| P1 短期 | 52 处裸 Error → AppError（同步路径优先） | §2.3 | 中 |
| P1 短期 | generate.ts 编排下沉 service | §2.4 | 中 |
| P1 短期 | ASR 超时 + 重试 | §2.5 | 小 |
| P1 短期 | client 10 处 fetch → Eden | §3.4 | 小 |
| P2 接触时 | provider 门面二选一 | §3.1 | 中 |
| P2 接触时 | 双账本编排收敛 | §3.2 | 中 |
| P2 接触时 | adapter 仪式清理 | §3.3 | 小 |
| P2 接触时 | 三种错误协议统一 | §3.5 | 小 |
| P3 清理 | 文档同步（§五）+ 边界检查器（§六）+ 死代码 | §五/§六 | 小 |
| P3 清理 | auth 包 / priority 越界 / 手动 memo | §4.1/§4.2/§3.6 | 小 |

### 死代码清理清单（P3，可批量）

- [ ] `pollExportingProjects`（[subtitle-projects.repo.ts:116](packages/db/src/repositories/subtitle-projects.repo.ts#L116)）— 零调用方
- [ ] `generate.video` 在 [task-engine](packages/task-engine/src/index.ts#L387) 的分支 + schema docstring（随 §1.1 决策）
- [ ] `createClient`（[modules/canvas/service-helpers.ts:13](apps/server/src/modules/canvas/service-helpers.ts#L13)）— 被 context.ts 取代，零引用
- [ ] `pause/resume` adapter 链 + `canPause*`/`canResume*`（§3.3）— 零调用方
- [ ] `workflows` repo（8 fn）+ schema（CLAUDE.md 自承「尚未激活」）— 零非测试调用方
- [ ] `subject-library` repo（5 fn）— 若近期不接 UI 则一并清
- [ ] `createVideoPollSource` 的 `_processor` 形参（[poll-sources.ts:81](apps/worker/src/poll-sources.ts#L81)）— 未使用
- [ ] `canvas/index.ts` 的 `/subjects/import` 内联 handler（带 `as any`）→ 移入 handlers-resources 并正型（§2.4 顺带）

### 验收命令

整改后至少跑：

```bash
bun run typecheck
bun run lint
bun run build
bun run test
bun run test:client
bun run check:boundaries
# 涉及 DB：
cd packages/db && bun run db:generate   # 确认 journal 完整
docker compose up -d && bun run --cwd packages/db db:migrate   # 确认空库可拉起
```

---

## 底线结论

**架构设计本身大部分是对的**——分层、adapter 注入、纯/运行时切分、canvas engine/runtime、统一任务队列的*设计*，都合理且执行得不错。问题几乎全部集中在两个可修复的模式：

1. **「设计先进，迁移没做完」**：统一队列（video/ASR 没进来）、provider 门面（拆了没人用）、迁移 journal（4 个没登记）。
2. **「代码走在文档前面」**：阶段数、poll 数、pause 门、错误协议、`CreditError` 归属、`domain-types.ts` 位置——文档与代码反复脱节。

**没有结构性腐烂，没有需要推倒重来的部分。** 把 §一（统一队列决策）+ §2.1（journal）+ §五（文档同步）三件做完，这个架构就名副其实了。
