# 部署指南

## 架构概览

本项目是 Bun monorepo，包含三个独立进程：

| 进程 | 入口 | 端口 | 说明 |
|------|------|------|------|
| **Server** | `apps/server/src/index.ts` | 5007 | ElysiaJS API 服务 |
| **Client** | `apps/client/` | 8007 | Vite + React SPA（开发模式；生产为静态文件） |
| **Worker** | `apps/worker/src/index.ts` | 5100（health/metrics） | 后台任务轮询、Canvas 流水线推进、视频/ASR/字幕任务处理 |

**重要**：Server 和 Worker 的 `build` 脚本执行 TypeScript typecheck，不产出 bundle；生产运行仍直接以 Bun 执行 TypeScript 入口文件。

## 环境要求

- **Bun** >= 1.3（运行时 + 包管理器）
- **PostgreSQL** >= 16（推荐通过 Docker）
- **Node.js** 不需要

## 快速开始

### 1. 安装依赖

```bash
bun install
```

### 2. 启动 PostgreSQL

```bash
docker compose up -d
```

默认连接：`postgres://excuse:excuse_dev@localhost:5433/excuse`

> `docker compose up -d` 默认只启动开发 PostgreSQL。完整生产式容器编排使用 `prod` profile，见下方 Docker 部署。

### 3. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入 DASHSCOPE_API_KEY 等必填项
```

### 4. 初始化数据库

```bash
cd packages/db
bun run db:push    # 开发环境直接推送 schema
# 或
bun run db:migrate # 运行 migration
```

### 5. 启动开发服务

```bash
bun run dev        # 同时启动 server + client + worker
# 或分别启动
bun run dev:server
bun run dev:client
bun run dev:worker
```

## 生产部署

### 运行方式

Server 和 Worker 以 Bun 直接运行 TS 入口，无需预编译：

```bash
# Server
NODE_ENV=production bun --env-file .env apps/server/src/index.ts

# Worker
NODE_ENV=production bun --env-file .env apps/worker/src/index.ts
```

Client 构建为静态文件，由 Nginx 等反向代理托管：

```bash
bun run build:client
# 产出在 apps/client/dist/
```

### 环境变量（生产必填）

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | PostgreSQL 连接串 |
| `DASHSCOPE_API_KEY` | DashScope API 密钥 |
| `JWT_SECRET` | JWT 签名密钥（≥32 字符） |
| `METRICS_ACCESS_TOKEN` | `/metrics` 和 worker `/provider-calls` 的可选 Bearer token |
| `WORKER_METRICS_URL` | server 聚合 worker provider latency 时使用，如 `http://localhost:5100` |

详见 `.env.example` 获取完整列表。

### Nginx 配置参考

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 前端静态文件
    location / {
        root /path/to/apps/client/dist;
        try_files $uri $uri/ /index.html;
    }

    # API 反向代理
    location /api/ {
        proxy_pass http://127.0.0.1:5007;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # SSE 长连接
    location /api/sse {
        proxy_pass http://127.0.0.1:5007;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }
}
```

### 进程管理

推荐使用 systemd 或 pm2 管理进程：

```bash
# 使用 pm2 示例
pm2 start "bun --env-file .env apps/server/src/index.ts" --name excuse-server
pm2 start "bun --env-file .env apps/worker/src/index.ts" --name excuse-worker
```

### Docker 部署（可选）

仓库内 `Dockerfile` 提供三个明确 target：

| Target | 说明 | 默认命令 |
|--------|------|----------|
| `server` | Elysia API runtime | `bun --env-file .env apps/server/src/index.ts` |
| `worker` | 后台任务 worker runtime | `bun --env-file .env apps/worker/src/index.ts` |
| `client` | Nginx 托管的前端静态文件 | Nginx 默认前台进程 |

镜像构建采用 build/runtime 分离：build 阶段安装完整依赖并构建 client，runtime 阶段只安装生产依赖；仅 worker runtime 额外包含 FFmpeg。

单独构建：

```bash
docker build --target server -t excuse-server .
docker build --target worker -t excuse-worker .
docker build --target client -t excuse-client .
```

完整本机编排：

```bash
docker compose --profile prod up --build
```

使用生产覆盖文件（读取 `DB_PASSWORD`、`DB_PORT`、`HTTP_PORT` 等变量）：

```bash
docker compose --profile prod -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

该命令会启动：

- `postgres`：PostgreSQL 16，host 端口 `5433`
- `server`：API，host 端口 `5007`
- `worker`：health/metrics，host 端口 `5100`
- `client`：Nginx + SPA，host 端口 `8007`

compose 中 server/worker 会把 `DATABASE_URL` 覆盖为容器网络内的 `postgres:5432`；其他密钥仍从 `.env` 读取。

健康检查：

```bash
curl http://localhost:5007/api/health
curl http://localhost:5100/health
curl http://localhost:8007
```

**注意**：不引入 Node.js 运行时兼容路线，所有进程统一使用 Bun。

## 常用命令速查

```bash
# 开发
bun run dev                # 启动全部开发服务
bun run dev:server         # 仅 server
bun run dev:client         # 仅 client
bun run dev:worker         # 仅 worker

# 构建
bun run build              # server typecheck + worker typecheck + client build
bun run build:client       # 仅构建前端

# 测试
bun run test               # bun test（server, worker, packages）
bun run test:client        # vitest（client）
bun run test:all           # 两者都跑

# 类型检查
bun run typecheck          # 全部三个 app

# 数据库
cd packages/db
bun run db:generate        # 从 schema 变更生成 migration
bun run db:migrate         # 执行 migration
bun run db:push            # 直接推送 schema（开发用）
bun run db:studio          # Drizzle Studio GUI

# 代码质量
bun run lint
bun run lint:fix
```
