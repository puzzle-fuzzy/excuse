# 项目改进审计 · 补充清单（TODO2）

更新时间：2026-06-18（全部 27 项已完成验收）
来源：对项目全部源码的全面审查，与 `docs/TODO.md` 互补——本文仅收录 **TODO.md 未覆盖**的问题。
已去重项：暗色模式(§3.2)、Navbar 响应式(§4.6)、骨架屏(§4.2)、状态色硬编码(§3.3)、键盘快捷键(§4.6)、Assets/ModelLab/NodeDetailPanel/PipelineController 拆分(§5.4)、Rate limiter Redis(§7)、beforeunload(§4.5) 等已收录于 TODO.md。

## 使用说明

- 严重度图例：🔴 CRITICAL（阻塞生产部署） · 🟠 HIGH（严重影响用户体验或扩展性） · 🟡 MEDIUM（需改进但不阻塞） · 🟢 LOW（优化项）。
- 每项给：**证据**（文件位置）、**影响**、**解法**（可执行步骤）、**验收**。

---

## §一、UI/UX 设计与功能缺失

### 1.1 🟡 MediaPreviewDialog 仅支持图片 — 视频/音频无法预览

- **证据**：[MediaPreviewDialog.tsx](apps/client/src/components/MediaPreviewDialog.tsx) L15 仅渲染 `<img>` 标签。视频 URL 传入时无法播放。
- **影响**：视频生成结果是核心产出，用户点击视频记录预览时只能看到破损的图片标签。
- **解法**：根据 URL 后缀或 MIME 类型判断，视频渲染 `<video controls autoPlay>`，音频渲染 `<audio controls>`，图片保持 `<img>`
- **验收**：视频/音频/图片预览均正常

### 1.2 🟡 登录页缺少"忘记密码"入口

- **证据**：[Login.tsx](apps/client/src/pages/Login.tsx) 仅含"注册"链接，无"忘记密码"。后端 [auth.ts](apps/server/src/routes/auth.ts) L198 已实现 `POST /forgot-password` 完整流程。
- **影响**：用户忘记密码时无法自助重置，需要管理员介入。
- **解法**：Login.tsx 密码字段下方添加 `<Link to="/forgot-password">忘记密码？</Link>`，新建 `ForgotPassword.tsx` 页面
- **验收**：从登录页可跳转忘记密码 → 输入邮箱 → 收到重置链接

### 1.3 🟢 密码输入无可见性切换

- **证据**：[Login.tsx](apps/client/src/pages/Login.tsx) L72-78、[Register.tsx](apps/client/src/pages/Register.tsx) L92-97 的密码字段均为裸 `<Input type="password">`，无 Eye/EyeOff 切换按钮。
- **影响**：用户无法确认输入的密码是否正确（特别是移动端键盘切换时）。
- **解法**：创建 `PasswordInput` 组件包装 Input + Eye 图标按钮，Login/Register/ResetPassword 统一使用
- **验收**：所有密码字段支持可见性切换

---

## §二、用户体验与交互

### 2.1 🟠 错误反馈无分级策略 — catch 仅显示"xxx失败"无具体原因

- **证据**：25+ 处 `catch { toast.error('xxx失败') }` 不区分错误类型：[workspace.ts](apps/client/src/stores/workspace.ts) L250 `catch { toast.error('生成请求失败') }` 不展示具体原因（余额不足？参数错误？网络超时？）；[Canvas.tsx](apps/client/src/pages/Canvas.tsx) L61 同理无重试按钮。
- **影响**：用户操作失败时不知道为什么，也不知道该怎么做。重复点击 → 重复失败 → 用户流失。（注：TODO.md §4.5 覆盖了上传路径的静默吞，本项覆盖更广泛的错误分级缺失。）
- **解法**：
  1. 创建 `useApiMutation` hook 统一处理：自动提取 `error.message` + `error.status`，根据状态码展示不同级别提示
  2. 402 → "余额不足，请充值" + 跳转链接
  3. 429 → "请求过于频繁，请 X 秒后重试"
  4. 500+ → "服务异常，请稍后重试" + 重试按钮
  5. 网络错误 → "网络连接失败" + 检查网络提示
- **验收**：所有 API 调用失败时展示有意义的错误信息和可操作的下一步

### 2.2 🟡 ModelLab 无离开确认 — 复杂表单未保存可丢失

- **证据**：[ModelLab.tsx](apps/client/src/pages/ModelLab.tsx) 含复杂表单（多模型参数对比），切换路由无确认。（注：TODO.md §4.5 覆盖了 Canvas/Workspace 的 beforeunload，ModelLab 未提及。）
- **影响**：用户在 ModelLab 调好 3 个模型的 10 个参数后误触返回，所有输入丢失。
- **解法**：使用 `useBlocker` (react-router v6) 在有未保存更改时拦截导航
- **验收**：ModelLab 有未保存更改时弹出确认对话框

### 2.3 🟡 Billing 交易流水刷新按钮为空操作

- **证据**：[Billing.tsx](apps/client/src/pages/Billing.tsx) L308-315，刷新按钮 `onClick` 回调为空注释 `// invalidate and refetch`，实际无任何逻辑。
- **影响**：用户点击刷新后什么也不发生。
- **解法**：`onClick={() => queryClient.invalidateQueries({ queryKey: ['billing', 'transactions'] })}`
- **验收**：点击刷新按钮后交易列表重新加载

### 2.4 🟡 无全局网络/SSE 连接状态指示器

- **证据**：SSE 断连时 `connectionMode` 变为 `'polling'`，但 UI 无任何视觉指示。用户不知道实时推送已中断。
- **影响**：SSE 断连后用户看到的数据可能有延迟，但完全无感知。Canvas 页面尤其关键——pipeline 进度可能卡住但用户以为还在跑。
- **解法**：
  1. 在 Navbar 或 Canvas StatusBar 中添加连接状态指示器（绿色=实时/黄色=轮询降级/红色=断连）
  2. 断连时显示"实时连接已断开，数据可能有延迟"横幅
- **验收**：SSE 断连后 3 秒内用户可见连接状态变化

### 2.5 🟡 写操作无统一成功反馈

- **证据**：[Canvas.tsx](apps/client/src/pages/Canvas.tsx) 创建项目成功后直接跳转，无 toast 成功提示。[ModelLab.tsx](apps/client/src/pages/ModelLab.tsx) 生成成功后仅更新记录列表，无"生成已提交"toast。
- **影响**：用户不确定操作是否成功，特别是异步操作（Canvas 创建后 pipeline 才开始跑）。
- **解法**：所有写操作（创建/删除/提交）成功后统一 `toast.success()`
- **验收**：创建项目、删除记录、提交生成后均有成功提示

---

## §三、架构设计与代码组织

### 3.1 🟠 client.ts 769 行单文件承载全部 API 定义

- **证据**：[client.ts](apps/client/src/api/client.ts) 769 行，包含认证(4) + 生成(6) + 上传(3) + 计费(3) + 管理(4) + 资产中心(1) + Canvas(25+) + 字幕(7) + Gateway(1) + 资产标签(3) + 主体库(3) = 60+ 函数。（注：TODO.md §5.4 列出了多个需拆分的大文件但未包含 client.ts。）
- **影响**：任何 API 修改都需要在巨文件中搜索。新增功能会让文件继续膨胀。import 行 1 有 200+ 字符的类型导入。
- **解法**：按领域拆分为 `auth-api.ts` / `generation-api.ts` / `canvas-api.ts` / `subtitle-api.ts` / `admin-api.ts` / `gateway-api.ts`，`client.ts` 仅保留 Eden 实例 + `unwrapEden` + re-export
- **验收**：每个 API 文件 < 200 行；`client.ts` < 120 行

### 3.2 🟠 Zustand store 职责不清 — workspace.ts 混合表单状态与业务逻辑

- **证据**：[workspace.ts](apps/client/src/stores/workspace.ts) 331 行，同时管理：模型列表、分类选择、参数表单、参考文件、媒体上传状态、生成提交、重新生成、删除记录。`generation.ts` 与 `workspace.ts` 互相引用（`useGenerationStore.getState()`）。
- **影响**：Store 间循环依赖（workspace → generation, generation → workspace via fetchRecords）。测试困难——submit 需要 mock 整个 workspace state。
- **解法**：
  1. `models-store.ts` — 模型列表 + 分类选择（只读数据）
  2. `generation-form-store.ts` — 表单参数 + 参考文件 + 提交逻辑
  3. `generation-records-store.ts` — 记录 CRUD + SSE 更新（现有 generation.ts）
  4. 移除 store 间 `.getState()` 直调，改为事件或 React 层编排
- **验收**：每个 store < 150 行，无循环引用

### 3.3 🟡 SubtitleEditor.tsx 单文件 ~600 行

- **证据**：[SubtitleEditor.tsx](apps/client/src/pages/SubtitleEditor.tsx) 约 600 行，含视频播放器、字幕时间轴、样式编辑器、句子编辑全部耦合。（TODO.md §5.4 未列出此文件。）
- **解法**：拆分为 `VideoPlayer.tsx` / `SubtitleTimeline.tsx` / `StyleEditor.tsx` / `SentenceEditor.tsx`
- **验收**：SubtitleEditor.tsx < 150 行

### 3.4 🟡 Admin 概览 Tab 透传 17 个 props

- **证据**：[Admin/index.tsx](apps/client/src/pages/Admin/index.tsx) L159-176，`AdminOverviewTab` 接收 17 个 props（data, taskData, isTasksLoading, isTasksFetching, isFetching, isMutating, taskStatus, taskDomain, taskSearch, refetch, refetchTasks, setTaskStatus, setTaskDomain, setTaskSearch, requeue, cancel + 3 个 set 函数）。
- **影响**：每加一个筛选条件就要改 index.tsx + Overview.tsx 两个文件。React DevTools 里看到一长串 props 难以调试。
- **解法**：将 task 筛选状态提升到 `useTaskFilters` hook 或 context，Overview 组件直接消费 hook 而非接收 17 个 props
- **验收**：`AdminOverviewTab` props ≤ 5 个

### 3.5 🟢 React Query key 管理分散

- **证据**：`adminQueryKeys` 在 `query-client.ts`，`billingQueryKeys` 也在 `query-client.ts`，但 `['billing', 'balance']` 和 `['billing', 'transactions']` 在 Billing.tsx 中手写字符串。Canvas 轮询 key 在 `query-client.ts` 但部分 `useQuery` 直接写内联 key。
- **解法**：所有 query key 收敛到 `query-client.ts` 的 factory 函数，禁止手写字符串 key
- **验收**：grep `queryKey:` 结果中无非 factory 的内联 key

---

## §四、运行时健壮性

### 4.1 🔴 unwrapEden 对 401/403 不清理登录态

- **证据**：[client.ts](apps/client/src/api/client.ts) L103-114，`unwrapEden` 对所有错误统一 `throw new Error(message)`。注释声称"401/403: 触发登录态清理"，但实际代码**没有任何 401/403 特判**——不检查 `edenErr.status`，不调用 `setAuthToken(null)`，不跳转登录页。
- **影响**：当 httpOnly cookie 过期（7 天后），用户的每次 API 调用都返回 401 → 各页面各自 toast "请先登录" → 用户看到满屏错误但不会被引导到登录页。SSE 的 `UnauthorizedError` 会清理，但普通 API 调用不会。
- **解法**：
  ```ts
  if (edenErr.status === 401 || edenErr.status === 403) {
    setAuthToken(null) // 触发 SSE 断连 + 清理
    window.location.href = '/login' // 或由 React Query 全局 onError 处理
  }
  ```
- **验收**：cookie 过期后任意 API 调用 → 自动跳转登录页

### 4.2 🟠 Admin 页面 refetchInterval 不受页面可见性控制

- **证据**：[Admin/index.tsx](apps/client/src/pages/Admin/index.tsx) L48 `refetchInterval: 30_000`、L59 `refetchInterval: 15_000`，以及 Users.tsx L354、ApiKeys.tsx L466、Audit.tsx L66、Providers.tsx L21 均为 `refetchInterval: 30_000`。
- **影响**：Admin 页面在后台 tab 时持续每 15-30 秒发起 6+ 个 API 请求，浪费服务端资源。如果用户开了 Admin tab 忘了关，一整天会产生数千次无用请求。
- **解法**：使用 react-query 的 `refetchInterval: (q) => document.hidden ? false : 30_000`，或创建 `useVisibilityRefetch` hook 统一处理
- **验收**：Admin tab 在后台时不发起任何请求

### 4.3 🟡 服务端多处空 catch 块 — 关键路径无日志

- **证据**：
  - [auth.ts](apps/server/src/routes/auth.ts) L87 `catch { /* 初始额度赠送失败不阻塞注册流程 */ }` — 不 log 不 audit
  - [auth.ts](apps/server/src/plugins/auth.ts) L44 `catch { return null }` — resolveActiveUserId 错误被完全吞掉
  - [reference-assets.ts](apps/server/src/modules/canvas/reference-assets.ts) L230/L240 两处空 catch
  - [generation/service.ts](apps/server/src/modules/generation/service.ts) L252 空 catch
- **影响**：生产环境出问题时无法从日志定位原因。特别是注册时 credit 赠送失败——用户注册成功但余额为 0，无任何告警。
- **解法**：所有 catch 块至少 `logger.warn(err, 'context message')`。关键路径（credit 操作）应 `logger.error`
- **验收**：grep `catch {` 结果为 0（所有 catch 至少有一行 log）

### 4.4 🟡 无全局 React Query 错误处理

- **证据**：[query-client.ts](apps/client/src/api/query-client.ts) 创建 `QueryClient` 时无全局 `onError` 回调。每个 `useQuery` / `useMutation` 各自处理错误。
- **影响**：无法统一处理网络错误、认证过期、服务端 500 等通用场景。新增页面容易忘记错误处理。
- **解法**：
  ```ts
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: 1, retryDelay: 1000 },
      mutations: { onError: (err) => handleGlobalError(err) },
    },
  })
  ```
  `handleGlobalError` 统一处理 401 跳转、网络错误提示等
- **验收**：新增页面无需手写错误处理即可获得合理的默认行为

### 4.5 🟡 Canvas loadProject 双重触发

- **证据**：[CanvasEditor.tsx](apps/client/src/pages/CanvasEditor.tsx) L63-73，`loadProject` 在 mount 时触发一次（L63-65），`projectVersion` 变化时又触发一次 + 800ms 延迟再触发一次（L68-73）。SSE 事件到达后会触发 `loadProject` + `setTimeout(loadProject, 800)`，造成连续两次请求。
- **影响**：pipeline 运行期间每个 SSE phase 事件导致 2 次 `getCanvasProject` 请求（间隔 800ms）。对 server 和 DB 产生不必要负载。
- **解法**：使用 debounce 或仅依赖 `projectVersion` 变化触发（去掉 800ms 延时 reload），或改为 SSE entity patch 局部更新
- **验收**：pipeline 运行期间每个 phase 完成事件仅触发 1 次 API 请求

### 4.6 🟡 Canvas.tsx useEffect 空依赖数组

- **证据**：[Canvas.tsx](apps/client/src/pages/Canvas.tsx) L52-54：`useEffect(() => { loadProjects() }, [])` — `loadProjects` 不在依赖数组中。
- **影响**：违反 React hooks 规范（`react/exhaustive-deps` 警告），后续重构时易引入 stale closure。
- **解法**：`loadProjects` 用 `useCallback` 包装 + 加入依赖数组，或在 effect 内内联 async 逻辑
- **验收**：ESLint 无 `react/exhaustive-deps` 警告

### 4.7 🟢 4 处 eslint-disable react/exhaustive-deps

- **证据**：
  - [CanvasFlow.tsx](apps/client/src/components/canvas/CanvasFlow.tsx) L256
  - [PipelineController.tsx](apps/client/src/components/canvas/PipelineController.tsx) L406
  - [use-canvas-pipeline-runs-polling.ts](apps/client/src/hooks/use-canvas-pipeline-runs-polling.ts) L63
  - [use-canvas-assets-polling.ts](apps/client/src/hooks/use-canvas-assets-polling.ts) L95
- **影响**：每处 `eslint-disable` 都是潜在的 stale closure 风险。
- **解法**：逐处审查是否可通过 ref、useCallback 或 restructuring 消除 disable 需求
- **验收**：eslint-disable 减少到 0-1 处

---

## §五、安全性

### 5.1 🔴 无安全响应头 — 缺少 Helmet 或等效中间件

- **证据**：[app.ts](apps/server/src/app.ts) 中间件链无 `helmet` / `X-Frame-Options` / `Content-Security-Policy` / `X-Content-Type-Options` / `Referrer-Policy` 等安全头。[nginx.conf](nginx.conf) 也未设置。
- **影响**：
  - 无 `X-Frame-Options: DENY` → 页面可被嵌入 iframe，面临 clickjacking 攻击
  - 无 `Content-Security-Policy` → XSS 攻击面更大
  - 无 `X-Content-Type-Options: nosniff` → MIME 类型嗅探攻击
  - 无 `Referrer-Policy` → 敏感 URL 参数可能泄露给第三方
- **解法**：
  1. 在 nginx.conf 添加安全头（推荐，对静态文件和 API 代理均生效）：
     ```nginx
     add_header X-Frame-Options "DENY" always;
     add_header X-Content-Type-Options "nosniff" always;
     add_header Referrer-Policy "strict-origin-when-cross-origin" always;
     add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';" always;
     ```
  2. 或在 Elysia 层添加 middleware 设置响应头
- **验收**：`curl -I` 返回所有安全头；securityheaders.com 评分 ≥ B

### 5.2 🟠 Auth cookie 缺少 `__Host-` 前缀

- **证据**：[auth.ts](apps/server/src/routes/auth.ts) L14 `AUTH_COOKIE_NAME = 'auth_token'`。Cookie 选项 `path: '/api'`，`sameSite: 'lax'`，`httpOnly: true`，`secure: production`。
- **影响**：
  - 无 `__Host-` 前缀 → cookie 可被子域设置或覆盖
  - `path: '/api'` 缩小了作用域但不防 subdomain 攻击
- **解法**：生产环境 cookie name 改为 `__Host-auth_token`（要求 `Secure` + `Path: /` + 无 `Domain`），或在 nginx 层做 subdomain 隔离
- **验收**：生产环境 cookie 名为 `__Host-auth_token` 或等效安全措施

### 5.3 🟡 重置密码接口无独立 rate limit

- **证据**：[auth.ts](apps/server/src/routes/auth.ts) L198 `POST /forgot-password` 仅有全局 60 次/分钟 rate limit，无 per-IP per-email 专项限制。
- **影响**：攻击者可每分钟发送 60 次密码重置请求（对同一邮箱），形成邮件轰炸 + 潜在 DoS。
- **解法**：对 `/forgot-password` 和 `/reset-password` 添加专项 rate limit（per-email 5 次/小时 + per-IP 10 次/小时）
- **验收**：同一邮箱第 6 次请求返回 429

### 5.4 🟡 无请求体大小限制（除 nginx 外）

- **证据**：[nginx.conf](nginx.conf) L10 `client_max_body_size 200m`。Elysia 层无 body size 限制。
- **影响**：如果绕过 nginx 直连 server（内网、Docker 内部），可发送任意大小请求体导致内存耗尽。
- **解法**：在 Elysia 层也设置 body size limit（`bodyLimit` 选项或 middleware），非上传路由限制 1MB，上传路由限制 200MB
- **验收**：直连 server 端口时，超大请求体返回 413

### 5.5 🟡 登录接口无账号锁定机制

- **证据**：[auth.ts](apps/server/src/routes/auth.ts) L116-158，密码验证失败仅抛 `UnauthorizedError`，无失败计数、无临时锁定、无 CAPTCHA。
- **影响**：暴力破解攻击可无限尝试密码。虽有全局 60 次/分钟 rate limit，但 60 次/分钟对字典攻击来说太宽松。
- **解法**：
  1. 短期：对 `/login` 添加 per-IP 专项限流（5 次失败/15 分钟）
  2. 中期：连续 5 次失败后要求 CAPTCHA
  3. 记录失败日志供异常检测
- **验收**：同一 IP 连续 5 次登录失败后第 6 次返回 429

---

## §六、性能与可观测性

### 6.1 🟡 无前端性能监控 — React 渲染性能无基线

- **证据**：Vite 配置无 React DevTools Profiler 集成，无 `React.StrictMode`（开发模式双重渲染检测），无 Web Vitals 上报。
- **影响**：无法量化 UI 性能优化效果。Canvas 编辑器有复杂 ReactFlow 渲染 + 频繁 SSE 更新，可能在低端设备上卡顿但无数据支撑。
- **解法**：
  1. 开发环境添加 `<React.StrictMode>`
  2. 生产环境可选添加 `web-vitals` 上报（LCP / FID / CLS）
  3. Canvas 页面的 ReactFlow 组件添加 `React.memo` + `useMemo` 优化
- **验收**：可通过 Chrome DevTools 或监控平台查看 Web Vitals

### 6.2 🟡 无前端错误监控集成

- **证据**：[ErrorBoundary.tsx](apps/client/src/components/ErrorBoundary.tsx) 仅在页面展示错误，不上报。无 Sentry / LogRocket / 类似集成。
- **影响**：生产环境的前端错误完全依赖用户反馈。JS 运行时错误、React 渲染错误无法被开发团队感知。
- **解法**：
  1. ErrorBoundary 的 `componentDidCatch` 中上报错误到监控平台
  2. 最小方案：发送到 server 的 `/api/client-errors` 端点，写入日志
- **验收**：ErrorBoundary 捕获的错误能在 server 日志或监控平台看到

### 6.3 🟡 Docker runtime-deps 阶段缓存效率低

- **证据**：[Dockerfile](Dockerfile) runtime-deps 阶段复制全部 `apps/` 和 `packages/` 目录（而非仅 `package.json`），任何源码变更都会使该层失效。
- **影响**：即使只改了一行 server 代码，Docker 也要重新执行 `bun install --production`（通常 10-30 秒），降低 CI/CD 效率。
- **解法**：使用 `COPY apps/*/package.json apps/` 配合正确的目录结构，或使用 Docker BuildKit 的 `--mount=type=cache` 缓存 `node_modules`
- **验收**：仅修改 server 源码时 runtime-deps 层命中缓存

---

## §七、优先级总表（按 ROI 排序）

| 优先级 | 待办 | 条目 | 预估工作量 | 状态 |
|---|---|---|---|---|
| P0 立刻 | unwrapEden 401 登录态清理 | §4.1 | 0.5h | ✅ 完成 |
| P0 立刻 | 安全响应头 | §5.1 | 0.5h | ✅ 完成 |
| P1 短期 | 错误反馈分级策略 | §2.1 | 4h | ✅ 完成 |
| P1 短期 | client.ts 拆分 | §3.1 | 3h | ✅ 完成 |
| P1 短期 | workspace store 拆分 | §3.2 | 4h | ✅ 完成 |
| P1 短期 | Admin refetchInterval 可见性控制 | §4.2 | 1h | ✅ 完成 |
| P1 短期 | 服务端空 catch 块补 log | §4.3 | 1h | ✅ 完成 |
| P2 中期 | MediaPreviewDialog 支持视频/音频 | §1.1 | 1h | ✅ 完成 |
| P2 中期 | 忘记密码页面 | §1.2 | 2h | ✅ 完成 |
| P2 中期 | ModelLab 离开确认 | §2.2 | 1h | ✅ 完成 |
| P2 中期 | 全局 React Query 错误处理 | §4.4 | 2h | ✅ 完成 |
| P2 中期 | Canvas loadProject 去重 | §4.5 | 1h | ✅ 完成 |
| P2 中期 | Auth cookie 安全加固 | §5.2 | 1h | ✅ 完成 |
| P2 中期 | SubtitleEditor 拆分 | §3.3 | 2h | ✅ 完成 |
| P2 中期 | 前端错误监控 | §6.2 | 2h | ✅ 完成 |
| P3 优化 | Billing 刷新按钮修复 | §2.3 | 5min | ✅ 完成 |
| P3 优化 | 密码可见性切换 | §1.3 | 0.5h | ✅ 完成 |
| P3 优化 | 网络状态指示器 | §2.4 | 1h | ✅ 完成 |
| P3 优化 | 表单成功反馈 | §2.5 | 0.5h | ✅ 完成 |
| P3 优化 | Canvas useEffect 修复 | §4.6 | 0.5h | ✅ 完成 |
| P3 优化 | eslint-disable 清理 | §4.7 | 2h | ✅ 完成 |
| P3 优化 | Admin props 重构 | §3.4 | 1h | ✅ 完成 |
| P3 优化 | Query key 统一 | §3.5 | 1h | ✅ 完成 |
| P3 优化 | 重置密码专项限流 | §5.3 | 1h | ✅ 完成 |
| P3 优化 | Elysia body size limit | §5.4 | 0.5h | ✅ 完成 |
| P3 优化 | 登录账号锁定 | §5.5 | 2h | ✅ 完成 |
| P3 优化 | Docker 缓存优化 | §6.3 | 2h | ✅ 完成 |
| P3 优化 | 前端性能监控 | §6.1 | 2h | ✅ 完成 |

> 最后更新：2026-06-18 — 全部 27 项已完成验收

---

## 底线结论

~~**TODO.md 已覆盖核心架构和运行时风险**（fetch 超时、credit 对账、状态机 drift、category 散弹、大文件拆分等），本文补充了 **产品体验层和生产就绪度的 27 项遗漏**。~~

**全部 27 项已于 2026-06-18 完成验收。** 本轮新增修复：SubtitleEditor 进一步拆分至 131 行（§3.3）、reset-password 端点补专项限流（§5.3）、React.StrictMode 启用（§6.1）、剩余 2 处 eslint-disable 消除（§4.7）、3 处内联 queryKey 收敛（§3.5）。
