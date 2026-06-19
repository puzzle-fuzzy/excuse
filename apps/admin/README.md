# apps/admin — Excuse 管理端后台

运营控制台：用户、任务、计费/余额、Provider、Gateway 客户、审计日志（[PRODUCT_DEVELOPMENT_BLUEPRINT](../../PRODUCT_DEVELOPMENT_BLUEPRINT.md) Phase 2）。

技术栈与用户端一致：**React 19 + Vite + Tailwind CSS v4 + shadcn/ui（radix-nova）+ React Router v7 + TanStack Query + Eden Treaty**。从 `apps/client` 的 `/admin` 模块迁出为独立应用，建立更严格的 auth 边界与独立部署目标。

## 运行

```bash
# 在 monorepo 根目录
bun run dev:admin    # → http://localhost:8008
bun run dev          # 同时启动 server/client/worker/site/admin
bun run build        # 含 admin 构建（tsc -b && vite build）
```

dev server 经 `/api` 代理到 `apps/server`（5007），与用户端共用同一 httpOnly cookie 会话——管理员在用户端登录后可直接进入后台，反之亦然。

## 鉴权

- **服务端守卫**：`/api/admin/*` 由 `apps/server/src/routes/admin/index.ts` 的 `.resolve` 守卫，要求 JWT 主体出现在 `ADMIN_USER_IDS` 环境变量中，否则 403。
- **客户端表现**：非管理员登录后访问根路由，`fetchAdminOverview()` 会 403，Admin shell 渲染「无权访问」提示，指向 `ADMIN_USER_IDS`。
- 管理后台不支持自助注册（登录页仅有登录入口）。

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `ADMIN_USER_IDS` | — | 逗号分隔的管理员账户 ID（server 侧；后台访问白名单） |
| `VITE_API_BASE_URL` | 同源 | API 基址；本地缺省回落 `http://localhost:5007` |

## 结构

```
src/
  api/           api-core（Eden 客户端 + unwrapEden，无 SSE）/ auth-api / admin（运营 API）/ client（barrel）/ query-client
  auth/          AuthContext / AuthProvider（无 SSE）/ ProtectedRoute
  pages/         Login / Admin/（index shell + Overview/Users/ApiKeys/Audit/Projects/Providers + shared）
  components/    ui（shadcn 基元）/ auth/AuthPageShell / PasswordInput / theme-provider / ErrorBoundary
  lib/           utils / admin-format / category-labels / generation-utils(formatCents) / form-schemas(login)
```

## 与 `apps/client` 的关系

本应用是 `apps/client/src/pages/Admin/` 的独立化迁移：6 个 tab（概览 / 用户 / Provider / 项目 / Gateway 客户 / 审计）+ 共享层 + API 层均原样移植，仅做以下裁剪：

- 移除 SSE / react-query devtools / web-vitals / client-logger / error-report（运营内部工具不需要）。
- `api-core` 的 token 仅内存留存（不联动 `sseClient`）。
- `query-client` 全局错误改 console 兜底（不上报）。
- 路由收敛为「登录 + 根控制台」。

## 已知缺口（Phase 2 范围外，后续补齐）

- **禁用/启用用户**：`accounts.isActive` 仍只读，无 endpoint/UI。
- **任务 requeue/cancel 审计**：两处 mutation 未写 audit_logs。
- **管理端余额流水**：仅有 `credit/add` 充值，无 admin 侧 ledger 列表 / 人工调账 / 退款标记。
- **测试**：暂未引入 vitest（移植代码已由 `apps/client` 测试覆盖）。
