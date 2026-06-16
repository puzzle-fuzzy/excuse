# 项目统一 TODO

更新时间：2026-06-16

本文是 `excuse` 后续产品迭代、技术治理和验收标准的唯一入口。后续 Claude / Codex 只处理本文，不再拆分处理多份清单。

## 使用规则

- 本文只记录仍需推进、仍需决策或仍需验收的事项。
- 已完成事项直接从本文删除，不在 TODO 中保留 commit 历史。
- 每完成一个独立待办，必须从本文删除对应待办，并把完成记录与 commit 写入根目录 `CHANGELOG.md`。
- 不再新增“项目整改总清单”等平行清单。
- 如果一个任务已经完成且没有后续动作，可以直接从本文删除，避免占用上下文。

## 治理原则

- 项目尚未上线，不需要兼容历史脏数据或旧接口形态。
- TypeScript 类型要完整，尽量减少 `any` / `unknown` / 裸 `Record<string, unknown>`。
- 测试覆盖真实风险，不追求 100% 覆盖率。
- 业务编排自己写；通用基础能力优先使用成熟库或沉淀到 package。
- 文件职责清晰，跨模块边界必须有明确 DTO、parser 或 domain type。
- 生成过程要产品化为可见、可恢复、可重试的生产流程。
- 生成结果要沉淀为资产，而不是临时 task output。
- FFmpeg、视频合成、字幕烧录、存储、事件、任务、工作流、鉴权、限流、metrics、prompt、subtitle 等非编排能力优先下沉到 packages。

## 当前总判断

`excuse` 的核心链路已经能跑通，但离“可持续上线运营”还差几类横向能力：生产部署可复制、安全边界明确、异步任务可恢复、数据和资产生命周期可治理、前端在大项目下仍可用、CI 与本地验收保持同口径。

当前优先级：

1. 先处理上线阻断项：部署、密钥/权限、正式计费、数据安全。
2. 再处理核心生产可靠性：worker 幂等、取消/重试、资产生命周期、健康检查。
3. 然后处理增长体验：大项目性能、资产复用、开发者体验、管理后台深诊断。
4. 最后处理长期治理：CI 同口径、E2E、成熟库引入、参考项目迁移。

## P0：上线阻断项

## P1：核心生产可靠性

## P2：前端体验和产品闭环

### 1. 大项目 Canvas 性能风险

问题：

- CanvasEditor 一次加载完整 ProjectDTO，包括 characters、locations、shots、continuity、assets 等；大型项目下 React Flow、右侧详情、轮询 diff 都会变重。
- 资产轮询和项目 reload 已有节流，但 projectVersion 变化仍可能触发整项目 reload。
- 节点详情面板、资产历史、参考资产选择器都可能在大项目下拉取/渲染较多数据。

解决办法：

- 将 ProjectDTO 拆成 summary + paged/partial resources：Canvas 主画布只加载必要节点摘要，详情面板按需加载单节点详情。
- Canvas poll delta 从"发现变化后整项目 reload"升级为局部 patch：shot status、asset URL、phase status 分别更新 store。
- 给大项目建立性能预算：如 200 shots 下首次渲染、阶段更新、节点详情打开的 p95 时间。

验收：

- 200 shots / 50 characters / 50 locations 的项目可流畅打开和操作。
- SSE 高频更新不会导致明显卡顿或重复全量请求。
- 前端测试或 Playwright 性能脚本覆盖大项目 fixture。

### 2. 资产中心和创作资产复用

待办：

- 颜色/重命名/使用计数等标签扩展如果进入产品需求，需要补 UI 和对应 API。

解决办法：

- 若进入需求，优先扩展现有 `asset_tags`：增加 color、description、sortOrder；使用计数由引用关系聚合，不直接手写计数。
- 资产卡片增加"被哪些项目/镜头使用"入口，点击能跳转到 Canvas focus。
- 对常用资产提供"设为项目默认参考/批量应用到选中镜头"操作，保持已有去重和预览规则。

验收：

- 用户能找到之前生成过的素材。
- 用户能从资产中心回到对应 Canvas 项目或镜头。
- 删除/隐藏策略不会误删仍被项目引用的资产。
- 多参考图生成视频时，模型选择不会出现明显不兼容。

## P3：后端 API、数据模型和类型边界

## P4：可观测性、CI 和测试体系

### 1. 缺少端到端冒烟测试

问题：

- 单元/集成测试覆盖较多，但缺少从浏览器视角验证登录、创建 Canvas、触发阶段、资产回显、字幕任务、API Key 调用的冒烟路径。
- SSE、轮询 fallback、httpOnly cookie、内存 token、React Query cache invalidation 这类跨层行为很难靠纯单测覆盖。

解决办法：

- 引入 Playwright 或等价 E2E：使用 test DB + fake provider adapter，跑关键用户旅程。
- 最小冒烟集：注册/登录、提交文本生成、创建 Canvas 项目并跑 mock phase、资产中心查看生成结果、创建 API Key 并调用 gateway mock。
- E2E 默认不访问真实 DashScope；provider 由测试环境 mock。

验收：

- `bun run test:e2e` 可在 CI 中稳定运行。
- 关键用户旅程失败能阻断发布。
- E2E 失败时保留 screenshot/trace。

## P5：成熟库和通用能力治理

待办：

- `p-limit` / `p-queue`：用于单个任务内部的批量上传、下载、生成、持久化并发控制；不替代 `packages/task-engine`。
- `date-fns`：等资产筛选时间、Billing 趋势、任务更新时间、中文时间格式化继续变复杂时再引入。
- `dompurify`：仅在未来展示 AI 生成 Markdown/HTML 时引入；如果一直渲染纯文本，不需要。

不建议替换：

- `crypto.randomUUID()`：当前够用，不需要换 `nanoid`。
- `currency.js`：计费已使用，继续保留。
- `zustand`：当前轻量够用，不急于替换。
- FFmpeg CLI 包装：应继续由 `packages/ffmpeg` 控制，不建议引复杂大库替代。
- Elysia route schema：服务端接口层继续用现有风格即可。

验收：

- 新增成熟库前必须说明替代了哪类手写通用逻辑。
- 不为了“少写代码”引入重依赖。
- 只在两个以上模块会复用，或手写维护成本明显偏高时引入。

## P6：测试体系与可注入设计

测试补齐原则：不追 100%，只补高 ROI 路径。

待办：

- Worker handler 新增或改造时继续使用依赖注入，不直接 import 全局 DB/provider。
- 新增复杂 worker handler 时优先写 fake adapter 单元测试，再补 DB 集成测试。
- 新增前端复杂交互时优先抽纯函数或 hook 测试，必要时补 E2E。

不建议补：

- shadcn UI 基础组件。
- FFmpeg CLI 包装的纯 mock。
- DashScope 完整 mock。

验收：

- 测试能覆盖真实失败路径。
- 不为了覆盖率数字添加脆弱断言。
- Worker handler 使用依赖注入，不直接 import 全局 DB/provider。

## P7：参考项目迁移要点

`puzzle-bobble` 更适合作为工程可靠性参考：

- 长任务状态机、可靠任务队列、Workflow run/step/task。
- SSE + PostgreSQL NOTIFY。
- 预授权、结算、退款。
- 模型目录、能力、定价、参数 schema。
- Worker 健康检查、锁续期、孤儿任务恢复、重试分类。

`lumora` 更适合作为产品平台化参考：

- creative、model-lab、admin、customer、gateway 多产品线边界。
- 统一资产轮询契约：`assets`、`bindings`、`activeTasks`、`costs`。
- API Gateway 的 customer、key、scope、quota、rate limit、usage、credit ledger。
- `TaskTypeRegistry` 为每类任务声明 billing、asset、recovery 策略。

后续不再把参考项目细节展开到本文。需要时只按当前 TODO 的具体任务去对应项目找实现参考。

## 验收命令

每轮整改后至少运行：

```bash
bun run typecheck
bun run lint
bun run build
bun run test
bun run test:client
```

涉及 DB 时补：

```bash
bun run test:db
```

类型逃逸检查：

```bash
rg -n "\bas any\b|@ts-ignore|@ts-expect-error" apps packages
```

包边界检查：

```bash
bun run check:boundaries
```

完成定义：

- 命令通过，或明确说明失败原因与是否由本轮改动引起。
- `rg any` 只允许出现在注释说明、tsconfig 模板注释或第三方声明不可控场景。
- 每个独立待办完成后，必须提交对应 git commit，不混入其他待办；完成记录和 commit 写入根目录 `CHANGELOG.md`，不要写回 TODO。
