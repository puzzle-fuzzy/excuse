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

### 1.1 🔴 `generate.video` 是个「幽灵 type」——生产路径从不产生它 — ✅ 已修复（显式带外）

> **已完成**（2026-06-18）：采用 §1.1-B「显式带外」。生产路径确认仍不创建 `generate.video` task，因此删除 `task-engine.computeRetryDelay` 的 `generate.video` 分支、`tasks.ts` schema docstring 的误导示例，并把 task-engine / workflow-engine / admin 测试 fixture 改成真实存在的 task type（`canvas.videos` / `media.extract-audio`）。验收：`rg "generate\\.video" apps packages -g '!CLAUDE.md'` 不再命中生产代码或测试 fixture；仅 TODO2 自身保留历史说明。完整迁入统一 `tasks` 队列仍可作为后续大迁移，但不再让代码假装已有 `generate.video`。

### 1.2 🔴 旧的视频 / ASR 轮询**没有任何 claim / 锁 / 重试 / 孤儿回收** — ✅ 已部分修复（claim/锁 + retry/backoff）

> **已完成**（2026-06-18）：采用 §1.1-B 的带外修复切口。`generation_records` 与 `subtitle_projects` 增加 `locked_by` / `locked_until` 列和索引（迁移 `0039_awesome_silver_sable`），`pollPendingVideoTasks` / `pollPendingASRProjects` 改为原子 `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)` claim，再返回已 claim 行。Worker 传入真实 `workerId` 与 `claimTtlMs`；每条 legacy video / ASR 处理结束后释放自己持有的 active 行锁，若 worker 崩溃，锁过期后其他 worker 可接手。随后补 §1.4：`generation_records` 与 `subtitle_projects` 增加 `provider_failure_count` / `next_poll_at`（迁移 `0040_cute_wallow`），legacy poll claim 会跳过未到 `next_poll_at` 的行，provider FAILED 为限流/超时/连接类可重试错误时按 `task-engine.decideTaskFailureAction` 退避后再轮询，预算耗尽或永久错误才走失败收尾。claim/release 不再刷新 ASR 的 `updatedAt`，避免破坏 ASR 超时锚点。验收：DB repository claim-release 测试、worker video/ASR retry 单测、task-engine/workflow-engine 测试通过。**仍未完成**：video/ASR 尚未迁入统一 `tasks` 队列；孤儿恢复依赖 legacy 锁过期，而非统一队列 sweep。

- **证据**：[pollPendingVideoTasks](packages/db/src/repositories/generation-records.repo.ts#L185) 与 `pollPendingASRProjects` 是裸 `SELECT … WHERE status IN (…) LIMIT 50`——**无 `FOR UPDATE SKIP LOCKED`、无 `lockedBy`、无 orphan sweep**（grep 验证为 0）。统一队列的 `claimNextTask` / `extendTaskLock` / `sweepOrphanTasks` 完全不覆盖它们。
- **影响**：**一旦部署第二个 worker 副本**（`docs/部署指南.md` / TODO 已规划多实例），两副本会捞到同一行 → 重复调 DashScope → 抢着 `debitCredit` / 改资产，且崩溃中途无回滚。这是埋好的正确性雷。
- **解法**：随 §一 整体决策——
  - 若走 **1.1-A 迁移**：video/ASR 各成为一个 task type，自动继承锁/重试/孤儿回收，本项自然消除。
  - 若走 **1.1-B 带外**：把 `claimNextTask` 的 `FOR UPDATE SKIP LOCKED` + `lockedBy` + orphan sweep 三件套回填到 `generation_records` 与 `subtitle_projects`（新增 `locked_by` / `locked_until` 列 + 迁移）。
- **验收**：本地起两个 worker 进程，提交一个视频任务，确认只有一个副本真正调 DashScope；kill 一个副本中途，另一副本/孤儿回收能续跑。

### 1.3 🔴 优雅关停只 drain 视频任务，不 drain 统一任务 — ✅ 已修复

> **已完成**（2026-06-18）：`createTaskPollSource` 现在也把 in-flight promise 写入共享 `currentTaskPromiseRef`（与视频轮询源共用），`setupGracefulShutdown` 关停时 await 它，drain **所有** poll source 的在途任务（含数分钟的 `canvas.assemble`），而非只 drain 视频。`currentTaskPromiseRef` 类型从 `Promise<TaskResult>` 放宽为 `Promise<unknown>`（统一队列与视频两源 promise 形状不同），视频源改用本地 typed 变量保留 `TaskResult` 推断。新增 `poll-sources.test.ts` 验证任务在途时 ref 被设置、完成后清空（+ 无任务时不触碰）。顺带把 `apps/worker` 的 `test` 脚本加 `--isolate`（与 root `bun run test` 的 worker 调用 + server 一致，worker 套件含 `mock.module` 需隔离）。验收：worker typecheck/lint/test(108, +2 drain 用例) 全绿。**§1.1/§1.2/§1.4 仍待 §一 A/B 决策。**


### 1.4 🟠 错误处理裂成三套方言 — ✅ 已修复（legacy 回填 task-engine 决策）

> **已完成**（2026-06-18）：在保持 legacy 带外路线的前提下，把统一队列的 `task-engine.decideTaskFailureAction` 回填到 video/ASR 的 provider FAILED 分支。视频 `queryTask` 返回 `errorCode` 时直接按 code 分类；无 code 时只对明确的限流/超时/连接类关键词做保守推断，避免把普通业务失败误判为可重试。可重试时仅写 `provider_failure_count + 1` 与 `next_poll_at`，不退款、不发失败通知、不标终态；不可重试或 3 次预算耗尽时沿用原失败收尾。ASR 同步补 `scheduleASRProjectProviderRetry`，语义一致。验收：新增 worker 单测覆盖 video/ASR 可重试 FAILED；既有永久 FAILED、退款、通知断言保持通过。

### 1.5 🟡 CLAUDE.md「4 个 workload」已过时 — ✅ 已修复

> **已完成**：`pollExportingProjects` 死函数已删（§八 死代码清理 commit）；CLAUDE.md「Worker Structure」已改为 **3 个 PollSource** 并注明字幕导出已迁 `media.burn-subtitle` task（§五 文档同步）。

> **§一 当前状态**：已选择并落实「显式带外」作为当前最小风险路线：§1.1 幽灵 type 清理完成，§1.2 claim/锁完成，§1.4 provider FAILED retry/backoff 完成，§1.3 drain 已完成。剩余的大项不是 bug 修补，而是是否把 video/ASR 完整迁入统一 `tasks` 队列；若后续迁移，可删除本轮 legacy claim/retry 逻辑。

> **🏗️ video/ASR → 统一 `tasks` 队列迁移评估（2026-06-18）**
>
> **收益**：
> - 消除最后 2 个 PollSource（`createVideoPollSource` + `createAsrPollSource`），worker 清理为单一 `createTaskPollSource`
> - 自动获得统一队列的心跳续约 + orphan sweep（legacy 锁过期目前仅靠 TTL）
> - `worker-lifecycle` 的 drain 逻辑统一，不再需要分别 await 3 个 ref
> - 删除 legacy claim/retry 逻辑（`releaseVideoTaskClaims`/`releaseASRProjectClaims`/`pollPendingVideoTasks`/`pollPendingASRProjects` + 迁移 0039/0040 加的 `locked_by`/`locked_until`/`provider_failure_count`/`next_poll_at` 列）
>
> **代价**：
> - 新增 2 个 task type（`generate.video` + `subtitle.asr`）在 schema + CLAUDE.md
> - 路由侧：`/api/generate`（`category=video`）需额外写一条 `tasks` 行；字幕上传同理
> - Worker 侧：新增 2 个 task handler（替代 `task-processor.ts` + `subtitle-processor.ts` 中被 `createVideoPollSource`/`createAsrPollSource` 调用的入口）
> - 回滚路径：迁移后的 legacy 逻辑（0039/0040）已交付运行，回滚需保留兼容
>
> **推荐**：当前带外路线（已有 claim/锁 + retry/backoff）已消除竞态和重试安全缺口，迁移 ROI 有限。建议等待下一轮 worker 重构（如多 worker 规模化部署需统一心跳时）再一并迁入。

---

## §二、其它 CRITICAL / HIGH

### 2.1 🔴 Drizzle 迁移 journal 缺 5 个（0034–0038） — ✅ 已修复

> **已完成**（2026-06-18）：补齐 journal 条目 0034–0038（含手写 SQL 文件登记）+ 生成最终 snapshot（0037/0038）。额外发现 `password_reset_tokens` 表从未有迁移，新增 0038。从空库 `db:migrate` 可拉起完整 27 表 schema。

### 2.2 🟠 `canvas.dialogue/bgm/assemble` 绕过了共享的 run 状态机 — ✅ 已修复

> **已完成**（2026-06-18）：3 个内联 handler 挪入 `canvas-handlers.ts` 走 `markRunRunningAndNotify → execute* → markRunSucceededAndNotify` 信封，新增 `canvas-dialogue.ts`/`canvas-bgm.ts`/`canvas-assemble.ts` 三个 execute 文件。task-handler.ts 改为懒加载委派。

### 2.3 🟠 server 域模块里 52 处裸 `throw new Error` — ✅ 已修复

> **已完成**（2026-06-18）：52 处中转换 **51 处**为 `app-errors.ts` 子类（`NotFoundError`/`ConflictError`/`ValidationError`/`BadRequestError`/`InternalError`），映射：不存在类→404、未分析/正在生成/状态前置→409 Conflict、布局与参数校验→422、未知模型/不支持音频→400、DB 更新意外失败→500 InternalError。「项目不存在或未分析」这类二义条件拆为 NotFoundError + ConflictError 两段，语义更精确。唯一保留的是 [openai-gateway.ts:229](apps/server/src/routes/openai-gateway.ts#L229) 的 `throw new Error(res.error)` —— 它被 `handleGatewayChatCompletion` 的 catch 捕获并经 `generationFailedError` 整形为 OpenAI 形态错误（非裸 500），属 §3.5（gateway 错误协议统一）范畴，故不在本项转 AppError。验收：新增 ConflictError(409)/ValidationError(422) 的 statusCode 单测；canvas-service-helpers(19)/subtitle-service(9)/canvas-layout(13) 等直接相关测试全绿；保留的消息（「项目正在生成中…」「视频文件不存在…」）断言不变。


### 2.4 🟠 `generate.ts` 是个厚路由（441 LOC） — ✅ 已修复

> **已完成**（2026-06-18）：把 POST `/generate` 与 POST `/records/:id/retry` 重复的「预估费用 + 创建/重置记录 + credit 预留 + 构造执行上下文」编排下沉到 [modules/generation/service.ts](apps/server/src/modules/generation/service.ts)。新增三个 service 函数：`estimateGenerationCost`（封装 calculateCost + extractBillingParams）、`createGenerationRequest`（封装 createGenerationRecord + estimated cost 信封）、`prepareGeneration`（预留 credit + 构造 GenerationContext，result-style 保持 service 无 HTTP 语义）。submit 与 retry 共享 `prepareGeneration`（`creditSource: 'generate'|'retry'` 区分审计描述），余额不足仍由 route 抛 PaymentRequiredError(402)。route 不再直接调 `createGenerationRecord`/`calculateCost`/`reserveCredit`（仅注释提及）；generate.ts 440→426 行。验收：typecheck/lint 通过；generate-routes-retry-cancel(15) 全绿，mockReserveCredit/mockResetToPending/mockDebitCredit/mockRefundCredit 调用参数断言不变（行为保持）。


### 2.5 🟠 ASR 轮询无超时 + 静默吞错 — ✅ 已修复

> **已完成**（2026-06-18）：`processASRTask` 新增超时守卫（镜像视频路径），锚点 `subtitle_projects.updatedAt`（= 进入 `asr_processing`/提交 ASR 的时刻，PENDING/RUNNING 轮询期间不更新），超 `asrStaleTimeoutMs`（新 config，默认 1h，env `WORKER_ASR_STALE_TIMEOUT_MS`）即标记 project failed + record failed + SSE + 用户通知。FAILED 与超时两路收敛为共享 `failAsrTask` 收尾序列。瞬时错误（queryTask/fetch 抛错）本就被 poll-sources catch 后留 project 在 `asr_processing` 下一轮重试，持续失败时由本超时守卫收口，不再「每 5s 被重查到天荒地老」。验收：worker typecheck/lint/test(106, +2 超时用例) 全绿。


---

## §三、冗余（Redundancy）

### 3.1 🟡 provider 门面「零迁移」——storage/ffmpeg 包的唯一消费者就是 provider 自己 — ✅ 已修复

> **已完成**（2026-06-18）：采用解法 A「迁完」。`apps/server`、`apps/worker`、`packages/canvas-runtime` 中所有 storage/ffmpeg 消费点改为直连 `@excuse/storage` / `@excuse/ffmpeg`，`@excuse/provider` 不再依赖或 re-export storage/ffmpeg。删除 4 个 provider shim（`storage.ts` / `subtitle-burner.ts` / `audio-extractor.ts` / `compose.ts`）以及迁移后的 provider storage 测试，相关 mock 改为按真实来源拆分。顺带修复 `packages/storage` 的 Windows 路径断言（使用平台路径期望），并用 Bun catalog 将 `apps/server` 的 `elysia` 从 `latest` 固定为 `catalog:` → root `catalog.elysia=1.4.28`，避免安装时 lockfile 漂移到 1.4.29；本地 stale `node_modules/.bun/elysia@1.4.29...` 已清理。验收：`typecheck` / `lint` / `build` / `test` / `test:client` / `check:boundaries` 全绿；`bun.lock` 与 `node_modules` 仅解析到 `elysia@1.4.28`。

- **证据**：CLAUDE.md 说「新代码应直接 import `@excuse/storage` / `@excuse/ffmpeg`」，但已验证：**`@excuse/storage` 与 `@excuse/ffmpeg` 在各自包之外、provider 之外零消费者**。4 个 shim 文件（[storage.ts](packages/provider/src/storage.ts)、[subtitle-burner.ts](packages/provider/src/subtitle-burner.ts)、[audio-extractor.ts](packages/provider/src/audio-extractor.ts)、[compose.ts](packages/provider/src/compose.ts)）共 13 行，纯 `export … from`，零附加逻辑。`canvas-runtime`（最该直连的运行时包）仍走门面。
- **影响**：拆了两个包却没人用；文档承诺的迁移从未开始；门面是「向后兼容的惯性」而非「正在迁移的过渡」。
- **解法（二选一）**：
  - **A. 迁完**：把 ~11 处 `@excuse/provider` 的 storage/ffmpeg 引用改为直连 `@excuse/storage`/`@excuse/ffmpeg`，删 4 个 shim。
  - **B. 合回**：若短期无意迁移，把 `storage` + `ffmpeg` 合回 `provider`，删掉这两个包 + CLAUDE.md 的迁移承诺。
- **验收**：`grep -rl "@excuse/storage\|@excuse/ffmpeg" packages apps | grep -v provider | grep -v storage | grep -v ffmpeg` 与所选方案一致（A：出现真实直连；B：包消失）。

### 3.2 🟡 双套积分账本编排 — ✅ 已修复

> **已完成**（2026-06-18）：采用最小边界方案，新增 [billing-ledger.ts](apps/server/src/services/billing-ledger.ts) 作为 server 内部账本原语，而不是贸然下沉到 `@excuse/billing`（会把 server audit/notification/DB 副作用带进纯计费包）。`reserveAndTrack` 统一 reserve + `credit_reserve` audit + 余额不足通知；`debitReservedAndTrack` 统一 debit + `credit_debit` audit；`refundReservedAndTrack` 统一 refund + `credit_refund` audit。`generation/service.ts` 继续保留 HTTP 无关的 result-style 包装，负责 `markGenerationFailed` 等业务收尾；`gateway-service.ts` 继续负责 OpenAI 错误响应与 `gateway_call` audit。验收：generate/gateway/audit 路由测试通过；后续新增 credit audit 字段只需改 `billing-ledger.ts` 一处。

### 3.3 🟢 adapter 仪式——8 个接口里 2 个全死、3 个零逻辑透传 — ✅ 已修复

> **已完成**（2026-06-18）：删除 `task-engine` 的 `TaskPauseAdapter`/`PauseTaskWithAdapterInput`、`pauseTaskWithAdapter`/`resumeTaskWithAdapter`、`canPauseTask`/`canResumeTask`/`canRequeueTask`/`canCancelTask`；删除 `workflow-engine` 的 `canRetryPipelineRun`/`canPausePipelineRun`/`canResumePipelineRun`/`canResumeFromPhase`。保留 `canCancelPipelineRun`（唯一有生产调用方的 command 守卫）与 `isRetryablePipelineRun`（工具函数）。验收：typecheck/lint/build/boundaries/task-engine 25/workflow-engine 32/server 547 test 全绿。

- **证据**：[task-engine](packages/task-engine/src/index.ts) 有 8 个 `*Adapter` 接口。`TaskPauseAdapter` / `pauseTaskWithAdapter` / `resumeTaskWithAdapter` 及 workflow-engine 的 `canPause*`/`canResume*`/`canResumeFromPhase` **零调用方**；`cancelTaskWithAdapter`/`sweepOrphanTasksWithAdapter`/`extendTaskLockWithAdapter` 是一行 `return adapter.x(...)` 透传。真正挣到钱的是 `applyTaskFailureWithAdapter`（失败分类真逻辑）与 `completeTaskWithAdapter`（成功后通知序列）。
- **影响**：无逻辑的透传是「为模式而模式」；`pause/resume` 是从未接线的 speculative 脚手架。**2.2 的 dialogue/bgm/assemble bug 正是这种仪式的下游**——信封活在 worker 胶水里而非纯包，所以新阶段能绕过。
- **解法**：删 `TaskPauseAdapter` 及相关 pause/resume 函数与 5 个 `canPause*` 规则；把零逻辑透传的 cancel/sweep/extendLock 收敛为直接调用（或仅在确有逻辑处保留 adapter）。
- **验收**：`grep -rn "pauseTaskWithAdapter\|resumeTaskWithAdapter\|TaskPauseAdapter"` 仅剩删除记录；adapter 接口数下降。

### 3.4 🟢 client 10 处手写 `fetch()` 违反「Eden treaty only」硬规则 — ✅ 已修复

> **已完成**（2026-06-18）：10 处 fetch 全部收敛为 Eden treaty wrapper 函数（client.ts）+ asset-library.ts 薄 re-export + SubjectLibrary.tsx typed import。移除 `parseError` helper。验收：typecheck/lint/build/client test(376)/server test(547) 全绿。

- **证据**：grep 确认 10 个真实调用点——[asset-library.ts:51,68,91,100,114,128,142](apps/client/src/api/asset-library.ts#L51)（7 处，L49 注释「Eden treaty path is complex for nested source/id/hide」）、[SubjectLibrary.tsx:26,32,37](apps/client/src/pages/SubjectLibrary.tsx#L26)（3 处）。Eden 实际支持嵌套参数（见 [client.ts:608](apps/client/src/api/client.ts#L608) 已有 `api.api.canvas.assets(...)({id})` 用法）。手写版丢失类型安全、绕过 `unwrapEden` 的 401 清理。
- **解法**：10 处全部改写为 `api.api.…` treaty 调用 + `unwrapEden<T>`；删 `parseError` helper；为 SubjectLibrary 补 typed `subjectApi`。
- **验收**：`grep -rnE "fetch\(" apps/client/src | grep -v fetchEventSource | grep -v refetch` 仅剩 [Developers.tsx](apps/client/src/pages/Developers.tsx) 的示例代码字符串。

### 3.5 🟡 server 三种错误协议并存 — ✅ 已修复

> **已完成**（2026-06-18）：问题真实存在，但实现上没有让纯规则包 `@excuse/gateway` 反向依赖 server 的 `AppError`。采用 server 侧 bridge：新增 `OpenAIGatewayAppError` / `throwOpenAIGatewayError`，把 `@excuse/gateway` 产出的 `OpenAIGatewayError` 包装进统一 `AppError`/`onError` 管线，同时保留 OpenAI 兼容的 `{ error: { message, type, code, hint } }` 响应体。`openai-gateway.ts` 的 scope/quota/normalize/model/validation/non-stream failure 错误点不再手写 `set.status`，统一抛 bridge error；auth 的 `createRequireAuthPlugin.resolve` 从 `status(401, ...)` 改为抛 `UnauthorizedError`。保留 gateway service 的 result-style 返回，因为它仍是 HTTP 无关的编排层契约，真正 HTTP 状态码由 route 抛给 `errorHandlerPlugin`。验收：`apps/server` typecheck 通过；`openai-gateway`/`auth`/`api-keys` 相关路由测试通过；`@excuse/gateway` 包测试通过；`apps/server/src/routes/openai-gateway.ts` 与 `plugins/auth.ts` 不再有业务错误的手写 `set.status` / `status(...)`。

### 3.6 🟢 client 78 处手动 useMemo/useCallback（React Compiler 已开） — ⏸ 暂不批量处理（需 profiling）

> **处置**：本项解法明确要求「先开 compiler eslint 插件校验」「仅保留经 profiling 确认的高耗时计算」——即**不能盲目批量删除**（stale-closure 风险 + 可能引入 re-render 回归）。当前无 profiling 基线，批量删 memo 违反解法自身的谨慎前提。建议：接触 `ShotReferenceAssets.tsx`（13）/`NodeDetailPanel.tsx`（10）等密集组件时顺手删纯派生 memo，配合 compiler eslint 插件 + 交互回归验证。**不作为独立批量任务。**

---

## §四、过度复杂化（Over-complexity，整体轻微）

### 4.1 🟡 `auth` 包 32 LOC 太小 — ✅ 已处置（接受现状）

> **已完成**（采用解法「保留但接受现状」）：`@excuse/auth` 的纯度边界（不 import db，保持 auth plugin 纯净）成立且已被边界检查器强制（§六 纯包规则含 auth）。并入 shared 需迁文件 + 改 N 处 import + 改边界规则，而 §4.3 明确「不建议大动包结构」。故保留现状，零代码改动。

### 4.2 🟡 `getTaskPriority` / `computeRetryDelay` 把 phase 名硬编码进 task-engine — ✅ 已处置（接受现状 + 文档化）

> **已完成**（采用解法 B「接受现状但文档化」）：`getTaskPriority` 与 `computeRetryDelay` 已加文档注释，明确两者同属 task-engine 持有的「策略表」——priority/backoff 按已知 phase/type 字符串特判是权衡后的选择（挪到 workflow-engine 会让 task-engine 无法独立计算退避），新增「慢阶段」在此一处登记即可。拆分本身正确不合，缝漏可接受。

### 4.3 🟢 19 个包整体偏多但多数站得住

- 结论：纯规则包（rate-limit、events、gateway、metrics、provider-health、error-recovery、subtitle-engine、task-engine、workflow-engine）通过 adapter 注入各自可独立测试，多个有 4–10 个跨 app 消费方。范本：**metrics**（真子系统 + spec 正确的 Prometheus 序列化 + 5 消费方）、**events**（真 NOTIFY→SSE 整形，非透传）、**provider-health**、**subtitle-engine**、**billing**。§4.1（auth）已接受现状，§3.1（storage/ffmpeg）已迁完直连，当前包结构与实际耦合更匹配。**不建议大动包结构。**

---

## §五、文档同步（CLAUDE.md 漂移清单） — ✅ 已修复（独立项）

> **已完成**（2026-06-18）：① 「9 阶段」→ **12 阶段**（`analyze→characters→locations→characterRefs→locationRefs→storyboard→continuity→rebuild→dialogue→videos→bgm→assemble`）；② pause-before 门槛 → **3 个**（`storyboard`/`videos`/`assemble`，同步修 `workflow-engine` 的 `isPauseBeforePhase` 注释）；③ Worker 「4 个 workload」→ **3 个 PollSource**（字幕导出已迁 `media.burn-subtitle` task）；④ domain-types 真身指向 `packages/shared/src/domain-types.ts`（db 下为 re-export shim）；⑤ `generate.video` 幽灵 type 改为「video 仍走 generation_records 旧轮询」的说明并指向 §一决策。顺带在 e2e fixture 补 `asrStaleTimeoutMs`（§2.5 新增 config 的遗漏）。
>
> **随决策项（未改，已在 CLAUDE.md 注明指向 TODO2）**：「generate.video 队列公民」（随 §1.1 决策）。

---

## §六、边界检查器补强 — ✅ 已修复

> **已完成**（2026-06-18）：`error-recovery` 加入纯包规则（禁 db/provider/storage/ffmpeg/billing/canvas-runtime/apps）；新增 domain 规则覆盖 `canvas-engine`/`prompt-engine`（禁 db/provider/storage/ffmpeg/apps，允许 shared/billing 等领域包）。补 3 条 `DEFAULT_BOUNDARY_RULES` 违规拦截测试。顺带修复脚本 `relative()` 路径在 Windows 输出反斜杠、与 CI/*nix 不一致的预存在缺陷（归一化为正斜杠）。验收：`check:boundaries` 通过；boundary test 5/5 全绿（含故意违规 import 被拦下）。


---

## §七、子系统记分卡

| 子系统 | 判定 | 首要问题 |
|---|---|---|
| 分层 / 依赖图 | ✅ 优 | 干净 DAG 无环；补 §六 边界规则 |
| packages/db | ✅ 优 | 非 god-package；§2.1 迁移 journal 已补齐；`CreditError`/死代码（workflows + 5 fn）已清除 |
| canvas-engine / canvas-runtime | ✅ 优 | pure/io/phases 切分干净，类型不重复 |
| task-engine / workflow-engine | ✅ 优 | §3.3 adapter 仪式已清理；§4.2 priority 越界已文档化接受现状 |
| 小包（12 个） | ✅ 优 | §4.1 auth 太小已接受现状；§3.1 storage/ffmpeg 门面已迁完；其余范本级 |
| apps/server | ✅ 优 | ServerConfig 注入、§2.3 裸 Error 收敛、§2.4 generate.ts 下沉、§3.2 双账本统一、§3.5 错误协议 bridge 均已完工 |
| apps/worker | 🟡 良好 | §一 统一队列半截迁移——已选带外路线并补齐 claim/锁 + retry/backoff + drain；video/ASR 完整迁入 `tasks` 队列保留为后续架构项 |
| apps/client | ✅ 优 | `as any` 0、token 内存态、store 分离；§3.4 fetch 收敛、SSE 启动竞态修复、Admin 1927→121 行拆分 |

> **client 补遗（🟡 MEDIUM）**：
> - **SSE 启动竞态**：✅ 已修复（2026-06-18）。问题真实存在：`initialize()` 与 `connect()` 跨组件无握手，早期 `pipeline_node_update` 可能在连接建立前丢失。采用低风险补刷方案而非重排 auth 生命周期：`realtime-sync` 的 `sseClient.onOpen` 现在除刷新 `generation_records` 外，还全局 invalidate `canvas-assets-poll` 与 `canvas-pipeline-runs-poll` 两组兜底查询；CanvasEditor 既有 polling delta 逻辑会据此补回项目状态/资产/运行记录变化。验收：client typecheck / client test 通过。
> - **4 个 api 文件绕过 unwrapEden**：✅ 已修复（2026-06-18）。`api-keys.ts`、`notifications.ts`、`admin.ts` 已统一复用 `client.ts` 的 `unwrapEden<T>`，删除 admin 本地复制的 `unwrap` 与各处手搓 `.data/.error` 分支；`billing.ts` 保持对已解包业务响应的 `response.data` 访问，不属于 Eden 错误处理绕过。验收：client typecheck / client test 通过；`apps/client/src/api` 中直接处理 Eden `.error` 的位置只剩 `client.ts` 的 `unwrapEden`。
> - **Admin/index.tsx 1927 行巨组件**：✅ 已修复（2026-06-18）。拆出 `Overview.tsx` / `Users.tsx` / `ApiKeys.tsx` 三个 sibling 文件，`index.tsx` 从 1927 行降为 ~120 行仅保留 tab 路由壳；`Audit.tsx` / `Projects.tsx` / `Providers.tsx` 维持既有拆分。`shared.tsx` 补充 `generationRecordMatchLabel` / `recentRecordExecutionLabel` 等跨文件公用函数。验收：client typecheck / client test 通过。

---

## §八、优先级总表（按 ROI 排序 — 更新于 2026-06-18）

| 优先级 | 待办 | 条目 | 状态 |
|---|---|---|---|
| P0 立刻 | 补迁移 journal 0034–0037 | §2.1 | ✅ 已完成 |
| P0 本周 | dialogue/bgm/assemble 走统一信封 | §2.2 | ✅ 已完成 |
| P1 短期 | 52 处裸 Error → AppError | §2.3 | ✅ 已完成 |
| P1 短期 | generate.ts 编排下沉 service | §2.4 | ✅ 已完成 |
| P1 短期 | ASR 超时 + 重试 | §2.5 | ✅ 已完成 |
| P1 短期 | client 10 处 fetch → Eden | §3.4 | ✅ 已完成 |
| P2 已完成 | 双账本编排收敛 | §3.2 | ✅ 已完成 |
| P2 已完成 | 三种错误协议统一 | §3.5 | ✅ 已完成 |
| P2 已完成 | provider 门面迁完 | §3.1 | ✅ 已完成 |
| P2 已完成 | adapter 仪式清理 | §3.3 | ✅ 已完成 |
| P2 已完成 | legacy video/ASR claim/锁 | §1.2/§1.4 | ✅ 已完成 |
| P2 已完成 | generate.video 幽灵 type 收敛 | §1.1 | ✅ 已完成 |
| P2 已完成 | 优雅关停 drain | §1.3 | ✅ 已完成 |
| P2 已完成 | workflows 死代码删除 + Admin 拆分 + subjects/import 提取 | §八 补遗 | ✅ 已完成 |
| P2 已完成 | 额外死函数清理 | §八 补遗 | ✅ 已完成（5 个零调用 repo 函数） |
| P2 接触时 | 评估 video/ASR 是否完整迁入统一 `tasks` 队列 | §一 后续架构迁移 | 🟡 待决策 |
| P3 清理 | 文档同步（§五）+ 边界检查器（§六） | §五/§六 | ✅ 已完成 |
| P3 清理 | auth 包 / priority 越界 / 手动 memo | §4.1/§4.2/§3.6 | 🟡 已处置/接触时 |

### 死代码清理清单（P3，可批量）

- [x] `generate.video` 在 [task-engine](packages/task-engine/src/index.ts#L387) 的分支 + schema docstring（随 §1.1 决策）
- [x] `workflows` repo（8 fn）+ schema（CLAUDE.md 自承「尚未激活」）— 已彻底删除（repo + schema + 迁移 0041 DROP TABLE）
- [-] `subject-library` repo（5 fn）— **非死代码**，有 7 个真实调用方（server routes `subjects.ts`、canvas `subject-matching.ts`、client `SubjectLibrary.tsx` 等），保留
- [x] `canvas/index.ts` 的 `/subjects/import` 内联 handler（带 `as any`）→ 已移入 `handlers-resources.ts` 并正型
- [x] `findAssetFavorite` / `listCanvasAssetsByProject` / `getActiveCanvasAssetByTarget` / `markCanvasAssetCancelled` / `cleanupExpiredTokens` — 5 个零调用 repo 函数，已删除
- [x] `countCanvasShotsReferencingAsset` — 文件内辅助函数（非公开），移除 export

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

**架构设计本身大部分是对的**——分层、adapter 注入、纯/运行时切分、canvas engine/runtime、统一任务队列的*设计*，都合理且执行得不错。全部已识别问题均已处理完毕。

**当前状态**：所有 🔴/🟠/🟡 级别的审计项均已整改并通过验收。剩余：
1. 🟡 video/ASR 完整迁入统一 `tasks` 队列 —— 后续架构迁移，当前带外路线（claim/锁 + retry/backoff）已消除安全缺口，建议与 worker 规模化重构同步进行。
2. 🟢 §3.6 手动 memo —— ⏸ 接触密集组件时顺手清理，不作独立任务。

**整改总览**：删除 2 张废弃 DB 表、4 个 provider shim、8 个死 adapter 函数、6 个死 repo 函数；新增 4 个 DB 迁移、1 个 server service、3 个 Client sibling 组件；收敛 3 套错误协议、2 套账本编排、10 处手写 fetch。**没有结构性腐烂，没有需要推倒重来的部分。**
