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
| `JWT_SECRET` | JWT 签名密钥（≥32 字符，不能使用开发默认值） |
| `FRONTEND_URL` | 生产前端域名，用于 CORS allowlist |
| `METRICS_ACCESS_TOKEN` | `/metrics` 和 worker `/provider-calls` 的 Bearer token；当 metrics CIDR 公开时必填 |
| `WORKER_METRICS_URL` | server 聚合 worker provider latency 时使用，如 `http://localhost:5100` |

详见 `.env.example` 获取完整列表。

### 生产安全基线

服务启动时会执行生产配置门禁：

- `NODE_ENV=production` 时，`DATABASE_URL`、`DASHSCOPE_API_KEY`、`FRONTEND_URL`、`JWT_SECRET` 必须显式配置。
- `JWT_SECRET` 必须至少 32 字符，且不能使用 `.env.example` 中的开发默认值。
- `METRICS_ALLOWED_CIDRS` 如果配置为 `0.0.0.0/0`、`::/0` 或 `*`，必须同时设置 `METRICS_ACCESS_TOKEN`。
- Worker 同样会检查 `DATABASE_URL`、`DASHSCOPE_API_KEY`，以及公开 metrics CIDR 时的 token。

管理后台访问规则：

- 仅 JWT 登录用户可访问 `/api/admin/*`。
- 用户 `account.id` 必须出现在 `ADMIN_USER_IDS` 中。
- API Key 不允许访问管理后台，即使该 Key 属于管理员账户。
- 禁用用户无法通过 JWT 或 API Key 继续访问受保护接口。

上传安全规则：

- `/api/upload` 仅允许 `PNG/JPEG/WebP/GIF/MP4/WebM/MOV/AVI`，最大 200MB。
- 存储 key 由服务端生成；客户端传入的原始文件名只作为元数据保存。
- 删除上传文件前会检查字幕项目和生成记录引用，使用中的文件不能删除。

### 数据库迁移、备份和回滚

生产环境只允许 migration-only 流程，不使用 `db:push`。推荐发布顺序：

```bash
# 1. 记录当前版本
git rev-parse HEAD

# 2. 备份数据库（文件名建议带日期、环境和 commit）
mkdir -p backups
pg_dump "$DATABASE_URL" --format=custom --file "backups/excuse_$(date +%Y%m%d_%H%M%S)_$(git rev-parse --short HEAD).dump"

# 3. 在启动新 server/worker 前执行 migration
bun run --cwd packages/db db:migrate

# 4. 检查资产引用与本地 storage 一致性（只读）
bun run check:assets -- --fail-on-issues

# 5. 启动或重启 server / worker / client
```

失败处理：

- `db:migrate` 失败：停止发布，不启动新进程；保留日志并使用备份恢复到发布前状态。
- 新进程启动失败且 migration 已成功：优先回滚应用镜像/代码；如果 schema 变更不兼容旧代码，使用发布前备份恢复数据库后再回滚应用。
- 高风险 schema 变更必须拆成 expand / migrate / contract 三步：先加兼容字段或表，再迁移数据，最后删除旧结构。

恢复命令示例：

```bash
pg_restore --clean --if-exists --dbname "$DATABASE_URL" backups/excuse_YYYYMMDD_HHMMSS_commit.dump
```

资产一致性检查：

```bash
bun run check:assets
bun run check:assets -- --json
bun run check:assets -- --storage-root=/data/excuse/uploads --fail-on-issues
```

报告类型：

- `missing_file`：DB 记录指向本地 storage 文件，但文件不存在。
- `dangling_file`：本地 storage 文件没有被 `generation_records`、`canvas_assets` 或 `uploaded_files` 引用。
- `hidden_but_referenced`：已隐藏的生成记录或 Canvas 资产仍被 Canvas shot 参考资产引用。

当前脚本默认只检查可映射到 `PUBLIC_UPLOAD_BASE_PATH`（默认 `/api/uploads`）的本地文件；OSS URL 和 provider 临时 URL 会被列为 `skipped`，不作为失败处理。

### Nginx 配置参考

```nginx
server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 200m;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

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
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
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

    # Metrics 不建议公网暴露；如必须经反代访问，需叠加 IP allowlist 与 Bearer token。
    location = /metrics {
        allow 127.0.0.1;
        deny all;
        proxy_pass http://127.0.0.1:5007/metrics;
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

健康检查（生产用 readiness / liveness 探针，不要只用综合 `/health`）：

```bash
# Server — readiness（DB 不可达或存储不可写时返回 503）
curl http://localhost:5007/api/health/ready
# Server — liveness（进程存活即 200，不依赖 DB，K8s 据此判断是否重启）
curl http://localhost:5007/api/health/live
# Server — DB 专用探针（仅探测数据库）
curl http://localhost:5007/api/health/db
# Server — 综合状态（DB 挂时仍返回 200，仅 status=degraded，不适合做摘流判断）
curl http://localhost:5007/api/health

# Worker — readiness（最近 poll 失败或轮询停滞时返回 503）
curl http://localhost:5100/health/ready
# Worker — liveness（进程存活即 200）
curl http://localhost:5100/health/live
# Worker — 综合运行状态（poll error 也返回 200，不适合做摘流判断）
curl http://localhost:5100/health

curl http://localhost:8007
```

### 探针接线（Kubernetes / systemd / 反向代理）

探针语义：

- **liveness** = 「进程是否卡死」→ 失败应**重启**容器/进程。只看进程能否响应，不看 DB。
- **readiness** = 「是否能接活」→ 失败应**摘除流量**但不重启。DB 不可达、存储不可写、worker poll 失败都应判 not ready。
- 综合端点（`/health`、worker `/health`）即使下游故障也返回 200，**不要**用于 readiness。

**Kubernetes** 探针建议：

```yaml
# Server deployment
livenessProbe:
  httpGet: { path: /api/health/live, port: 5007 }
  periodSeconds: 10
  failureThreshold: 3
readinessProbe:
  httpGet: { path: /api/health/ready, port: 5007 }
  periodSeconds: 5
  failureThreshold: 2

# Worker deployment
livenessProbe:
  httpGet: { path: /health/live, port: 5100 }
  periodSeconds: 10
  failureThreshold: 3
readinessProbe:
  httpGet: { path: /health/ready, port: 5100 }
  periodSeconds: 5
  failureThreshold: 2
```

> 注：worker 没有「入口流量」，readiness 探针主要作用是让 HPA/监控识别 worker 是否健康（DB claim 失败会自检 not ready），而 liveness 决定是否重启卡死的 poll 循环。

**systemd**：用 `ExecStartPost` + 周期 `Type=notify` 或独立的 watchdog 脚本 curl `/ready`，失败时 `systemctl restart`。Dockerfile 已内置 `HEALTHCHECK`（server→`/api/health/ready`，worker→`/health/ready`），`docker ps` 与 `docker compose ps` 会显示 health 状态。

**反向代理（Nginx）**：对 server upstream 用主动健康检查（`proxy_next_upstream` + 健康检查模块）探测 `/api/health/ready`，503 时自动摘除该后端。

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
bun run db:push            # 直接推送 schema（仅开发用，生产禁止）
bun run db:studio          # Drizzle Studio GUI

# 资产一致性
bun run check:assets       # 只读检查本地 storage 与 DB 资产引用

# 代码质量
bun run lint
bun run lint:fix
```
