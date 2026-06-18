# 项目统一 TODO

更新时间：2026-06-19

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

## 一、用户体验 (UX) / 可访问性

### 1.1 ✅ 加载态全是「菊花」/纯文本，零骨架屏（已修复）

- **修复**：新增 `ui/skeleton.tsx`（shadcn 风格 Skeleton 组件）+ `RecordCardSkeleton` / `RecordCardSkeletonList`。Workspace 列表加载态用骨架屏替代空白文字；Billing 全页加载态用骨架卡片替代「加载中...」；Canvas 列表页用骨架替代菊花；App.tsx 路由切换 fallback 用骨架替代「页面加载中...」。
- **验收**：列表/页面加载显示骨架而非纯文字；既有测试 375/376 通过（1 个预存失败不相关）。

### 1.2 ✅ 空状态无引导、无 CTA（已修复）

- **修复**：新增共享 `EmptyState` 组件（图标 + 标题 + 可选描述 + CTA slot）。Workspace 空状态指引「← 在左侧输入 Prompt 开始生成」；Billing 三处「暂无数据」统一用 EmptyState；Navbar 通知空状态用 EmptyState + Bell 图标。
- **验收**：核心空状态有明确下一步动作或提示。

### 1.4 🟡 上传 toast ✅ / 草稿保护 ✅（已全部修复）

- **证据**：[workspace.ts](apps/client/src/stores/workspace.ts) `uploadReferenceFiles`/`uploadMediaParam` 失败只翻 `uploadingRefs` 无 toast；Canvas 创建故事 textarea（[Canvas.tsx:150-156](apps/client/src/pages/Canvas.tsx#L150-L156)）与 Workspace prompt 无持久化、无 `beforeunload`。
- **修复**：(a) ✅ 两处上传路径已加 `toast.error`（commit 82e9360）；(b) ✅ 新增 `lib/draft-storage.ts`（sessionStorage 持久化 + beforeunload 拦截），Canvas 故事 textarea 与 Workspace prompt 均已接入，成功提交后清除草稿。
- **验收**：上传失败有提示；长输入跨刷新/导航不丢。

### 1.5 🟡 Toast 位置 / 导航栏拥挤 / 表单校验 / 快捷键 / a11y（部分已修复，剩余接触时渐进）

> 接触相关区域时顺手做，不专门开冲刺。

- **Toast 刷屏风险 ✅**：已移 `bottom-right`（`App.tsx`），不再遮挡状态栏/标题。
- **a11y 图标按钮 ✅**：RecordCard 复制按钮、Navbar 通知铃/退出登录按钮已补 `aria-label`。
- **导航栏 10 项拥挤**：待后续设计（主导航 + 「更多 ▾」折叠菜单）。
- **表单校验**：待后续（`mode:'onBlur'` + 字段级提示）。
- **无快捷键 / 批量 / 撤销**：待后续。
- **验收**：Toast 不遮挡核心内容；图标按钮屏幕阅读器可读。

---

## 二、运行时可靠性（生产风险）

> 这些是真实运行中会炸、会资损、会静默错乱的隐患。多数改动小、收益大，应优先处理。

### 2.1 ✅ FFmpeg 操作无超时 / 无强制 kill（已修复）

- **修复**：新增 `ffmpeg-spawn.ts` 封装 `spawnFfmpeg()`，超时默认 10min（env `FFMPEG_TIMEOUT_MS`），`FfmpegTimeoutError` 被 task-engine 分类为 retriable/timeout。compose/audio-extractor/subtitle-burner 全部迁移。（commit 0d6862b0）

### 2.2 ✅ 三套状态机写入无原子性 → crash drift（已修复）

- **修复**：新增 `reconcile.ts`（worker），每轮 poll 后查询 `tasks JOIN canvas_pipeline_runs WHERE task IN (succeeded,failed,cancelled) AND run=running`，将漂移的 run 补标为对应终态。append-only guard 确保幂等。（commit 80b423a6）

### 2.4 ✅ SSE 死连接回收（已修复）

- **修复**：`UserEventHub` 加 `lastActivity` 跟踪 + `sweepStaleConnections(maxIdleMs=60s)` 方法。SSE route 在 30s heartbeat interval 中调用 sweep，清除空闲 >60s 的死连接。（commit 82e9360）

### 2.5 ✅ rate-limit key 可被伪造 + 限流 Map 无 GC（已修复）

- **证据**：[rate-limit/index.ts:59-64](packages/rate-limit/src/index.ts#L59-L64) `buildRateLimitKey` 用 token 前 50 字符当 user key，且 rate-limit 全局中间件在 auth 之前应用。恶意客户端轮换伪造 token → 每个 token 独立 bucket → 绕过单用户限流；且全局限流实为 `elysia-rate-limit` 的 LRU（`maxSize: 5000`），轮换 >5000 个伪造前缀会把合法用户的计数驱逐，进一步放大绕过。
- **修复**：(a) `buildRateLimitKey` 改为尽力 JWT 无验证解码提取 `sub`（userId），无效 token 统一落到 IP bucket；(b) 全局限流插件 `maxSize` 从 5000 提升到 50000；(c) `SlidingWindowRateLimiter.check()` 每次自清理过期窗口。
- **验收**：伪造 N 个不同 token 的并发请求被收敛到同一 IP bucket；空窗口 key 被周期清理。

---

## 三、架构设计与拓展性

### 3.2 🟡 category 注册表化（核心路径已收敛，剩余接触时渐进）

- **证据**：`category === '...'` / `switch(category)` 命中遍布：[provider/dashscope-client.ts](packages/provider/src/dashscope-client.ts) switch、[generate.ts](apps/server/src/routes/generate.ts) 6+ 处、[notifications.ts:57,72](apps/server/src/services/notifications.ts#L57)（**二元 text/image 判断无 default**）、[assets/service.ts:58-66](apps/server/src/modules/assets/service.ts#L58-L66)（`default: 'text'` 静默兜底）。
- **已修复**：(a) 新增 `CATEGORY_META` 注册表（`@excuse/shared/src/models.ts`），含 label/assetKind/notifyCompletedTitle/notifyFailedTitle/sync；(b) `notifications.ts` 已改用 `CATEGORY_META[category]`，参数类型从 `'text' | 'image'` 拓宽为 `ModelCategory`；(c) `assets/service.ts` `genCategoryToKind` 已改用 `CATEGORY_META`，删除静默 `default: 'text'` 兜底（改为 throw）；(d) `AssetLibraryKind` / `NotificationMeta.category` 已补 `'audio'` 成员。
- **已修复**：(e) ✅ dashscope-client.ts `generate()` 中 4-case switch 已替换为 `CATEGORY_GENERATORS` 方法映射表，新增 category 时在表中登记一行即可。
- **待渐进**：client 端 `CATEGORY_CONFIG` 已是 const 注册表 + 派生 `Category` 类型，与 server 端 `CATEGORY_META` 职责不同（UI 专属 color/icon 字段）；进一步收敛需跨层重构，不在当前范围。
- **验收**：`notifications.ts` 与 `assets/service.ts` 不再有静默兜底；新增 category 在 `CATEGORY_META` 中注册一行即可覆盖通知/资产映射；dashscope-client 无硬编码 switch。

### 3.3 ✅ task-engine 反向耦合 workflow 词汇（已修复）

- **修复**：为 `getTaskPriority` / `computeRetryDelay` 引入声明式策略表（`TaskPriorityPolicy` / `TaskBackoffPolicy`），导出 `DEFAULT_PRIORITY_POLICY` / `DEFAULT_BACKOFF_POLICY` 常量。函数接受可选 `policy` 参数（默认使用内置表），新增业务 type 时在策略表中登记一行即可。移除 `taskType.includes('video')` 子串匹配隐性耦合。错误码分类同步表式化（`ERROR_CODE_REGISTRY`）。
- **验收**：task-engine 不再含硬编码 if 链；新增 type 只需在策略表注册；28 个 task-engine 测试全绿。

### 3.4 🟡 配置硬编码：退避 / 优先级 / 限流 / 错误分类双轨（核心已修复，剩余渐进）

- **已修复**：(a) task-engine 退避/优先级已表式化（§3.3）；(b) task-engine 错误码分类已表式化（`ERROR_CODE_REGISTRY` 替代 if 链 `isRetriableTaskErrorCode` / `categorizeTaskErrorCode`）；(c) rate-limit 新增 `DEFAULT_ROUTE_RATE_LIMITS` 声明式 per-route 配置表 + `matchRouteRateLimit()` 纯函数匹配；(d) ✅ rate-limit 插件已接入 per-route 表 — 替换 `elysia-rate-limit` 为自定义 Elysia `onRequest` 插件，`matchRouteRateLimit()` 匹配路径 → 覆盖全局默认 → `SlidingWindowRateLimiter.check()` 判定。
- **待渐进**：error-recovery 与 task-engine 两套错误分类表最终归一。
- **验收**：调参只改数据表/配置不改逻辑；限流支持 per-route 声明；新增/调整路由限流只需编辑 `DEFAULT_ROUTE_RATE_LIMITS` 表。

---

## 四、文件单一职责 / 大文件拆分（接触时顺手做）

> 原则同 CLAUDE.md：**接触相关区域时顺手拆，不专门开冲刺**。下列是当前**仍存在**的过大/职责混乱文件（canvas.ts/Admin.tsx/task-processor.ts 等已拆的不列）。

### 4.1 ✅ generate.ts 生成编排去重（已修复）

- **证据**：[generate.ts](apps/server/src/routes/generate.ts) POST `/generate` 与 POST `/records/:id/retry` 有 ~110 行 validate→reference→cost→prepare→execute→createTask 几乎逐行复制。
- **修复**：抽 `modules/generation/orchestration.ts`（`orchestrateGeneration` + `serializeRecord`），两路径共享同一编排函数。generate.ts 从 483 行缩减至 ~280 行。
- **验收**：两路径共享同一编排函数；既有 generate/retry/cancel 测试 45 个全绿。

### 4.2 ✅ dashscope-client.ts（918 行）拆四模块（已修复）

- **修复**：抽 `provider-hooks.ts`（observer/guard registry + ModelDegradedError，127 行）、`dashscope-request-builder.ts`（applyMappings + buildRequestBody 纯函数，147 行）、`dashscope-sse.ts`（iterSSEEvents + parseOpenAIChatSSE + parseDashScopeChatSSE，151 行）。Client 从 988 行收缩至 515 行；4 个 sync fetch 方法通过 `withErrorHandling` 模板压缩传输层 try/catch 重复。重导出保持下游 import 路径不变。
- **验收**：Client 515 行，SSE 解析器可独立单测；既有 provider 142 个测试全绿。

### 4.3 ✅ admin.ts 路由按子域拆（已修复）

- **修复**：`routes/admin/` 目录下按 10 子域拆为独立 handler 文件（`overview`/`tasks`/`users`/`providers`/`asset-retention`/`projects`/`audit-logs`/`api-keys`/`gateway-clients`/`credit`）+ `helpers.ts`（原 `admin-helpers.ts`）+ `index.ts`（barrel 路由注册）。Admin 鉴权从 derive 块下沉为 `resolve` 守卫（非管理员直接 throw ForbiddenError），17 个 handler 手写 `if (!adminAllowed) return adminDenied()` 归零。handler 函数可独立单测。
- **验收**：admin 路由按域分文件，手写守卫归零；typecheck + lint + build 全绿；35 个 admin 测试全绿。

### 4.4 🟡 其余大组件拆分（接触时）

| 文件 | 行数 | 拆分方向 |
|---|---|---|
| [Assets.tsx](apps/client/src/pages/Assets.tsx) | 1133 | URL 同步 + 卡片网格 + 标签管理 + 详情/删除对话框 → `AssetsGrid`/`AssetTagManager`/`AssetDetailDialog`/`AssetDeleteDialog` |
| [ModelLab.tsx](apps/client/src/pages/ModelLab.tsx) | 919 | 表单 + 参考上传 + 多模型对比 + Canvas 默认值 + 6 面板 → 拆子组件 + 公共 `ParameterInput` |
| [NodeDetailPanel.tsx](apps/client/src/components/canvas/NodeDetailPanel.tsx) | 565 | shot/character/location/project 四面板揉在一起 → 路由 + `{Shot,Character,Location,Project}DetailPanel` |
| [admin-dialogs.tsx](apps/client/src/pages/admin-dialogs.tsx) | 604 | 5 个无关组件塞「dialogs」名下（含表格/状态卡）→ 按 `dialogs/` vs `components/` 正名拆 |
| [lib/asset-library.ts](apps/client/src/lib/asset-library.ts) | 602 | Canvas deep-link（与资产无关）+ shot-reference helpers 混进 → `lib/canvas-deep-link.ts`/`lib/shot-reference-assets.ts` |
| [PipelineController.tsx](apps/client/src/components/canvas/PipelineController.tsx) | 753 | 恢复 + auto + trigger 逻辑与渲染同处 → 抽 `usePipelineController` hook + 阶段子组件 |
| [gateway/index.ts](packages/gateway/src/index.ts) | ✅ 已拆 | 469 行 → `errors.ts`（错误码+工厂）+ `protocol.ts`（协议映射+流）+ `usage.ts`（用量聚合），index.ts 退化为 barrel |

**不应误拆（大但合理）**：`client.ts`（Eden 薄封装）、`domain-types.ts`/`shared/canvas.ts`/`shared/admin.ts`（纯类型契约）、`model-configs.ts`（声明式目录）、`generation-records.repo.ts`（单表 repo）、`modules/assets/service.ts`（单一职责 query+map）、`Developers.tsx`（文档页）。这些是「内容多」非「关注点混」，保持现状。

**验收（通用）**：拆分后行为不变（既有测试全绿），新增子文件单一职责，barrel 对外 API 不变。

### 4.5 🟡 跨文件重复抽取（接触时）

- **Admin 列表分页模板 ✅**：[Admin/ApiKeys.tsx:451-576](apps/client/src/pages/Admin/ApiKeys.tsx#L451-L576) 与 [Admin/Users.tsx:336-473](apps/client/src/pages/Admin/Users.tsx#L336-L473) 逐字复制同一分页 footer → 已抽 `AdminPaginationFooter`（`shared.tsx`），两 Tab 均已接入。
- **API key 表格 ✅**：`AdminGatewayKeysTable`（ApiKeys）与 `AdminUserApiKeysSection`（Users）渲染同列 → 已抽 `ApiKeyTable`（`shared.tsx`），通过 `showName` / `showCreatedAt` / `showActions` 控制差异化列。
- **参数输入渲染 ✅**：[Workspace.tsx:128-197](apps/client/src/pages/Workspace.tsx#L128-L197) `renderParamInput` 与 [ModelLab.tsx:389-488](apps/client/src/pages/ModelLab.tsx#L389-L488) `renderParam` 重复实现 → 已抽 `ParameterInput.tsx`（覆盖 text/number/select/boolean/mediaUpload 五种形态），Workspace + ModelLab 均已接入。
- **参考图多上传 UI ✅**：Workspace 与 ModelLab 重复虚线框 + 缩略图网格 → 已抽 `ReferenceImageUploader.tsx`，两页均已接入。
- **状态集合枚举散落 ✅**：`ACTIVE_GENERATION_STATUSES` / `GEN_RUNNING_STATUSES` 已收敛至 `@excuse/shared/src/generation.ts`（与 `GenerationStatus` 类型同源）。generation/service、generation-records.repo、assets/service 已改用共享导出。`REQUEUEABLE_STATUSES` 属于 task 状态（非 generation），保留在 admin/tasks 原位。

---

## 五、可观测性

### 5.1 ✅ traceId 不贯穿统一队列 / Canvas 流水线（已修复）

- **修复**：`tasks` 表加 `traceId` 列（migration 0044）；server（generate.ts/canvas/helpers.ts）创建 task 时透传 traceId；worker（task-handler/pipeline-stepper）日志 + pipeline auto-advance 传播 traceId；`notifyTaskStatusChange` NOTIFY 载荷含 traceId。（commit 7fc1364）

### 5.2 ✅ 错误日志 / SSE 可能含 prompt 全文（已修复）

- **修复**：`@excuse/shared` 新增 `sanitizeErrorMessage()`（截断至 500 字符 + 移除敏感 JSON 嵌入）。应用点：(a) `parseDashScopeError` 返回前脱敏；(b) `markTaskFailed`（tasks.repo）入库前脱敏；(c) `markGenerationFailed` / `cancelGenerationRecordIfActive`（generation-records.repo）入库前脱敏。
- **验收**：errorMessage 入库/入 SSE 统一经过截断+脱敏；既有 provider/db 测试全绿。

---

## 六、暂缓事项（需路线图 / 显式设计假设）

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

## 本轮总览（截至 2026-06-19）

本轮六维度审计新发现约 40 项，按 ROI 建议推进顺序：

1. **P0（已全部完成 ✅）**：§2.1 FFmpeg 超时 · §2.2 状态机原子化
2. **P1（全部完成 ✅）**：§5.1 traceId 贯穿 ✅ · §1.4 上传提示 + 草稿保护 ✅ · §4.1 generate 去重 ✅ · §2.4 SSE 死连接 ✅ · §2.5 rate-limit 加固 ✅
3. **P2**：
   - ✅ §3.2 category 注册表（核心路径）· ✅ §3.3 task-engine 去耦 · ✅ §3.4 配置表式化（核心）· ✅ §1.1 骨架屏 · ✅ §1.2 空状态 · ✅ §5.2 错误脱敏 · ✅ §4.2 dashscope 拆分 · ✅ §4.3 admin 按域拆
4. **接触时顺手**：§1.5 Toast/a11y（Toast✅ a11y✅）· §4.4 大文件拆分 · §4.5 去重（status集合✅ · ParameterInput✅ · ReferenceImageUploader✅ · AdminPaginationFooter✅ · ApiKeyTable✅）
5. **暂缓**：§六 多租户 / i18n / Redis 限流（待路线图）

已修复并清理：流水线 12 阶段（原 §1.3 ✅）、task 锁 heartbeat（原 §2.3 ✅）、草稿保护（§1.4(b) ✅）、generate 去重（§4.1 ✅）、rate-limit 加固（§2.5 ✅）、category 注册表（§3.2 ✅，含 dashscope-client switch 注册表化）、task-engine 策略表化（§3.3 ✅）、配置表式化（§3.4 ✅，含 per-route 插件接入）、骨架屏+空状态（§1.1+§1.2 ✅）、错误脱敏（§5.2 ✅）、dashscope 拆四模块（§4.2 ✅）、admin 按域拆（§4.3 ✅）、status 集合收敛 + ParameterInput + ReferenceImageUploader + AdminPaginationFooter + ApiKeyTable 去重（§4.5 ✅）
