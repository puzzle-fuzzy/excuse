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

可扩展 `docker-compose.yml` 添加 server 和 worker 服务：

```yaml
services:
  server:
    build: .
    command: bun --env-file .env apps/server/src/index.ts
    env_file: .env
    ports:
      - "5007:5007"
    depends_on:
      - postgres

  worker:
    build: .
    command: bun --env-file .env apps/worker/src/index.ts
    env_file: .env
    ports:
      - "5100:5100"
    depends_on:
      - postgres
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
