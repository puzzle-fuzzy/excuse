# TODO

> 审计日期：2026-06-19  
> 审计范围：`apps/client`、`apps/server`、`apps/worker`、`packages/*`、根配置、脚本与现有测试。  
> 当前总体判断：项目已经具备清晰的 Bun + Elysia + React monorepo 形态，领域包、任务队列、SSE、计费、Provider、Canvas 流水线和测试体系都有基础。但随着功能增长，部分包边界、前端页面职责、运行时配置和测试结构开始出现“可维护性债务”。下面 TODO 按风险和收益排序。

## P1：降低维护成本和认知负担

### 4. 拆分前端大页面，提取页面级 hooks 和子组件

- 现状：`apps/client/src/pages/ModelLab.tsx` 约 810 行，`Assets.tsx` 约 737 行；页面同时管理数据加载、表单状态、上传、业务规则、URL 同步和展示。
- 问题：页面职责过重，后续改交互或补边界测试会越来越费劲。
- 解决办法：
  - `ModelLab` 拆成 `useModelLabModels`、`useModelLabForm`、`useModelComparison`、`ModelSelectorPanel`、`ModelParamsPanel`、`ComparisonPanel`、`CanvasDefaultsPanel`。
  - `Assets` 拆成 `useAssetFilters`、`useAssetLibraryQuery`、`AssetToolbar`、`AssetGrid`、`AssetDetailState`。
  - 页面文件只负责布局编排和路由参数。
- 验收标准：
  - 单个 page 文件控制在 250-350 行以内。
  - 复杂 hook 有独立单测，组件测试只覆盖用户可见行为。

### 5. 统一命名：避免泛化函数名和歧义缩写

- 现状：前端页面内常见 `load`、`handleCreate`、`confirmDelete` 等泛化命名；后端存在 `ctx`、`p`、`res` 等局部缩写；`CATEGORY_LABELS` 等历史注释显示曾出现命名和值不一致。
- 问题：局部看能懂，跨文件搜索和 code review 时可读性下降。
- 解决办法：
  - 页面内异步函数使用业务语义：`loadCanvasProjects`、`createProjectFromDraft`、`confirmProjectDeletion`、`runModelComparison`。
  - DTO mapper、route handler、service 方法保持动词 + 领域对象 + 结果，例如 `mapCanvasProjectDetail`。
  - 对 shared 常量增加命名约定：`*_LABELS` 只放展示文案，`*_STATUS` / `*_CATEGORY` 放机器值。
- 验收标准：
  - 关键页面和 Canvas/server 模块完成一轮重命名。
  - 搜索 `async function load(`、`function load(` 在业务页面中不再出现。

## P2：测试覆盖和边界处理

### 8. 让测试覆盖从“数量多”升级为“风险分层”

- 现状：约 561 个 TS/TSX 文件中有 134 个测试文件，server route 测试较多，client 页面测试和 worker 生命周期测试相对更难维护。
- 问题：部分大测试文件超过 700-1100 行，mock 很厚；失败时定位成本高。CodeGraph 也提示若干核心 mapper / config / bootstrap 符号没有直接覆盖。
- 解决办法：
  - 按层级建立测试准则：
    - pure package：输入输出单测为主。
    - db repository：数据库集成测试。
    - server route：只测鉴权、参数、状态码和 orchestration。
    - client page：用户行为 + 可见状态，不 mock 内部实现细节。
    - worker：生命周期、claim/retry/heartbeat、长任务 drain、失败恢复。
  - 拆分超长测试文件，抽出 fixture builder 和 fake adapter。
  - 给 mapper 增加快照式或结构断言测试，尤其是 Date/null/JSONB 归一化。
- 验收标准：
  - 关键 mapper、config、bootstrap、Canvas phase adapter 都有直接测试。
  - 单个测试文件建议不超过 500 行；超过需有明确分组原因。

### 10. 统一错误处理与可观测性口径

- 现状：server 有 `AppError` 和统一错误插件，client 有 `handleApiError`、SSE fallback、React Query query error log；仍有若干 `console.warn/error` 分散在页面、store 和 API client。
- 问题：用户可见错误、开发日志和监控事件口径不完全一致，长任务失败时可能不容易关联 requestId/taskId/runId。
- 解决办法：
  - 前端新增轻量 `clientLogger`，按环境控制 console，并统一附带 route、action、recordId/taskId。
  - server/worker 日志统一字段：`requestId`、`accountId`、`taskId`、`runId`、`providerModel`、`phase`。
  - SSE 事件和通知携带同一 trace 线索，便于从 UI 追到 worker 日志。
- 验收标准：
  - 关键生成链路能从前端错误提示追踪到 server request 和 worker task。
  - `rg "console\\.(warn|error)" apps/client/src` 只剩经过约定允许的位置。

## P3：质量门禁和文档治理

## 建议执行顺序

1. ~~P0-1 `canvas-runtime` adapter 化~~ ✅（`15df5506`）
2. ~~P0-2 配置解析抽取~~ ✅（`71d1cdbe`）
3. ~~P0-3 provider observer/guard 副作用隔离~~ ✅（`12a2a0de`）
4. ~~P1-6 补齐 package 脚本 + P1-7 清理 TODO 引用~~ ✅（`dcaa6861`）
5. ~~P2-9 输入限制常量~~ ✅（`991d6a9c`）
6. ~~P3-12 ADR 文档~~ ✅（`2f65d8cd`）
7. 做 P1-4 拆分前端大页面 ModelLab.tsx
8. 继续 P1-5、P2-8、P2-10、P3-11 等项目。

## 本次审计已运行的检查

- `bun run check:boundaries`：通过。
- 代码规模抽样：最大业务页面/模块集中在 `ModelLab.tsx`、`Assets.tsx`、`ShotReferenceAssets.tsx`、`dashscope-client.ts`、`task-engine/src/index.ts` 等。
- 测试规模抽样：现有测试覆盖较多，但大测试文件和厚 mock 需要继续拆分治理。
