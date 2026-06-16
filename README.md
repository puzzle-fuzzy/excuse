# Excuse

> 让想象力拥有生产力

基于 Bun + ElysiaJS + React 的全栈 AI 内容生成平台，集成阿里云百炼（DashScope）多模态模型，支持文本、图像、视频生成，并提供从故事文本到成片的 Canvas 自动化流水线与基于 ASR 的字幕烧录管线。

## 技术栈

- **Runtime**: [Bun](https://bun.sh)
- **Server**: [ElysiaJS](https://elysiajs.com) — 类型安全的 HTTP 框架
- **Client**: [React 19](https://react.dev) + [Vite](https://vite.dev) + [Tailwind CSS 4](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com)
- **Database**: [PostgreSQL 16](https://www.postgresql.org) + [Drizzle ORM](https://orm.drizzle.team)
- **AI Provider**: 阿里云百炼 / DashScope（通义千问文本、通义万相图像、Wan 2.7 / HappyHorse 视频、ASR 语音识别）
- **存储**: 阿里云 OSS（可选，默认本地文件系统）
- **异步任务**: 统一 `tasks` 任务队列 + Worker 轮询（claim/lock/heartbeat/retry，Canvas 流水线由 Worker 自动推进）
- **实时推送**: PostgreSQL LISTEN/NOTIFY → SSE
- **类型安全通信**: [@elysia/eden](https://elysiajs.com/eden/overview) treaty 模式
- **Auth**: JWT + bcrypt + API Key（`exc_` 前缀）
- **日志**: [Pino](https://getpino.io) 结构化日志 + 脱敏

## 项目结构

```
excuse/
├── apps/
│   ├── client/     React 前端 SPA（Vite + shadcn/ui，端口 8007）
│   ├── server/     ElysiaJS 后端 API（端口 5007）
│   └── worker/     后台任务 Worker — 统一任务队列 + Canvas 流水线推进 + 视频/字幕轮询
├── packages/
│   ├── shared/           跨应用类型定义 + Pino Logger（基础层）
│   ├── db/               Drizzle ORM Schema + Repository + Services（PostgreSQL）
│   ├── provider/         DashScope 客户端 + 模型声明配置 + ASR 客户端
│   ├── storage/          OSS / 本地文件存储
│   ├── ffmpeg/           FFmpeg 音视频处理（抽音频、烧字幕、媒体探测）
│   ├── billing/          费用计算（Token / 图像 / 视频秒数 / 音频）+ 统计
│   ├── canvas-engine/    Canvas 领域逻辑（连贯性、schema）
│   ├── canvas-runtime/   Canvas 阶段执行（phases/）+ LLM 辅助 + 归一化
│   ├── prompt-engine/    提示词构建 + JSON 抽取
│   ├── task-engine/      纯规则：统一任务生命周期（claim/lock/retry/失败，通过 Adapter 注入）
│   ├── workflow-engine/  纯规则：Canvas 阶段顺序 + pipeline run 状态 + 自动推进
│   ├── events/           纯规则：SSE 分发 + PG NOTIFY 载荷解析
│   ├── gateway/          纯规则：OpenAI 兼容网关请求/响应归一化
│   ├── metrics/          纯规则：指标采集（状态码/延迟分位数）
│   ├── rate-limit/       纯规则：滑动窗口限流 + 429 响应
│   ├── subtitle-engine/  纯规则：字幕样式预设 + ASS 生成 + ASR 解析
│   └── auth/             纯规则：API Key 哈希/创建/前缀识别（SHA-256）
├── scripts/        脚本工具
└── docs/           文档
```

> **架构约定**：`task-engine`、`workflow-engine`、`events`、`gateway`、`metrics`、`rate-limit`、`subtitle-engine`、`auth` 是**纯规则包**——只依赖 `shared` 与标准库，不直接访问 DB / provider / 应用运行时；需要 IO 时由应用实现 `*Adapter` 接口并注入。这让纯规则可在隔离环境下单测，详见 [CLAUDE.md](./CLAUDE.md)。

## 快速开始

```bash
# 安装依赖
bun install

# 启动 PostgreSQL
docker compose up -d

# 配置环境变量
cp .env.example .env
# 编辑 .env 填入 DASHSCOPE_API_KEY、JWT_SECRET 等

# 运行数据库迁移
cd packages/db && bun run db:migrate && cd ../..

# 启动开发环境（server + client + worker）
bun run dev
```

- 前端访问: http://localhost:8007
- 后端 API: http://localhost:5007/api
- API 文档（OpenAPI）: http://localhost:5007/openapi
- Worker 健康检查: http://localhost:5100

## 脚本

| 命令 | 说明 |
|------|------|
| `bun run dev` | 同时启动 server + client + worker |
| `bun run dev:server` | 仅启动后端 |
| `bun run dev:client` | 仅启动前端 |
| `bun run dev:worker` | 仅启动 worker |
| `bun run build` | 构建 server + worker + client |
| `bun run typecheck` | 跨 server / client / worker 类型检查 |
| `bun run test` | Bun 测试（server, worker, 所有 packages） |
| `bun run test:client` | Vitest 前端测试 |
| `bun run test:all` | 运行全部测试 |
| `bun run test:db` | packages/db 数据库测试（需 PG） |
| `bun run test:coverage` | 测试覆盖率 |
| `bun run lint` | ESLint 检查 |
| `bun run lint:fix` | ESLint 自动修复 |

### 单包 / 单文件测试

```bash
# 跑某个 package 的测试
bun test --cwd packages/workflow-engine
bun test --cwd apps/worker

# 跑单个测试文件
bun test apps/server/test/auth-routes.test.ts

# 跑单个前端测试（在 apps/client 下）
cd apps/client && bun vitest src/__tests__/some.test.tsx
```

### 数据库命令（在 `packages/db` 目录下）

| 命令 | 说明 |
|------|------|
| `bun run db:generate` | 根据 Schema 变更生成迁移文件 |
| `bun run db:migrate` | 执行迁移 |
| `bun run db:push` | 直接推送 Schema（仅开发环境） |
| `bun run db:studio` | 打开 Drizzle Studio GUI |

> 注意：`packages/db` 的脚本内部用 `bun --env-file ../../.env <file>` 执行（不是 `bun run`），因为 `--env-file` 只在直接执行文件时生效。

## 文档

- [AGENTS.md](./AGENTS.md)（`CLAUDE.md` 为其符号链接）— 面向 AI 编程助手的架构与约定详解
- [docs/](./docs) — 计划文档（`TODO.md` 为唯一入口）与外部 API 资料

## License

[MIT](./LICENSE)
