# TODO

> 审计日期：2026-06-19  
> 审计范围：`apps/client`、`apps/server`、`apps/worker`、`packages/*`、根配置、脚本与现有测试。  
> 当前总体判断：项目已经具备清晰的 Bun + Elysia + React monorepo 形态，领域包、任务队列、SSE、计费、Provider、Canvas 流水线和测试体系都有基础。但随着功能增长，部分包边界、前端页面职责、运行时配置和测试结构开始出现“可维护性债务”。下面 TODO 按风险和收益排序。

## P0：先处理会影响生产稳定性或架构边界的事项

### 1. 明确 `canvas-runtime` 的定位，拆出 IO Adapter

- 现状：README 把 `packages/canvas-runtime` 描述为 Canvas 阶段执行包，但该包的 phase 代码直接 import `@excuse/db`、`@excuse/provider`，例如 `packages/canvas-runtime/src/phases/characters.ts`、`locations.ts` 中直接创建 DB 记录并调用 Provider 类型。
- 问题：它既像领域运行时，又承担 DB/provider IO。这样会让 server、worker 和测试更难隔离，也削弱 `task-engine` / `workflow-engine` 那种 Adapter 注入风格的一致性。
- 解决办法：
  - 定义 `CanvasRuntimeAdapters`，包括 `provider`, `repositories`, `storage`, `notifier`, `logger` 等接口。
  - phase 函数只依赖 adapter 和 DTO，不直接 import `@excuse/db` / `@excuse/provider`。
  - server/worker 分别在 app 层组装真实 adapter；测试使用 fake adapter。
  - 将 `scripts/check-package-boundaries.ts` 增加对 `canvas-runtime` 的目标规则，先允许临时白名单，再逐步收紧。
- 验收标准：
  - `canvas-runtime/src` 不再直接 import `@excuse/db`、`@excuse/provider`、`@excuse/storage`、`@excuse/ffmpeg`。
  - `bun run check:boundaries` 能拦截回归。
  - Canvas phase 单测可以无数据库、无真实 Provider 运行。

### 2. 抽出 server/worker 共享运行时配置解析

- 现状：`apps/server/src/config.ts` 和 `apps/worker/src/config.ts` 重复解析 DashScope、OSS、metrics、provider timeout 等环境变量。
- 问题：默认值、校验规则和生产安全策略容易漂移。例如 metrics CIDR、provider timeout、OSS 配置已经在两个进程重复维护。
- 解决办法：
  - 在 `packages/shared` 或新增 `packages/config` 中提供纯函数：`parseProviderConfig`、`parseMetricsConfig`、`parseOssConfig`、`parsePositiveIntEnv`。
  - server/worker 只保留各自特有字段，如 port、JWT、SMTP、worker stale timeout。
  - 环境变量解析不要直接 `Number(env.X) || default`，改成可区分缺省、非法值、0/负数的 helper。
- 验收标准：
  - server/worker 配置测试覆盖非法数字、空字符串、生产缺失变量、公网 metrics CIDR 无 token。
  - 配置错误消息包含变量名，启动失败可定位。

### 3. 把 provider observer/guard 注册从入口副作用中隔离

- 现状：`apps/server/src/index.ts` 和 `apps/worker/src/index.ts` 都在模块顶层注册 provider observer/guard、warm health cache，并启动监听/健康服务。
- 问题：入口已经比以前可测试，但仍存在 module-level 副作用；测试 import 入口时可能启动真实监听或污染全局 observer registry。
- 解决办法：
  - 新增 `bootstrapServer(config, ctx)` / `bootstrapWorker(config, ctx)`，返回 `start()` / `stop()`。
  - provider observer/guard 注册提供幂等 unregister 或 scoped registry，测试可清理。
  - `index.ts` 只做 `loadConfig()` + `bootstrap.start()`。
- 验收标准：
  - import app factory 不启动 HTTP/SSE/health server。
  - server/worker bootstrap 有覆盖正常启动、DB 缺失、优雅退出、重复启动的测试。

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

### 6. 补齐 package 级脚本，降低本地验证成本

- 现状：多数 `packages/*/package.json` 没有 `test` / `typecheck` 脚本，根脚本通过 `bun test --cwd packages/x` 手写串联。
- 问题：新增包或改包时不容易形成统一开发习惯，也不利于 CI matrix 拆分。
- 解决办法：
  - 给每个 package 增加一致脚本：`test`、`typecheck`、必要时 `build`。
  - 根脚本改为 workspace aware 的聚合脚本，或用脚本自动发现 package。
  - CI 中拆分 `lint`、`typecheck`、`test:unit`、`test:client`、`test:db`。
- 验收标准：
  - 任意 package 下执行 `bun run test` 和 `bun run typecheck` 都有明确行为。
  - 根 `bun run test` 不需要手动维护长命令列表。

### 7. 清理历史 TODO 引用，建立唯一任务入口

- 现状：代码和 README 多处引用 `docs/TODO.md`、`TODO2`，但当前仓库没有该文件；现在根目录新增了本文档。
- 问题：注释中的历史锚点失效，后续维护者不知道哪些已完成、哪些仍需做。
- 解决办法：
  - 将代码注释中的 `docs/TODO.md` / `TODO2` 改成稳定 ADR、CHANGELOG 或本文具体章节。
  - 对已经完成的历史 TODO，改为“设计背景”而不是继续叫 TODO。
  - README 的 docs 描述同步改为当前真实入口。
- 验收标准：
  - `rg "docs/TODO|TODO2"` 只剩明确仍有效的引用，或全部清零。

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

### 9. 强化用户输入和资源边界

- 现状：已有 `maxRequestBodySize`、prompt limit、计费超额保护、provider timeout 等保护；但前端和 server 的输入限制仍分散。
- 问题：故事文本、上传数量、参考素材类型、Canvas 实体数量、模型参数范围等需要统一定义，否则前后端边界可能不一致。
- 解决办法：
  - 在 shared/domain schema 中集中声明限制：`MAX_STORY_TEXT_LENGTH`、`MAX_REFERENCE_FILES`、`MAX_CANVAS_SHOTS`、允许 mime、文件大小等。
  - 前端表单、server route、worker phase 都引用同一组常量或 schema。
  - 对超限错误返回机器可读 code，前端按 code 展示可恢复提示。
- 验收标准：
  - 任一输入限制只在一个地方定义。
  - server 测试覆盖边界值：0、最大值、最大值 + 1、非法 mime、重复资源。

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

### 11. 收紧 TypeScript 与 ESLint 规则

- 现状：根 `tsconfig.json` 已开启 `strict`、`noUncheckedIndexedAccess`，但 `noUnusedLocals` / `noUnusedParameters` 关闭；ESLint 允许 console。
- 问题：项目规模变大后，未使用代码和临时日志会沉积。
- 解决办法：
  - 先对 packages 开启 `noUnusedLocals` / `noUnusedParameters`，再扩到 apps。
  - console 规则改为：server/worker 只允许 logger；client 只允许 `clientLogger` 或测试。
  - 增加 lint rule 或脚本检查大文件阈值、失效 TODO 引用、边界导入。
- 验收标准：
  - CI 阻止新增未使用导出、散落 console、失效 TODO 锚点。

### 12. 建立架构决策记录（ADR）

- 现状：很多设计背景写在代码注释里，例如 Elysia app factory、ServerContext、Worker lifecycle、metrics 访问等。
- 问题：注释很有价值，但分散在实现文件里，后来者不容易建立全局图。
- 解决办法：
  - 在 `docs/注意` 或 `docs/adr` 下新增 ADR：
    - `0001-monorepo-layering.md`
    - `0002-task-queue-and-worker-lifecycle.md`
    - `0003-canvas-runtime-adapters.md`
    - `0004-provider-health-and-timeout.md`
  - 代码注释只保留必要上下文，详细背景链接 ADR。
- 验收标准：
  - README 的架构约定链接到 ADR。
  - 新增跨包设计变更必须先更新对应 ADR。

## 建议执行顺序

1. 先做 P0-1 `canvas-runtime` adapter 化和边界规则，收益最大，也能防止后续继续耦合。
2. 并行做 P0-2 配置解析抽取，减少 server/worker 漂移。
3. 再拆 P1-4 前端大页面，把 ModelLab 和 Assets 的状态逻辑从 UI 中拿出来。
4. 最后补 P2/P3：测试分层、输入限制常量、日志口径、脚本和文档治理。

## 本次审计已运行的检查

- `bun run check:boundaries`：通过。
- 代码规模抽样：最大业务页面/模块集中在 `ModelLab.tsx`、`Assets.tsx`、`ShotReferenceAssets.tsx`、`dashscope-client.ts`、`task-engine/src/index.ts` 等。
- 测试规模抽样：现有测试覆盖较多，但大测试文件和厚 mock 需要继续拆分治理。
