# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- 管理后台只读概览第一版：新增 `ADMIN_USER_IDS` 配置控制 `/api/admin/*` 访问，`packages/db` 新增 `getAdminOverview` 聚合 repository，`packages/shared` 新增 Admin Overview DTO，`apps/server` 新增 `GET /api/admin/overview` 返回用户数、生成记录/失败数、总成本、活跃任务、活跃 Canvas 项目、生成状态分布、Canvas 状态分布、任务队列深度与最近失败摘要；`apps/client` 新增 `/admin` 管理后台页面和导航入口，使用 react-query 30s 刷新并展示概览卡片、状态分布、队列深度与最近失败表；补 server admin route 测试和 client admin page 测试。
- 管理后台任务运维第一版：`packages/task-engine` 新增 `canRequeueTask` / `canCancelTask` 纯状态守卫；`packages/db` admin repository 新增 `listAdminTasks` / `requeueAdminTask` / `cancelAdminTask`，支持按 status/domain/search 查询 tasks 队列，并对 failed/retrying/queued 执行清锁清错重排、对 queued/running/retrying 执行取消；`apps/server` 新增 `GET /api/admin/tasks`、`POST /api/admin/tasks/:id/requeue`、`POST /api/admin/tasks/:id/cancel`，继续受 `ADMIN_USER_IDS` 限制；`apps/client` `/admin` 新增任务诊断区，支持筛选、搜索、15s 自动刷新、手动刷新、重排和取消操作；补 task-engine、server admin route、client admin page 测试。当前操作只作用于统一任务队列，不级联修复 generation record 或 Canvas pipeline run 状态。
- OpenAI Gateway 用量查询第一版：新增 `GET /v1/usage` 只读接口，返回当前用户最近一段时间的 Gateway 调用聚合摘要（`totalCalls` / `succeededCalls` / `failedCalls` / `totalTokens` / `totalPriceCents`）与最近调用列表（不含 prompt 全文）；Gateway 创建生成记录时写入 `inputParams.source='gateway'` + `requestedModel` 标记，`packages/db` 新增 `listGatewayUsageRecords` repository；`packages/shared` 新增 `OpenAIGatewayUsageItem` / `OpenAIGatewayUsageResponse` DTO（commit: `22cff73`）。
- Canvas 主链路已完成自动执行、实时回显、SSE/polling fallback、阶段状态和失败恢复等关键体验收口（commits: `a2b4c9f`、`e3d6277`、`095d151`、`b123756`、`d73cd15`、`e3dbccb`、`633672c`、`0a79421`、`d783551`、`67f9548`、`cb0fd99`、`2416feb`、`d211790`）。
- 资产中心隐藏策略第一版：生成记录和 Canvas 资产支持软隐藏，资产列表默认排除隐藏项（commit: `1be3ce9`）。
- 参考资产复用链路：镜头参考资产、资产库选择、服务端归属校验、模型变体推荐、批量应用参考资产（commits: `4fb64b3`、`e886876`、`5a3a74f`、`df5ad57`、`c196f66`）。
- API Key 管理入口第一版：列表、创建、secret 只显示一次、复制和撤销确认（commit: `b154a55`）。
- OpenAI Gateway 开发者使用说明入口第一版（commit: `0bcd860`）。
- Model Lab 内部实验页第一版：新增 `/model-lab` 受保护页面与导航入口，基于 provider 暴露的 `ModelConfig.parameters` 动态渲染 `react-hook-form` 参数表单，支持文本 / 图片 / 视频 / 字幕分类切换、模型选择、prompt 与媒体参数输入、参考素材上传、请求 JSON 预览、真实 `generate` 实验提交、同 prompt 多模型对比、结果 / 原始记录 / 成本展示；新增本地 Canvas 默认模型偏好保存能力（text/image/video 模型映射到 `CanvasModelPreferences`，可保存当前模型并应用回 Lab 当前分类）；补 `model-lab-page.test.tsx` + `model-lab-presets.test.ts` 覆盖模型加载、提交参数、多模型对比、默认偏好保存 / 合并 / 应用与错误状态。
- 资产中心、通知和 Billing 已完成 React Query 试点接入（commit: `e44a8f1`）。
- `packages/ffmpeg`、`packages/storage`、`packages/auth`、`packages/rate-limit`、`packages/metrics`、`packages/subtitle-engine` 等通用能力已完成第一批拆包（commits: `65e775b`、`8ac92b3`、`de60178`、`b575959`、`a80936f`、`a269aa6`）。
- 开发者接入页新增「错误响应」板块：OpenAI 错误响应格式示例 + 7 个公开错误码（`model_not_found`、`invalid_model`、`invalid_parameters`、`insufficient_balance`、`generation_failed`、`stream_not_supported`、`missing_user_message`）的 HTTP 状态、含义和处理建议对照表；前端使用页面局部常量，不依赖 `@excuse/gateway`，避免把服务端协议包打入 client bundle。
- `ShotReferenceAssets` 批量应用参考资产新增最近一次撤销能力：批量应用成功后保存受影响镜头的本地快照（仅组件生命周期内有效），参考资产区展示「撤销上次应用」入口；点击后对每个受影响镜头以 `mode: 'replace'` 回写原始 `referenceAssetsJson`，撤销成功后调用 `onUpdate` 刷新并隐藏入口；撤销失败保留快照可重试。快照只覆盖服务端实际 `result.applied` 的镜头，避免被跳过的镜头被错误回滚。
- 资产中心支持编辑上传文件：新增 `PATCH /api/upload/:id`，支持重命名和用途更新，强制 accountId 隔离并写 `audit('file_update', ...)`；Assets 页面 PreviewModal 新增「编辑」入口（仅 uploaded_file 来源显示），编辑成功后刷新列表（commit: `a0e5c4f`）。`auditActionEnum` 追加 `file_update` 值（同时补齐 `asset_hide` 漏写的 migration 0025）。
- 资产中心列表新增排序能力：`GET /api/assets` 支持 `sort` 查询参数（`created_desc` 默认 / `created_asc` / `title_asc` / `title_desc`），合并 generation_records / canvas_assets / uploaded_files 三来源后统一排序，非法值静默回落 created_desc；`packages/shared` 新增 `AssetLibrarySort` 联合类型并在 `AssetLibraryQuery` 追加 `sort` 字段；Assets 页面筛选区新增排序下拉，与既有 URL ↔ state 同步逻辑一致（commit: `dd888e5`）。
- OpenAI Gateway `/v1/chat/completions` 支持流式响应（`stream: true`），第一版仅支持 openai-chat 协议模型（如 `qwen3.7-plus`）；新增 DashScope client `chatCompletionStream` async generator、`packages/gateway` 新增 `createOpenAIStreamChunk` / `serializeOpenAIStreamChunk` / `OPENAI_STREAM_DONE` helper 与 `STREAMING_MODEL_NOT_SUPPORTED` 错误码；`normalizeOpenAIChatRequest` 不再拒绝 stream=true，改为透传 stream 字段；route 流式分支保留 reserve / markSucceeded / debit / refund / audit / ownership 隔离（commit: `a3ab011`）。
- OpenAI Gateway `/v1/chat/completions` 流式响应扩展到 chat 协议模型（qwen-max / qwen-plus / qwen-turbo / qwen-long）；DashScope client `chatCompletionStream` 自动按 `requestType` 分派 OpenAI 兼容 / DashScope 原生 SSE parser；route stream 分支不再限制模型协议，所有文本模型都支持 `stream=true`（commit: `c813e48`）。
- Metrics 指标新增 Prometheus text exposition 格式输出：`packages/metrics` 新增 `serializePrometheus` / `snapshotToPrometheus` 纯函数（counter / gauge 基本类型 + label 字典序 + 值转义）；`apps/server` 新增 `GET /metrics` 端点（无 `/api` 前缀，符合 Prometheus 标准）；访问策略 v1：默认仅允许回环地址（`127.0.0.0/8` + `::1`），配置 `METRICS_ACCESS_TOKEN` 后必须通过 `Authorization: Bearer <token>` 鉴权；`apps/server/src/config.ts` 新增 `metricsAccessToken` + `metricsAllowedCidrs` 配置；指标命名统一加 `excuse_` 前缀（`excuse_http_requests_total` / `excuse_http_latency_seconds` / `excuse_sse_online_users` / `excuse_generation_total` / `excuse_errors_total` / `excuse_uptime_seconds`）；`docs/metrics.md` 补最小化 Prometheus 接入说明（commit: `95540d3`）。
- 资产中心列表新增收藏能力：新建 `asset_favorites` 表（用户级收藏，复合唯一约束 `(accountId, source, assetId)`），migration `0026_fuzzy_baron_zemo.sql`；`GET /api/assets` 支持 `favorite=true` 过滤并在每条 `AssetLibraryItem` 注入 `isFavorite` 字段（一次性查回 favorite key 集合后内存匹配，避免逐条 SQL）；新增 `POST /api/assets/:source/:id/favorite` 与 `DELETE` 两个 toggle 端点（幂等，跨 generation_record / canvas_asset / uploaded_file 三种来源；不进 audit，避免触碰既有 `auditActionEnum`）；Assets 页面卡片新增星标按钮（乐观更新 + 失败回滚 + invalidate query）+ 筛选区新增「仅看收藏」开关，与既有 URL ↔ state 同步逻辑一致（commit: `efeaa11`）。
- Prometheus 指标扩展（DB 派生）：`packages/metrics` 新增纯聚合函数 `aggregateCanvasPhaseMetrics` + `aggregateTaskQueueMetrics`（接 SQL 聚合行 → Prometheus metric family，pure 无 DB 依赖）；`packages/db` 新增 `metrics.repo.ts` 提供 `getCanvasPhaseStats(windowHours=24)`（用 PostgreSQL 原生 `percentile_cont` 算 per-(phase, status) p50/p95/avg duration + count，仅统计 finishedAt IS NOT NULL）+ `getTaskQueueStats()`（per-(domain, status) 即时计数）；`apps/server/src/routes/metrics.ts` `/metrics` 端点并发查两个新 repository 并合并 in-memory snapshot + DB-derived family 输出，新增 metric family `excuse_canvas_phase_total{phase,status}` / `excuse_canvas_phase_duration_seconds{phase,quantile}` / `excuse_task_queue_depth{domain,status}`；DB 查询异常兜底空数组，不阻塞 in-memory 输出；补 packages/metrics db-derived 单元测试（空输入 / succeeded-only duration / 单位转换 / 类型守卫）+ apps/server metrics DB-derived mock 测试（commit: `30c5d41`）。
- Prometheus 指标扩展（provider 错误率 + 模型耗时）：`packages/metrics` 的 `MetricsCollector` 新增 `recordProviderCall(model, durationMs, success)` in-process 计数方法，`MetricsSnapshot` 新增 `providerCalls` 字段（keyed by model，durations 数组限 1000 样本 FIFO 截断）；新建 `packages/metrics/src/provider-derived.ts` 提供纯聚合函数 `aggregateProviderMetrics`（接 providerCalls → Prometheus metric family `excuse_provider_calls_total{model,status}` + `excuse_provider_latency_seconds{model,quantile}`，pure 无 DB 依赖）；`snapshotToPrometheus` 内部合并 provider metrics；`packages/provider` 的 `DashScopeClient` 新增 module-level `registerProviderCallObserver` hook 机制（不依赖 `@excuse/metrics`，由 app 注入回调），chatCompletion / generateImage / submitVideoTask 三类 public 方法在成功 / HTTP 错误 / 网络异常 / 业务失败（未返回 task_id）路径埋入 model + durationMs + success；`apps/server/src/services/metrics.ts` 新增 `recordProviderCall` 包装；`apps/server/src/index.ts` 启动时一次注册 observer → `metricsCollector.recordProviderCall`（所有 5 处分散实例化的 DashScopeClient 自动覆盖；worker 进程的 provider 调用不聚合到 server metrics，跨进程聚合留给后续 Prometheus federation）；补 packages/metrics provider-derived 单元测试（空输入 / 单 model / 多 model / nearest-rank p50p95 计算 / 单位转换 / 纯函数不可变性）+ packages/provider DashScopeClient observer hook 测试（chatCompletion / generateImage / submitVideoTask 成功 + HTTP 错误 + 网络异常 + 未返回 task_id + 未注册 observer + observer 抛错不影响主流程）+ apps/server metrics-routes 测试扩 provider metric family 输出（commit: `9b0a37a`）。
- 资产中心列表新增标签能力（v1）：新建 `asset_tags`（用户级标签定义，复合唯一 `(accountId, name)`）+ `asset_tag_assignments`（多对多关联，复合唯一 `(accountId, tagId, source, assetId)`，`tag_id` ON DELETE CASCADE）两张表，migration `0027_productive_exiles.sql`；新增独立 route `apps/server/src/routes/asset-tags.ts` 提供 `GET / POST / DELETE /api/asset-tags` 标签 CRUD（POST 重名 23505 → 409，DELETE 幂等）；扩 `GET /api/assets` 支持 `tagIds` 查询参数（逗号分隔，OR 关系）并在每条 `AssetLibraryItem` 注入 `tagNames` 字段（一次性查回 tagRows + assignmentKeys 后内存匹配）；新增 `POST/DELETE /api/assets/:source/:id/tags/:tagId` assign/unassign 端点（幂等，跨三来源，assign 校验 tag 所有权）；Assets 页面新增「标签管理」modal（创建 / 列表 / 删除 + ConfirmDialog）+ 卡片标签区（前 3 个 Badge + `+N` + popover 多选打标）+ 筛选区标签多选下拉；不进 audit，与 favorite toggle 一致（commit: `f74b9bb`）。
- 通知点击定位收口：`NotificationMeta` 新增 `shotId` 字段（仅 TypeScript interface 扩展，不动 DB schema）；`apps/worker/src/task-processor.ts` 在 task_completed / task_failed / 超时失败三处通知推送时，如果 record 来自 Canvas 链路（`inputParams.source='canvas'`），meta 自动追加 `projectId + shotId`；新建 `apps/client/src/lib/notification-target.ts` 把通知跳转逻辑抽为纯函数（`resolveNotificationTarget`），优先级 projectId+shotId → `/canvas/:projectId?focus=shot:<shotId>` > projectId → `/canvas/:projectId` > recordId → `/?record=<recordId>` > undefined；Navbar.tsx 改用新 lib，dropdown UI 不变；补 worker task-processor notifyUser meta 测试 + client notification-target 纯函数测试（commit: `82ce120`）。
- worker 资金类操作审计收口：新建 `apps/worker/src/services/audit.ts` 轻量 audit helper（仿 server 但路径独立，依赖 `@excuse/db` 的 `createAuditLog`，支持 writer 注入与 NODE_ENV=test 禁用）；`apps/worker/src/task-processor.ts` 三处资金调用伴随 audit — 成功扣款（`actualCost.totalPriceCents > 0` 时）→ `credit_debit`、失败退款 / 超时退款（`record.cost.totalPriceCents > 0` 时）→ `credit_refund`，detail 复用既有 `CreditFlowDetail` DTO 并显式标 `source: 'worker_video'`；audit 失败仅 `logger.warn` 不阻塞业务（与 server 行为一致）；补 worker audit helper 单元测试（5 case：注入 / 默认禁用 / reset / writer 抛错 / 无 opts）+ task-processor 调用伴随 audit 测试（6 case：成功 / 失败 / 超时 / 0 元成功 / 0 元失败 / writer 抛错）（commit: `cce4890`）。

### Testing

- 补齐 `apps/server/src/modules/generation/output-parser.ts` 测试（commits: `b86c727`、`97bf1ca`）。
- 补齐 `packages/provider/src/model-validator.ts` 边界测试（commit: `97bf1ca`）。
- OpenAI Gateway 错误码常量与测试矩阵：`packages/gateway` 新增 `OPENAI_GATEWAY_ERROR_CODES`，route 与 `normalizeOpenAIChatRequest` 全部替换为常量；route 层补未知模型 / 非文本模型 / stream / 缺 user message / 参数校验失败 / provider 失败（含 refund 断言）/ 余额不足七条错误码响应测试（commit: `6b1026f`）。

### Changed

- Gateway 错误响应工厂下沉：`packages/gateway` 新增 6 个语义化错误工厂函数 `modelNotFoundError` / `invalidModelError` / `invalidParametersError` / `missingUserMessageError` / `insufficientBalanceError` / `generationFailedError`，封装 route 层重复的 (message, type, code, status) 四元组；`apps/server/src/routes/openai-gateway.ts` 6 处 `createOpenAIError` 内联调用全部替换为对应工厂（model_not_found / invalid_model / invalid_parameters / missing_user_message / 2 处 insufficient_balance / generation_failed）；`normalizeOpenAIChatRequest` 内 MISSING_USER_MESSAGE 检测也改用 `missingUserMessageError()`；`createOpenAIError` 保留作为低层 API；route 的 status / response / 审计 / 余额逻辑零行为变化；顺手合并 `openai-gateway.ts` 顶部 4 行重复的 `@excuse/shared` type import 修掉 baseline lint 报错；补 `packages/gateway/test/index.test.ts` 7 个工厂单元测试覆盖 status / code / message / response shape（commit: `63c6e9f`）。
- `ShotReferenceAssets` 参考资产选择器搜索改用 `use-debounce`（300ms）替代手写 `setTimeout`；保留弹窗打开守卫、并发保护与单次 trim 语义，新增 debounce 后再请求、弹窗未打开不请求两条测试覆盖（commit: `d128b59`）。
- `packages/gateway` 新增 `mapGatewayUsageItem` / `aggregateGatewayUsage` 纯函数，OpenAI Gateway `/v1/usage` route 不再内联聚合 / 映射逻辑；新增 `packages/gateway/test/usage.test.ts` 覆盖状态分桶、token 部分缺失、价格回落、requestedModel 类型守卫（commit: `cb6804c`）。
- Canvas 资产轮询改造为 react-query：`apps/client/src/hooks/use-canvas-assets-polling.ts` 从手写 `setInterval` + `useState` 重写为 `useQuery` + `refetchInterval` + `invalidateQueries`；自适应间隔逻辑保留（SSE 5s / polling 有 activeTasks 2s / polling 空闲 10s / disconnected 不轮询），由 `refetchInterval` 回调根据 `connectionMode` + `activeTasks` 动态计算；SSE 事件驱动的 `projectVersion` 变化通过 `queryClient.invalidateQueries` 走 react-query 统一失效路径，复用其去重与节流；返回 shape `{ pollData, connectionMode, isPolling, lastPollAt, refresh }` 向后兼容，CanvasEditor 等消费方零改动；`apps/client/src/api/query-client.ts` 新增 `canvasAssetsPollingQueryKeys` 常量；`refetchIntervalFor` 作为纯函数导出便于单测；补 hook 单元测试覆盖 `refetchIntervalFor` 4 种 connectionMode × activeTasks 组合 + projectId 切换 / disconnected enabled / projectVersion invalidate / placeholderData / 返回 shape / refresh 等 12 条（commit: `b5f2c83`）。
- Canvas pipeline-run 兜底轮询改造为 react-query：`apps/client/src/components/canvas/PipelineController.tsx` 原手写 `useEffect` + `setInterval` 轮询逻辑替换为消费新建 hook `useCanvasPipelineRunsPolling`（`apps/client/src/hooks/use-canvas-pipeline-runs-polling.ts`），hook 用 `useQuery` + `refetchInterval=3000` + `placeholderData` 保持上一份数据；命中 succeeded/failed 的状态推进逻辑（按 `activeRunIdRef` 精确 / `phase.key + status` 模糊匹配 + 失败文案 `${phase.label} 失败: ${errorMessage || 未知错误}`）迁移到消费方 watch `runs` 的 useEffect，行为零变化；`apps/client/src/api/query-client.ts` 追加 `canvasPipelineRunsQueryKeys` 常量；`projectVersion` 变化通过 `queryClient.invalidateQueries` 走 react-query 统一失效路径；SSE phaseDone 主路径不变（仍由 useRealtimeSync 直接驱动 onPhaseComplete），polling 仅作为兜底；补 hook 单元测试覆盖 enabled 切换 / projectId 切换 / projectVersion invalidate / placeholderData / 错误兜底 / 返回 shape 等 10 条（commit: `7f48049`）。

## [0.0.1] - 2026-06-11

### Added

- 初始化 Bun monorepo 工作区（apps/* + packages/*）
- **apps/server**: ElysiaJS 后端 API，支持文本/图像/视频生成
- **apps/client**: React 19 + Vite + Tailwind CSS 4 + shadcn/ui 前端 SPA
- **apps/worker**: 后台视频任务轮询器，支持优雅退出
- **packages/db**: Drizzle ORM Schema（accounts、generation_records、uploaded_files）+ Repository 函数
- **packages/provider**: DashScope API 统一客户端 + 阿里云 OSS / 本地双模式存储
- **packages/billing**: 按 Token / 图像 / 视频秒数计费 + 多维度统计
- **packages/shared**: 跨应用类型定义 + Pino Logger 单例
- 用户认证系统：注册、登录、JWT 鉴权（bcrypt 密码哈希）
- 声明式模型配置架构：14 个 AI 模型参数 / 端点 / 定价统一声明，客户端零分支
- 前端媒体上传控件 + r2v 参考图布局
- 生成记录增删查改 + 媒体预览
- 费用统计 API + 前端页面
- 集成 Pino 结构化日志（HTTP 请求日志 + 敏感字段脱敏）
- Docker Compose PostgreSQL 16 开发环境
- 类型安全的 API 通信：`@elysia/eden` treaty 模式
- 后端 CORS + OpenAPI 插件
- ESLint 配置（`@antfu/eslint-config` + React 支持）

### Testing

- 后端测试：bun test + @elysia/eden treaty 模式，覆盖 auth/generate/billing/models 路由
- Worker 测试：config + task-processor（16 tests, 42 assertions）
- Packages 测试：billing、provider、shared 单元测试
- 前端测试：vitest + @testing-library/react + @testing-library/jest-dom
- 测试覆盖率配置（bunfig.toml）

### Changed

- 项目从 "puzzle-engine" 统一品牌更名为 "Excuse"
- 数据库测试从 Proxy mock 改为真实 PostgreSQL
- 使用 Drizzle `InferSelectModel` 推导类型，消除重复定义
- 后端测试文件从 `src/index.test.ts` 迁移至 `test/` 目录
- 后端 `src/index.ts` 导出 `App` 类型，供 Eden 测试和前端类型推导

### Fixed

- 修复百炼 API 参数映射（声明式 inputMapping 替代硬编码分支）
- 修复视频生成后 URL 丢失问题
- 修复 `dev:server` 和 `dev:client` 脚本指向正确的 workspace
- 修复 `concurrently` 命令参数顺序
- 修复 `@excuse/shared` 包 TypeScript 模块解析（添加 `exports` 字段）
- 修复 `kill-ports` 脚本跨平台兼容（Windows + macOS）
