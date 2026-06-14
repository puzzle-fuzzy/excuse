# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- OpenAI Gateway 用量查询第一版：新增 `GET /v1/usage` 只读接口，返回当前用户最近一段时间的 Gateway 调用聚合摘要（`totalCalls` / `succeededCalls` / `failedCalls` / `totalTokens` / `totalPriceCents`）与最近调用列表（不含 prompt 全文）；Gateway 创建生成记录时写入 `inputParams.source='gateway'` + `requestedModel` 标记，`packages/db` 新增 `listGatewayUsageRecords` repository；`packages/shared` 新增 `OpenAIGatewayUsageItem` / `OpenAIGatewayUsageResponse` DTO（commit: `22cff73`）。
- Canvas 主链路已完成自动执行、实时回显、SSE/polling fallback、阶段状态和失败恢复等关键体验收口（commits: `a2b4c9f`、`e3d6277`、`095d151`、`b123756`、`d73cd15`、`e3dbccb`、`633672c`、`0a79421`、`d783551`、`67f9548`、`cb0fd99`、`2416feb`、`d211790`）。
- 资产中心隐藏策略第一版：生成记录和 Canvas 资产支持软隐藏，资产列表默认排除隐藏项（commit: `1be3ce9`）。
- 参考资产复用链路：镜头参考资产、资产库选择、服务端归属校验、模型变体推荐、批量应用参考资产（commits: `4fb64b3`、`e886876`、`5a3a74f`、`df5ad57`、`c196f66`）。
- API Key 管理入口第一版：列表、创建、secret 只显示一次、复制和撤销确认（commit: `b154a55`）。
- OpenAI Gateway 开发者使用说明入口第一版（commit: `0bcd860`）。
- 资产中心、通知和 Billing 已完成 React Query 试点接入（commit: `e44a8f1`）。
- `packages/ffmpeg`、`packages/storage`、`packages/auth`、`packages/rate-limit`、`packages/metrics`、`packages/subtitle-engine` 等通用能力已完成第一批拆包（commits: `65e775b`、`8ac92b3`、`de60178`、`b575959`、`a80936f`、`a269aa6`）。
- 开发者接入页新增「错误响应」板块：OpenAI 错误响应格式示例 + 7 个公开错误码（`model_not_found`、`invalid_model`、`invalid_parameters`、`insufficient_balance`、`generation_failed`、`stream_not_supported`、`missing_user_message`）的 HTTP 状态、含义和处理建议对照表；前端使用页面局部常量，不依赖 `@excuse/gateway`，避免把服务端协议包打入 client bundle。
- `ShotReferenceAssets` 批量应用参考资产新增最近一次撤销能力：批量应用成功后保存受影响镜头的本地快照（仅组件生命周期内有效），参考资产区展示「撤销上次应用」入口；点击后对每个受影响镜头以 `mode: 'replace'` 回写原始 `referenceAssetsJson`，撤销成功后调用 `onUpdate` 刷新并隐藏入口；撤销失败保留快照可重试。快照只覆盖服务端实际 `result.applied` 的镜头，避免被跳过的镜头被错误回滚。
- 资产中心支持编辑上传文件：新增 `PATCH /api/upload/:id`，支持重命名和用途更新，强制 accountId 隔离并写 `audit('file_update', ...)`；Assets 页面 PreviewModal 新增「编辑」入口（仅 uploaded_file 来源显示），编辑成功后刷新列表（commit: `a0e5c4f`）。`auditActionEnum` 追加 `file_update` 值（同时补齐 `asset_hide` 漏写的 migration 0025）。
- 资产中心列表新增排序能力：`GET /api/assets` 支持 `sort` 查询参数（`created_desc` 默认 / `created_asc` / `title_asc` / `title_desc`），合并 generation_records / canvas_assets / uploaded_files 三来源后统一排序，非法值静默回落 created_desc；`packages/shared` 新增 `AssetLibrarySort` 联合类型并在 `AssetLibraryQuery` 追加 `sort` 字段；Assets 页面筛选区新增排序下拉，与既有 URL ↔ state 同步逻辑一致（commit: `<本轮 hash>`）。
- OpenAI Gateway `/v1/chat/completions` 支持流式响应（`stream: true`），第一版仅支持 openai-chat 协议模型（如 `qwen3.7-plus`）；新增 DashScope client `chatCompletionStream` async generator、`packages/gateway` 新增 `createOpenAIStreamChunk` / `serializeOpenAIStreamChunk` / `OPENAI_STREAM_DONE` helper 与 `STREAMING_MODEL_NOT_SUPPORTED` 错误码；`normalizeOpenAIChatRequest` 不再拒绝 stream=true，改为透传 stream 字段；route 流式分支保留 reserve / markSucceeded / debit / refund / audit / ownership 隔离（commit: `a3ab011`）。

### Testing

- 补齐 `apps/server/src/modules/generation/output-parser.ts` 测试（commits: `b86c727`、`97bf1ca`）。
- 补齐 `packages/provider/src/model-validator.ts` 边界测试（commit: `97bf1ca`）。
- OpenAI Gateway 错误码常量与测试矩阵：`packages/gateway` 新增 `OPENAI_GATEWAY_ERROR_CODES`，route 与 `normalizeOpenAIChatRequest` 全部替换为常量；route 层补未知模型 / 非文本模型 / stream / 缺 user message / 参数校验失败 / provider 失败（含 refund 断言）/ 余额不足七条错误码响应测试（commit: `6b1026f`）。

### Changed

- `ShotReferenceAssets` 参考资产选择器搜索改用 `use-debounce`（300ms）替代手写 `setTimeout`；保留弹窗打开守卫、并发保护与单次 trim 语义，新增 debounce 后再请求、弹窗未打开不请求两条测试覆盖（commit: `d128b59`）。
- `packages/gateway` 新增 `mapGatewayUsageItem` / `aggregateGatewayUsage` 纯函数，OpenAI Gateway `/v1/usage` route 不再内联聚合 / 映射逻辑；新增 `packages/gateway/test/usage.test.ts` 覆盖状态分桶、token 部分缺失、价格回落、requestedModel 类型守卫（commit: `cb6804c`）。

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
