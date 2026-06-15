# 项目统一 TODO

更新时间：2026-06-14

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

`excuse` 后续最重要的方向不是继续堆生成按钮，而是从“AI 内容生成工具”升级为“AI 创作生产平台”。

当前优先级：

1. Canvas 主体验稳定：自动执行、实时回显、资产复用、失败可恢复。
2. 产品化能力决策：Credit、Notification、Audit、Gateway、Metrics、API Key。
3. 资产中心、Model Lab、管理后台、开发者中心。
4. packages 和成熟库治理：减少手写通用能力，避免长期维护成本。

## P0：Canvas 可信赖创作工作台

待办：（已全部完成 — 资产轮询已迁移到 react-query 统一 cache invalidation，见 `apps/client/src/hooks/use-canvas-assets-polling.ts`。）

验收：

- 自动执行全部不会因刷新丢状态。
- 图片/视频完成后无需刷新即可回显。
- SSE 不可用时 polling fallback 能收敛到正确状态。
- 用户能看到当前阶段、任务队列、失败原因和成本摘要。

## P1：资产中心和创作资产复用

目标：让生成结果从一次性输出变成可管理、可复用、可组合的创作资产。

### 1. 资产中心升级

待办：

- ✅ 回收站/恢复能力 UI（第一版：生成记录和 Canvas 资产支持软隐藏，资产列表默认排除隐藏项；commit: `1be3ce9`）。
- ✅ uploaded_files metadata 编辑（重命名、用途更新；commit: `a0e5c4f`）。
- ✅ 高级筛选 UI 优化：排序（commit: `dd888e5`）、收藏（commit: `efeaa11`）、标签（commit: `f74b9bb`）。颜色/重命名/使用计数等扩展留待后续。

验收：

- 用户能找到之前生成过的素材。
- 用户能从资产中心回到对应 Canvas 项目或镜头。
- 删除/隐藏策略不会误删仍被项目引用的资产。

### 2. 参考资产复用

验收：

- 用户能明确知道当前镜头用了哪些参考图。
- 多参考图生成视频时，模型选择不会出现明显不兼容。
- 批量应用不会重复添加同一 assetId/url。

## P2：产品化能力决策和验收

目标：让 Credit、Notification、Audit、OpenAI Gateway、Metrics、API Key 有明确产品状态和验收闭环。

### 1. Credit 计费闭环

当前状态：部分完成；Canvas 前置阶段已决策为 beta/free quota，暂不进 credit。

待办：

- 如果未来 Canvas 前置阶段改为收费，需要为每个 provider 调用建立 reserve/debit/refund 策略。
- 补齐 Canvas 全链路计费端到端测试，仅在正式收费前执行。
- 成本展示可以保留 beta/free quota 文案，避免误导用户。

验收：

- 所有正式收费路径都能证明 reserve、debit、refund 三段闭环。
- 用户能看到失败任务是否扣费或退款。

### 2. Notification

待办：

- API Key 过期、额度不足、异常调用等系统风险通知。

验收：

- 用户不在 Canvas 页面时，也能知道生成完成、失败或余额不足。
- 通知能定位到具体问题或产物。

### 3. Audit

待办：

- ✅ 决策：管理后台展示 audit。
- ✅ 决策：notification 读取、全部已读等用户行为不进 audit；参照 favorite toggle 等高频内部操作。下一轮如产品要求再开任务。
- ✅ 管理后台新增「审计日志」tab：`GET /api/admin/audit-logs` 接口（按 action / accountId / 时间范围过滤分页）+ admin UI tab（仅展示，不做删除/修改）。

验收：

- 权限、资金、外部 provider 调用、资源删除、批量自动化动作均有审计策略。
- 审计 payload 使用明确 DTO，不落入随意 JSON 堆叠。
- 运营人员在管理后台可按 action / 用户 / 时间范围检索审计记录。

### 4. OpenAI Gateway

当前状态：streaming + usage 查询已完成，开发者文档已更新；scope/quota/rate-limit 已完成（2026-06-15）。

待办：

- ✅ 决策：正式开放给用户。
- ✅ Gateway scope、quota、rate limit 实现（api_keys 表新增 scope/rate_limit_per_minute/quota_max_cents/total_spend_cents 列；per-key 限流器 + scope 门禁 + 额度检查；管理后台配置端点；用户端 UI 展示）。
- ✅ 开发者文档页面已完善：streaming 标记已支持、Python 示例、用量概览展示、文本模型定价表。
- ✅ 开放策略和计费模式已明确：正式开放 + 按 Token 计费 + beta 阶段不扣费。
- ✅ provider 调用 service 提取：`apps/server/src/services/gateway-service.ts` 统一编排 credit/record/audit/provider 调用生命周期。

验收：

- 用户能自助查阅开发者文档、创建凭证、调用 Gateway。
- 不出现”后端已经暴露，但用户看不懂怎么用”的半成品状态。

### 5. Metrics / Health

当前状态：开发级可用，生产级不足。

待办：

- ✅ provider 错误率、模型耗时（`excuse_provider_calls_total{model,status}` + `excuse_provider_latency_seconds{model,quantile}`，in-process collector + DashScopeClient observer hook 注入）（commit: `9b0a37a`）。
- ✅ 任务队列积压、Canvas 阶段耗时（`excuse_task_queue_depth` + `excuse_canvas_phase_total` / `excuse_canvas_phase_duration_seconds`，DB-derived，commit: `30c5d41`）。
- ✅ 线上排障检查命令或文档（`docs/metrics.md` §线上排障检查；cover 7 个场景：存活/DB/Worker/积压/Provider/Canvas/HTTP；commit: `0df806f`）。
- ✅ Prometheus 指标当前是 server 进程内单实例；跨 worker 进程聚合待后续推进。

验收：

- 部署时能回答服务是否存活、DB 是否可用、worker 是否工作、任务是否积压、provider 是否异常。

### 6. API Key 产品化

待办：

- ✅ 决策：随 OpenAI Gateway 一起开放，作为 Gateway 鉴权方式。
- ✅ API Key scope、rate limit、quota 实现（scope: 'all'|'gateway'; per-key 滑动窗口限流; quota_max_cents + total_spend_cents 额度追踪; Gateway 路由 scope/rate-limit/quota 门禁; 管理后台配置端点 `PATCH /api/admin/api-keys/:id/config`）。
- ✅ lastUsedAt 使用统计增强（schema 已有 `last_used_at` 字段；auth plugin 在 API Key 鉴权成功后 fire-and-forget 调 `touchApiKeyLastUsed`；管理后台 `GET /api/api-keys` 已返回 `lastUsedAt` 字段）（commit: `5cdaaf3` 起完整可用）。
- ✅ Gateway 路由对接 API Key 鉴权（auth plugin 链路完整；scope/rate-limit/quota 检查在 Gateway 路由层完成；开发者文档展示 scope 选项）。

验收：

- 用户能自助创建、复制、撤销、查看使用说明。
- API Key 能限制 scope（模型/端点）、rate limit 和 quota。
- 开发者可以用 API Key 通过 `Authorization: Bearer <key>` 调用 Gateway。

## P3：Model Lab、管理后台和运营能力

### 1. Model Lab

待办：

- ✅ Canvas 新项目消费 Model Lab 默认模型偏好（新建项目时读 localStorage `excuse:model-lab:canvas-defaults`，过滤非空字段后调既有 `PATCH /api/canvas/projects/:id/model-preferences` 写入 `modelPreferencesJson`；方案 B 最小改动，零 server / db / api helper 改动；commit: `0255323`）。

验收：

- 新模型接入时可以先在 Model Lab 验证，不污染正式 Canvas 流程。

### 2. 管理后台

待办：

- ✅ 项目细粒度检索（admin 新增「项目」tab + `GET /api/admin/projects`：按标题搜索、状态过滤、分页，显示镜头数 / 完成数 / 模型偏好；commit: `b0f5983`）。
- 任务队列细粒度检索、失败重排和运行中取消已完成；后续补项目级检索和跨业务状态联动修复。
- ✅ 用户级用量和成本统计（admin 后台新增「用户」tab + 用户详情：余额 / 30 天成本趋势 / 模型分解 / 最近记录；commit: `1c5dfeb`）。
- 失败任务深度诊断（最近失败摘要、tasks 队列检索和基础恢复操作已完成；generation record / Canvas pipeline run 级联诊断待补）。
- ✅ 失败任务深度诊断 — Canvas pipeline run 级联（admin 后台新增 `GET /api/admin/tasks/:id` 单任务详情 endpoint，`getAdminTaskDetail` JOIN `canvas_pipeline_runs.taskId = tasks.id`，返回 pipeline run 时间线 phase/status/durationMs/errorMessage/outputSummary；Admin.tsx 任务行点击「详情」展开 dialog + 重排/取消按钮；commit: `86ca4b4`）。generation record 级联因数据模型阻塞（`tasks.generationRecordId` 字段声明但代码库无写入路径，恒为 null；`generation_records.taskId` 是 provider 字符串 ID 非 tasks uuid）—— 待后续补 `tasks.generationRecordId` 写入路径或改用 accountId+时间窗口间接关联。
- ✅ provider 错误率和模型成本统计（admin 后台新增「Provider」tab，DB 聚合 + server 进程内 metrics 合并 avg/p50/p95 latency；commit: `1c5dfeb`）。
- ✅ API Key 管理（管理后台用户详情中展示 API Key 列表：前缀/名称/状态/最近使用/创建时间；`GET /api/admin/users/:id/api-keys` 端点 + `AdminUserApiKeysSection` 组件）。Gateway 客户管理、scope/quota/rate-limit 联动待后续补。
- 长列表建议使用 `@tanstack/table-core` / `@tanstack/react-virtual`，不要手写复杂表格状态。

验收：

- 出现用户问题时，运营能定位任务、资产、扣费、错误原因。

## P4：基础设施和通用能力治理

目标：减少手写通用能力；能用成熟库的用成熟库，确实需要业务边界的沉淀到 package。

### 1. 成熟库优先使用计划

优先级：

1. `lodash-es/debounce`、`lodash-es/throttle` 或 `use-debounce`
   - 用于资产搜索、项目选择器、参考资产选择弹窗、Canvas 刷新节流。
   - 前端不要引整个 `lodash`，优先按需引 `lodash-es` 或 hook 库。

2. `@tanstack/react-query`
   - 用于资产中心、Canvas 项目详情、字幕项目、Billing、通知列表。
   - SSE 只做“有变化”通知，收到事件后 invalidate query。
   - 减少手写 loading/error/refetch/cache 状态。
   - ✅ Canvas 资产轮询、PipelineController 兜底轮询已迁移到 react-query。

3. `react-hook-form`
   - 用于登录注册、模型偏好、字幕样式、上传表单、API Key 创建、Model Lab 参数表单。
   - 减少散落的 `useState`、校验、提交中状态和错误显示。
   - ✅ Login、Register、Model Lab 参数表单已迁移到 react-hook-form + zod（commit: `7f587f2`）。ApiKeys 创建表单上轮已用 `useForm`；Workspace 用 zustand store 管理、SubtitleEditor 是 patch-on-change 模式（非表单 submit），本轮均跳过。

4. `zod` / `valibot` / `arktype`
   - 用于 AI 输出、LLM JSON、Gateway 请求、复杂配置、跨模块 DTO 的运行时校验。
   - Elysia route schema 可以保留，不强行替换。
   - ✅ packages/gateway + packages/prompt-engine 已完成第一批迁移（commit: `e797419`）。
   - ✅ canvas-engine LLM 输出校验器 zod 化 + canvas-runtime phases 迁移 + server regenerate 迁移已完成（commits: `600e0cf`、`e8c47f7`）。

5. `p-limit` / `p-queue`
   - 用于单个任务内部的批量上传、下载、生成、持久化并发控制。
   - 不替代 `packages/task-engine`；只处理“任务内部并发”。

6. `date-fns`
   - 用于资产筛选时间、Billing 趋势、任务更新时间、中文时间格式化。
   - 等时间逻辑继续变复杂时再引，不急。

7. `dompurify`
   - 仅在未来展示 AI 生成 Markdown/HTML 时引入。
   - 如果一直渲染纯文本，不需要。

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

### 2. Package 治理剩余事项

待办：

- 媒体处理任务化：视频合成、字幕烧录、缩略图提取等耗时操作必须走 worker task，成功后进入统一资产模型。（待实现）
- ✅ Storage 与 Asset 分层：`packages/storage` 只负责对象存取（`AssetStorage` 仅提供 OSS/本地存储）；资产记录、业务绑定、SSE 通知由 worker/service 完成。`@excuse/provider` 为方便 re-export `AssetStorage`，分层边界清晰。
- ✅ Events：domain event 与 user notification 分层已定型（generation_status / notification 两通道，SSE 桥接由 events package 统一处理）。业务 service 通过 notifyNotifyGeneration/notifyNotification 发布 domain event，不直接关心 SSE。
- ✅ Workflow / Task：pause/resume/cancel/retry 的纯规则 guard 函数已完善（`canPausePipelineRun` / `canResumePipelineRun` / `canCancelPipelineRun` / `canRetryPipelineRun`）。`cancel` 有完整 adapter 实现；`pause`/`resume` adapter 接口已定义（`TaskPauseAdapter` + `pauseTaskWithAdapter`/`resumeTaskWithAdapter`），DB migration 待实际需要时补入。
- ✅ Prompt / Canvas Engine：四个阶段（analysis / characters / locations / storyboard）+ server regenerate 已迁移为 `parseLLMJsonWithSchema` + 导出了 4 个 zod schema（commits: `600e0cf`、`e8c47f7`）。
- ✅ Gateway streaming adapter + usage/credit 协议测试已完成。开发者文档已更新（streaming 标记已支持、Python 示例、用量概览展示）。Provider 调用 service 提取到 package 待后续推进。

验收：

- app 层只保留 route、auth glue、任务创建、响应映射。
- package 不依赖 Elysia、React，不直接读写 HTTP request。
- package 内纯规则有独立单元测试（✅ 第一批：`canvas-failure.ts` 41 条 + `error.ts` 17 条，100% 覆盖率；commit: `2c7234e`）。

## P5：测试体系与可注入设计

测试补齐原则见 `docs/测试覆盖率分析.md`：不追 100%，只补高 ROI 路径。

高 ROI 待补：

1. ✅ `apps/server/src/modules/canvas/*` 阶段处理器 helper（`canvas-service-helpers.test.ts` 18 条，覆盖 `getTextModel` / `getImageModel` / `getVideoModel` / `assertNotGenerating`；commit: `0e3a1ef`）。
2. ✅ `apps/client/src/api/client.ts` 纯函数（`client-api.test.ts` 5 条，覆盖 `getActivePipelineRun`；`unwrapEden`/`normalizeApiBaseUrl` 等未导出暂无法独立单测；commit: `0e3a1ef`）。

不建议补：

- shadcn UI 基础组件。
- FFmpeg CLI 包装的纯 mock。
- DashScope 完整 mock。

验收：

- 测试能覆盖真实失败路径。
- 不为了覆盖率数字添加脆弱断言。
- Worker handler 使用依赖注入，不直接 import 全局 DB/provider。

## P6：参考项目迁移要点

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

## 推荐执行顺序

1. ✅ 成熟库治理第一批：React Query 迁移、debounce 改造 —— 已完成。
2. ✅ Model Lab 内部实验页、Canvas 新建项目消费默认偏好 —— 已完成。
3. ✅ 管理后台和运营统计：全局概览、任务诊断、用户级用量、provider 统计、pipeline run 级联详情、审计日志 tab —— 已完成。
4. ✅ Gateway / API Key / Audit 产品化决策 —— 已完成。
5. ✅ Package 治理剩余项：events 分层已定型、workflow pause/resume adapter 接口已定义、Gateway streaming + usage + 开发者文档已补齐。
6. Gateway + API Key 开放实现：scope / quota / rate limit、API Key 鉴权链路、Gateway 客户管理。
7. Metrics / Health 生产级可观测性（跨进程聚合）。
8. Package 治理深化：媒体处理任务化、Storage/Asset 分层、Gateway provider 调用 service 提取。

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

完成定义：

- 命令通过，或明确说明失败原因与是否由本轮改动引起。
- `rg any` 只允许出现在注释说明、tsconfig 模板注释或第三方声明不可控场景。
- 每个独立待办完成后，必须提交对应 git commit，不混入其他待办；完成记录和 commit 写入根目录 `CHANGELOG.md`，不要写回 TODO。
