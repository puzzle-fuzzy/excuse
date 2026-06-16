# Excuse 项目上线前审核报告

审核时间：2026-06-12
审核范围：全项目源码（apps/server、apps/client、apps/worker、packages/*）
审核方式：逐文件阅读核心代码，非文档驱动

---

## 项目现状概述

Excuse 是一个全栈 AI 多模态内容生成平台，架构成熟度远超一般 MVP：

- 3 个运行时进程：Elysia API Server（5007）、Vite React SPA（8007）、Task Worker（5100）
- 20 个 packages，边界清晰（events、metrics、gateway、rate-limit、provider-health、task-engine、workflow-engine、canvas-runtime、subtitle-engine 等）
- 22 个 DB schema 表，31 个增量 migration
- 完整的 Credit 计费闭环（reserve → debit | refund + usage_events 审计）
- 完整的实时推送链路（PG NOTIFY → events 包 → sse-manager → fetch-event-source）
- Provider 断路器降级（连续失败自动 degraded + 3s TTL 缓存 + ModelDegradedError 快速失败）
- 统一任务队列 + 孤儿恢复 + heartbeat + pipeline auto-advance
- 管理后台六大维度（任务/用户/Provider/项目/审计/Gateway 客户）
- 通知系统 7 种类型 + 冷却去重 + SSE 实时推送
- Docker 多 target 部署（build/runtime 分离、worker 内置 FFmpeg、healthcheck）
- 端到端类型安全（Drizzle → shared → Eden treaty → React，全链路几乎无 `as any`）

---

## 上线阻断项（必须解决）

### 1. 用户无法充值 — 计费系统是「只有扣款没有入账」的半成品

**问题描述：**

`credit_transactions` 表的 `credit_transaction_type` 枚举已定义 `credit` 和 `admin_adjust` 两种入账类型，但代码中**没有任何充值入口**：

- `apps/server/src/routes/billing.ts` 只有 statistics / balance / transactions 三个只读查询端点
- `apps/client/src/pages/Billing.tsx` 只展示费用统计，没有余额展示、没有充值按钮
- 搜索整个代码库没有任何 Stripe / Alipay / WeChat Pay 集成代码
- `admin_adjust` 类型在业务代码中从未使用

**后果：** 新用户注册后余额为 0，所有生成立即被 `CreditError: INSUFFICIENT_BALANCE` 拒绝。系统无法产生任何真实业务。

**建议：**
- 最低可行方案（1~2 天）：补一个 admin 手动充值端点 `POST /api/admin/credit/add`，管理后台增加充值操作入口
- 正式方案（5~7 天）：接入支付宝/微信支付，用户自助充值
- 过渡方案：新用户注册时赠送初始额度（如 10 元 = 1000 cents）

---

### 2. 没有密码重置和邮箱验证 — 账号体系不完整

**问题描述：**

`apps/server/src/routes/auth.ts` 只有 4 个端点：register / login / logout / me。

- 没有 forgot-password 流程（生成 reset token → 发邮件 → 重置密码）
- 没有邮箱验证（注册后直接返回 token，邮箱是否真实未确认）
- 没有 OAuth / 社交登录
- 密码忘记后只能让管理员直接操作数据库

**后果：** 用户忘记密码后无法自助恢复，运营压力大；虚假邮箱可注册。

**建议：**
- 上线前（1 天）：至少加密码重置端点 + 简单邮件发送（可用 nodemailer 或 DashScope 的邮件服务）
- 邮箱验证可以后续迭代（初期运营可人工审核）

---

## 上线后尽快解决（P1）

### 3. Health 端点不可用于生产探针

**问题描述：**

`apps/server/src/routes/health.ts` 只有一个 `GET /api/health` 端点：

- DB 挂了时返回 `{ status: 'degraded', db: 'error' }` 但 HTTP 状态码仍是 200
- 没有 `/health/ready`（DB 不可达时应返回 503，让负载均衡摘除）
- 没有 `/health/live`（进程卡死时 liveness 探针应该 fail）
- 没有 migration version 检查
- Worker 的 health 端点只检查 `isPolling`，不检查 DB claim 能力

Docker HEALTHCHECK 命令只检测 HTTP 200，degraded 状态也会通过检查。

**后果：** K8s / 负载均衡无法区分「正常服务」和「DB 挂了但进程活着」，故障时流量仍然打过来。

**建议（半天）：**
- 增加 `/api/health/ready`：DB ping 失败 → 503
- 增加 `/api/health/live`：始终 200（仅检测进程存活）
- Docker HEALTHCHECK 改为检测 `/api/health/ready`

---

### 4. Billing 页面不展示余额

**问题描述：**

后端 `billing.ts` 已经有 `GET /api/billing/balance` 和 `GET /api/billing/transactions` 端点，但前端 `Billing.tsx` 只调用了 `fetchBillingStatistics()`，没有展示：

- 当前余额（availableCents / frozenCents）
- 交易流水（reserve / debit / refund / credit 历史）

**后果：** 用户不知道账户还有多少钱，也不知道每笔钱花在了哪里。

**建议（半天）：** 在 Billing 页面顶部增加余额卡片 + 底部增加交易流水列表。

---

### 5. CI 口径与本地验收不一致

**问题描述：**

`.github/workflows/ci.yml` 的 test job 只运行了 5 个目录的测试：
- `apps/server/test`
- `apps/worker/test`
- `packages/provider/test`
- `packages/billing/test`
- `packages/shared/test`

缺失的测试目录：
- `packages/canvas-engine/test`
- `packages/canvas-runtime/test`
- `packages/task-engine/test`
- `packages/workflow-engine/test`
- `packages/events/test`
- `packages/metrics/test`
- `packages/gateway/test`
- `packages/rate-limit/test`
- `packages/provider-health/test`
- `packages/ffmpeg/test`
- `packages/subtitle-engine/test`
- `packages/db/test`（需要 PG service）
- `packages/auth/test`

同时缺少：
- `bun run build`（server/worker typecheck）
- `bun run check:boundaries`
- Docker build 验证

**后果：** PR 通过了 CI，但某个 package 可能已经编译失败或测试不过，到部署时才发现。

**建议（1 天）：** CI 改为复用根脚本 `bun run test`（覆盖所有 package），增加 build job 和 Docker build job。

---

### 6. nginx 缺少 HTTPS 和上传大小限制

**问题描述：**

项目自带的 `nginx.conf`：
- 只 listen 80，没有 HTTPS/TLS 配置
- 没有 `client_max_body_size`（上传大文件可能被 Nginx 默认的 1MB 限制拒绝）
- 没有 HSTS header

`docs/deployment.md` 中的参考配置提到了 `Strict-Transport-Security` 和 `client_max_body_size 200m`，但项目实际 `nginx.conf`（被 Docker `client` target 使用）没有这些。

**后果：** Docker 部署时用户密码和 JWT 可能明文传输；大文件上传被 Nginx 拒绝。

**建议（半天）：** 在 `nginx.conf` 中增加 `client_max_body_size 200m`；HTTPS 可通过 CDN/LB 终止，但文档需明确说明。

---

## 体验改进（P2）

### 7. 用户侧错误恢复 UX 没有分类映射

**问题描述：**

`Workspace.tsx`、`CanvasEditor.tsx`、`SubtitleEditor.tsx` 等页面，生成失败时用户看到的是一个原始 `errorMessage` 字符串。没有区分：

- 余额不足 → 应引导充值
- Provider 参数错误 → 应引导修改 prompt
- 内容安全审核拒绝 → 应引导修改内容
- 网络/Provider 超时 → 应引导重试
- 模型降级 → 应引导换模型或等待恢复

**后果：** 用户拿到 "DashScope error: Throttling.RateQuota" 或 "DataInspectionFailed" 完全不知道该怎么办。

**建议（2~3 天）：** 建立统一错误分类 → UX action 映射，在失败卡片上展示可操作的按钮（重试 / 修改 prompt / 充值 / 换模型）。

---

### 8. 限流是纯内存的 — 多实例部署形同虚设

**问题描述：**

`packages/rate-limit/src/index.ts` 的 `SlidingWindowRateLimiter` 代码注释明确写道：

> 状态不跨进程：多副本部署时实际配额 = 实例数 × maxRequests

全局 60 req/min 的限流在多 server 实例下直接翻倍。API Key 的 per-key 限流也一样（`plugins/auth.ts` 中的 `apiKeyRateLimiter` 也是进程内 `SlidingWindowRateLimiter`）。

**后果：** 单实例部署可以接受；但如果水平扩展到多实例，限流失效。

**建议（1~2 天）：** 需要多实例时迁移到 Redis + Lua 脚本，保持现有接口不变。

---

### 9. canvas.ts 路由文件 899 行 — 维护风险

**问题描述：**

`apps/server/src/routes/canvas.ts` 是整个项目最大的单文件（899 行），包含：
- 项目 CRUD
- 10 个 pipeline 阶段执行端点
- 角色/场景/镜头的 PATCH/DELETE
- 布局保存、模型偏好、重试等辅助操作

虽然注释清晰、模式统一（并发守卫 + fireAndForget + 归属校验），但后续迭代时改动风险高。

**建议：** 拆分为 `canvas-crud.ts`、`canvas-phases.ts`、`canvas-resources.ts` 三个文件。

---

### 10. 缺少端到端冒烟测试

**问题描述：**

项目有完善的单元测试和集成测试（~1400 条），但缺少从浏览器视角验证的 E2E 测试：

- 登录 → 创建生成任务 → 等待 SSE 推送 → 查看结果
- 创建 Canvas 项目 → 跑完 pipeline 阶段 → 查看镜头视频
- 创建 API Key → 调用 Gateway → 验证扣款

SSE 重连、httpOnly cookie 刷新、React Query cache invalidation 等跨层行为很难靠单测覆盖。

**建议（3~5 天）：** 引入 Playwright，使用 test DB + fake provider adapter，最小冒烟集覆盖注册/登录/文本生成/Canvas 创建。

---

## 已做得好的能力（不需要改动）

| 能力 | 代码证据 |
|------|---------|
| Provider 断路器降级 | `services/provider-health.ts` — DB 记录 + 进程内缓存 + ModelDegradedError 快速失败 |
| 统一任务队列 | worker `claimNextTask` + heartbeat + orphan sweep + pipeline auto-advance |
| Credit 计费闭环 | reserve → debit/refund，CreditError，usage_events 审计，双扣双退唯一索引 |
| 端到端类型安全 | Drizzle schema → shared DTO → Eden treaty → React store，全链路 ~13 处 as any 集中在测试 helper |
| SSE 实时推送 | PG NOTIFY → events 包桥接 → sse-manager → fetch-event-source 带指数退避重连 + polling fallback |
| 生产安全基线 | `validateProductionConfig` 拒绝开发默认 JWT；admin 只允许 JWT 不允许 API Key；禁用账号拦截 |
| Docker 部署 | build/runtime 分离，server/worker/client 三 target，healthcheck，.dockerignore |
| 管理后台 | 任务/用户/Provider/项目/审计/Gateway 客户六大维度 + 跨进程 metrics 聚合 |
| 通知系统 | 7 种通知类型 + 冷却去重（6h/24h） + SSE 实时推送 + 前端铃铛 |
| 包边界治理 | `check:boundaries` 脚本拦截 forbidden import，shared 恢复为 base layer |

---

## 上线最低清单汇总

| 序号 | 项目 | 级别 | 预估工作量 | 阻断上线？ |
|------|------|------|-----------|--------------|
| 1 | 用户充值/初始额度 | P0 | 1~7 天 | **是** |
| 2 | 密码重置 | P0 | 1 天 | **是** |
| 3 | Health readiness 探针 | P1 | 半天 | 否 |
| 4 | Billing 页面展示余额 | P1 | 半天 | 否 |
| 5 | CI 补齐全部测试 + build | P1 | 1 天 | 否 |
| 6 | nginx HTTPS + body size | P1 | 半天 | 否 |
| 7 | 错误分类 → UX action | P2 | 2~3 天 | 否 |
| 8 | 限流 Redis 化 | P2 | 1~2 天 | 仅多实例时 |
| 9 | canvas 路由拆分 | P2 | 半天 | 否 |
| 10 | E2E 冒烟测试 | P2 | 3~5 天 | 否 |

**结论：第 1 条（用户充值）是唯一真正的上线阻断项。** 其余都是「体验不好但能用」的级别。建议先花 1~2 天补上 admin 充值 + 密码重置，即可进入内测阶段。
