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

## 一、用户体验 (UX) / 可访问性

### 1.1 🟠 加载态全是「菊花」/纯文本，零骨架屏

- **证据**：grep `Skeleton` **零文件**。所有页面二选一：居中「加载中...」（[Canvas.tsx:131](apps/client/src/pages/Canvas.tsx#L131)、[Billing.tsx:86](apps/client/src/pages/Billing.tsx#L86)、[CanvasEditor.tsx:122](apps/client/src/components/canvas/CanvasEditor.tsx#L122)）或内联 `<Loader2 animate-spin>`。路由切换 [App.tsx:25-31](apps/client/src/App.tsx#L25-L31) 是全屏「页面加载中...」。
- **影响**：慢网下页面闪烁空白再弹出内容，列表布局抖动，廉价感。
- **解法**：为 3 个主列表（RecordCard、Canvas 项目、Billing 卡片）加 `Skeleton`；裸「加载中...」换骨架屏。
- **验收**：列表加载显示骨架而非空白文字。

### 1.2 🟠 空状态无引导、无 CTA

- **证据**：[Workspace.tsx:361-364](apps/client/src/pages/Workspace.tsx#L361-L364) 仅图标 + 「暂无生成记录」；[Billing.tsx:202,238,275](apps/client/src/pages/Billing.tsx#L202) 「暂无数据」重复三次；[Navbar.tsx:184](apps/client/src/components/Navbar.tsx#L184) 「暂无通知」。
- **影响**：首次用户到达空状态是死胡同，没有继续路径。
- **解法**：抽共享 `EmptyState`（图标 + 标题 + 可选 CTA slot）；Workspace 空状态指向左侧表单（「← 输入 Prompt 开始生成」）。
- **验收**：核心空状态有明确下一步动作。

### 1.4 🟠 上传失败静默吞 + 无草稿/未保存警告

- **证据**：[workspace.ts](apps/client/src/stores/workspace.ts) `uploadReferenceFiles`/`uploadMediaParam` 失败只翻 `uploadingRefs` 无 toast；Canvas 创建故事 textarea（[Canvas.tsx:150-156](apps/client/src/pages/Canvas.tsx#L150-L156)）与 Workspace prompt 无持久化、无 `beforeunload`。
- **影响**：参考图上传静默失败 → 下次生成在降级输入上跑；用户粘 2000 字故事误点导航 → 全丢。
- **解法**：(a) ✅ 两处上传路径已加 `toast.error`（commit 82e9360）；(b) Canvas 创建故事 + Workspace prompt 持久化到 sessionStorage（按路由 key）；未保存的长输入加 `beforeunload`。
- **验收**：上传失败有提示；长输入跨刷新/导航不丢。

### 1.5 🟡 Toast 位置 / 导航栏拥挤 / 表单校验 / 快捷键 / a11y（一组打磨项）

> 接触相关区域时顺手做，不专门开冲刺。

- **Toast 刷屏风险**：[App.tsx:57](apps/client/src/App.tsx#L57) `top-center richColors` 遮挡状态栏/标题，级联失败时多个 toast 叠加。→ 移 `bottom-right`，批量操作合并为单 toast。
- **导航栏 10 项拥挤**：[Navbar.tsx:37-48](apps/client/src/components/Navbar.tsx#L37-L48) 10 个 `NAV_ITEMS` 单行内联，无响应式/溢出菜单/汉堡，「资产」与「资产库」近义混淆。→ 主导航（工作台/画布/加字幕）+ 「更多 ▾」次级；窄屏折叠汉堡；重命名区分。
- **表单校验**：[Login.tsx:19-22](apps/client/src/pages/Login.tsx#L19-L22) react-hook-form 无 `mode:'onBlur'`，错误只在提交后整块显示，无字段级提示；Workspace 必填项禁用按钮但无「为何禁用」提示。→ `mode:'onBlur'` + 字段下提示 + 禁用原因 title。
- **无快捷键 / 批量 / 撤销**：无全局 keymap（Cmd/Ctrl+Enter 生成）、记录无多选批量删、[NodeDetailPanel.tsx:38-52](apps/client/src/components/canvas/NodeDetailPanel.tsx#L38-L52) shot prompt 编辑即时 PATCH 无撤销。→ 绑定 Cmd/Ctrl+Enter；记录多选；节点编辑加防抖 + 保存指示 + 本地撤销栈。
- **a11y**：图标按钮（通知/删除/复制/关闭）缺 `aria-label`，动态状态无 `aria-live`，自定义 `<button>`（阶段按钮等）无 `focus-visible` 样式。→ 仅图标按钮补 `aria-label`，动态状态包 `aria-live="polite"`，自定义按钮加 focus ring。
- **验收**：Toast 不遮挡核心内容；窄屏导航可用；表单字段级报错；核心操作有快捷键；图标按钮屏幕阅读器可读。

---

## 二、运行时可靠性（生产风险）

> 这些是真实运行中会炸、会资损、会静默错乱的隐患。多数改动小、收益大，应优先处理。

### 2.1 ✅ FFmpeg 操作无超时 / 无强制 kill（已修复）

- **修复**：新增 `ffmpeg-spawn.ts` 封装 `spawnFfmpeg()`，超时默认 10min（env `FFMPEG_TIMEOUT_MS`），`FfmpegTimeoutError` 被 task-engine 分类为 retriable/timeout。compose/audio-extractor/subtitle-burner 全部迁移。（commit 0d6862b0）

### 2.2 ✅ 三套状态机写入无原子性 → crash drift（已修复）

- **修复**：新增 `reconcile.ts`（worker），每轮 poll 后查询 `tasks JOIN canvas_pipeline_runs WHERE task IN (succeeded,failed,cancelled) AND run=running`，将漂移的 run 补标为对应终态。append-only guard 确保幂等。（commit 80b423a6）

### 2.4 ✅ SSE 死连接回收（已修复）

- **修复**：`UserEventHub` 加 `lastActivity` 跟踪 + `sweepStaleConnections(maxIdleMs=60s)` 方法。SSE route 在 30s heartbeat interval 中调用 sweep，清除空闲 >60s 的死连接。（commit 82e9360）

### 2.5 🟡 rate-limit key 可被伪造 + 限流 Map 无 GC

- **证据**：[rate-limit/index.ts:59-64](packages/rate-limit/src/index.ts#L59-L64) `buildRateLimitKey` 用 token 前 50 字符当 user key，且 rate-limit 全局中间件在 auth 之前应用（[app.ts](apps/server/src/app.ts) 链序：rateLimit 在 createAuthPlugin 之前）。恶意客户端轮换伪造 token → 每个 token 独立 bucket → 绕过单用户限流；且全局限流实为 `elysia-rate-limit` 的 LRU（`maxSize: 5000`），轮换 >5000 个伪造前缀会把合法用户的计数驱逐，进一步放大绕过。
- **影响**：限流可被伪造 token 绕过（资损/滥用面）；LRU 驱逐使合法用户限流失效。
- **解法**：限流 key 应在 auth 之后的 `userId` 上构建，无效 token 统一落到 IP bucket（需 trusted proxy 配置防 `x-forwarded-for` 伪造）；适当调高全局 LRU 上限或换带 TTL 的存储。（注：项目自有的 `SlidingWindowRateLimiter` 已在每次 `check()` 按 key 自清理过期窗口，无需额外 sweep。）
- **验收**：伪造 N 个不同 token 的并发请求被收敛到同一 IP bucket；空窗口 key 被周期清理。

---

## 三、架构设计与拓展性

### 3.2 🟠 category 散弹式 ~20 处（新增一种 category 要碰 20 个文件）

- **证据**：`category === '...'` / `switch(category)` 命中遍布：[provider/dashscope-client.ts:905-916](packages/provider/src/dashscope-client.ts#L905-L916) switch、[generate.ts](apps/server/src/routes/generate.ts) 6+ 处、[generation/service.ts](apps/server/src/modules/generation/service.ts)、[notifications.ts:57,72](apps/server/src/services/notifications.ts#L57)（**二元 text/image 判断无 default，会静默漏新 category**）、[assets/service.ts:58-66](apps/server/src/modules/assets/service.ts#L58-L66)（`default: 'text'` 静默兜底）、client `CATEGORY_CONFIG`/`category-labels`/`ModelLab CATEGORY_ORDER`。`audio` 已是合法 `ModelCategory` 但**不在** `generationCategoryEnum` 中——DB 枚举与 provider 枚举已分裂。
- **影响**：新增 category 触碰 ~20 处，且 `notifications.ts` 二元判断会静默漏掉，`assets/service.ts` 静默 fallback 掩盖错误。
- **解法**：把 `VALID_CATEGORIES`、notifications 文案、`genCategoryToKind`、client 地图收敛为以 category 为 key 的注册表/数据表；DB enum 与 shared union 单一源派生；删除静默 fallback，未知 category 显式报错。
- **验收**：新增一个测试 category 只改注册表 1 处；未知 category 不再静默兜底。

### 3.3 🟠 task-engine 反向耦合 workflow 词汇（纯包纪律）

- **证据**：[task-engine/index.ts](packages/task-engine/src/index.ts) `getTaskPriority`（:179-193）与 `computeRetryDelay`（:351-360）用 if 链硬编码具体 type 字符串（`'generate.video'`/`'canvas.videos'`/`'subtitle.asr'`）和子串匹配 `taskType.includes('video')`。源码注释自承这是「straddle workflow-engine vocabulary」。
- **影响**：纯包 `task-engine` 本应与具体业务类型解耦，但优先级/退避里写死了业务 type——新增一个长耗时 type（如 `generate.3d`）必须改 task-engine；`includes('video')` 子串匹配是隐性耦合。
- **解法**：把优先级/退避表抽成**注入的策略对象**（与现有 `*Adapter` 纪律一致），由 app/worker 注入；或声明式 `TASK_TYPE_POLICY: Record<type, {priority, backoff}>` 数据表。
- **验收**：task-engine 不再含任何具体业务 type 字符串；新增 type 只在 app/worker 注入策略。

### 3.4 🟠 配置硬编码：退避 / 优先级 / 限流 / 错误分类双轨

- **证据**：(1) task-engine 退避/优先级见 3.3 的魔数 if 链；(2) [rate-limit/index.ts:46-51](packages/rate-limit/src/index.ts#L46-L51) 全路由共享单一 `DEFAULT_GLOBAL_RATE_LIMIT`，无 per-route 声明式表；(3) 错误分类**两套形状**：task-engine 是 if 链 + inline 字符串比较，[error-recovery/index.ts:112-159](packages/error-recovery/src/index.ts#L112-L159) 是声明式 `Array<{match, domain}>` 表——新增可重试错误码要在两处分别改。
- **影响**：调参需改代码发版；新增限流规则/错误码易漏改其中一套。
- **解法**：统一为「声明式规则 + 纯函数 apply」形状（error-recovery 已是范本）：退避/优先级/限流/错误分类全部表式化；限流支持 per-route 声明。
- **验收**：调参只改数据表/配置不改逻辑；错误分类单一来源。

---

## 四、文件单一职责 / 大文件拆分（接触时顺手做）

> 原则同 CLAUDE.md：**接触相关区域时顺手拆，不专门开冲刺**。下列是当前**仍存在**的过大/职责混乱文件（canvas.ts/Admin.tsx/task-processor.ts 等已拆的不列）。

### 4.1 🟠 generate.ts 生成编排去重（隐式 bug 源，最高 ROI）

- **证据**：[generate.ts](apps/server/src/routes/generate.ts) POST `/generate`（:81-218）与 POST `/records/:id/retry`（:306-429）有 ~110 行 validate→reference→cost→prepare→execute→createTask 几乎逐行复制。
- **影响**：任何生成流程/credit/audit 改动需双改两处，是隐式 bug 源。
- **解法**：抽 `modules/generation/orchestration.ts` 共享编排。
- **验收**：两路径共享同一编排函数；既有 retry/cancel 测试全绿。

### 4.2 🟠 dashscope-client.ts（918 行）拆四模块

- **证据**：[dashscope-client.ts](packages/provider/src/dashscope-client.ts) 全局 hook 注册表 + 纯请求构造器（applyMappings/buildRequestBody）+ SSE 解析器 + Client 类四职责混一处；5 个 fetch 方法各重复 ~30 行 guard/build/observe 骨架；两 SSE 解析器 80% 重叠。
- **影响**：最大文件、跨 server/worker 多人协作点；SSE 解析器无法脱离 client 单测。
- **解法**：抽 `provider-hooks.ts`（observer/guard registry）、`dashscope-request-builder.ts`（纯函数）、`dashscope-sse.ts`（`iterSSEEvents` + 两解析器）；Client 内抽私有 `invokeEndpoint(model, body)` 压缩重复。
- **验收**：Client 收缩至 ~400 行；SSE 解析器可独立单测；既有 provider 测试全绿。

### 4.3 🟠 admin.ts（707 行）路由按子域拆

- **证据**：[admin.ts](apps/server/src/routes/admin.ts) 单文件 17+ 路由跨 6+ 子域（tasks/users/providers/projects/audit/api-keys），且 17 个 handler 内手写 `if (!adminAllowed) return adminDenied()`，`/overview` 还重复了 `canAccessAdmin` 检查。
- **影响**：多人并行改 admin 必撞车；手写守卫重复。
- **解法**：按域拆 `routes/admin/{tasks,users,providers,projects,audit,api-keys,gateway,credit}.ts` + `_shared.ts` 收 helper；auth 守卫下沉到 plugin，handler 直接信任 derive 结果。
- **验收**：admin 路由按域分文件；手写守卫归零；admin 测试全绿。

### 4.4 🟡 其余大组件拆分（接触时）

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

### 4.5 🟡 跨文件重复抽取（接触时）

- **Admin 列表分页模板**：[Admin/ApiKeys.tsx:451-576](apps/client/src/pages/Admin/ApiKeys.tsx#L451-L576) 与 [Admin/Users.tsx:336-473](apps/client/src/pages/Admin/Users.tsx#L336-L473) 逐字复制（debounce + queryParams + refetchInterval 30s + footer + prev/next）。→ 抽 `useAdminListPagination` + `AdminListCard`。
- **API key 表格**：`AdminGatewayKeysTable`（ApiKeys）与 `AdminUserApiKeysSection`（Users）渲染同列。→ 抽 `ApiKeyTable.tsx`。
- **参数输入渲染**：[Workspace.tsx:128-197](apps/client/src/pages/Workspace.tsx#L128-L197) `renderParamInput` 与 [ModelLab.tsx:389-488](apps/client/src/pages/ModelLab.tsx#L389-L488) `renderParam` 对同一 `ModelParameter` 重复实现。→ 抽 `ParameterInput.tsx`。
- **参考图多上传 UI**：Workspace 与 ModelLab 重复虚线框 + 缩略图网格。→ 抽 `ReferenceImageUploader.tsx`。
- **状态集合枚举散落**：`IN_PROGRESS_STATUSES`/`ACTIVE_GENERATION_STATUSES`/`REQUEUEABLE_STATUSES`/`GEN_RUNNING_STATUSES` 在 generation/service、generation-records.repo、admin/tasks、assets/service 各自定义、成员重叠。→ 单一 `@excuse/shared` status-set 模块。
- **验收**：重复收敛为单一来源，导出项均有生产消费者。

---

## 五、可观测性

### 5.1 ✅ traceId 不贯穿统一队列 / Canvas 流水线（已修复）

- **修复**：`tasks` 表加 `traceId` 列（migration 0044）；server（generate.ts/canvas/helpers.ts）创建 task 时透传 traceId；worker（task-handler/pipeline-stepper）日志 + pipeline auto-advance 传播 traceId；`notifyTaskStatusChange` NOTIFY 载荷含 traceId。（commit 7fc1364）

### 5.2 🟡 错误日志 / SSE 可能含 prompt 全文

- **证据**：[dashscope-client.ts](packages/provider/src/dashscope-client.ts) `parseDashScopeError(data)` 进 errorMessage → 进 DB errorMessage → 推 SSE 给前端；[error-recovery/index.ts:270](packages/error-recovery/src/index.ts#L270) 有 `truncate(detail, 500)` 但只在 recovery 分类层。
- **影响**：DashScope 错误响应可能 echo 请求 prompt 片段 → 敏感内容泄露到前端/日志。
- **解法**：errorMessage 入库/入 SSE 前统一截断 + 脱敏（在 DB 写入或 SSE 分发边界层）。
- **验收**：DB/SSE 中的 errorMessage 长度有界且不含原始 prompt 全文。

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

## 本轮总览（截至 2026-06-18）

本轮六维度审计新发现约 40 项，按 ROI 建议推进顺序：

1. **P0（已全部完成 ✅）**：§2.1 FFmpeg 超时 · §2.2 状态机原子化
2. **P1（部分完成）**：§5.1 traceId 贯穿 ✅ · §1.4 上传提示 ✅（草稿待补）· §4.1 generate 去重 · §2.4 SSE 死连接 ✅ · §2.5 rate-limit 加固
3. **P2（治理 / 打磨）**：§3.2 category 注册表 · §3.4 配置表式化 · §1.1 骨架屏 · §1.2 空状态 · §4.2 dashscope 拆分 · §4.3 admin 拆分
4. **接触时顺手**：§1.5 Toast/nav/form/a11y · §4.4-4.5 大文件/去重 · §5.2 错误脱敏
5. **暂缓**：§六 多租户 / i18n / Redis 限流（待路线图）

已修复并清理：流水线 12 阶段（原 §1.3 ✅）、task 锁 heartbeat（原 §2.3 ✅）
