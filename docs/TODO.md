# 项目统一 TODO

更新时间：2026-06-14

本文是 `excuse` 后续产品迭代、技术治理和验收标准的唯一入口。后续 Claude / Codex 只处理本文，不再拆分处理多份清单。

历史内容已合并到本文。后续只维护本文，不再创建或引用已经删除的平行清单、参考文档。

参考来源：

- `/Users/yxswy/Documents/puzzle-bobble`
- `/Users/yxswy/Documents/unknown/lumora`

## 使用规则

- 本文只记录当前仍需推进或需要明确验收的事项。
- 已完成事项必须明确标注“已完成”，并记录对应 commit，例如：`状态：已完成，commit：abc1234`。
- 已完成事项可以保留简短结论，不再展开成执行任务。
- 每完成一个独立待办，必须同步更新本文，并为该项提交对应 git commit。
- 不要让两个 Claude 分别修改不同清单；所有产品和技术任务都统一落到本文。
- 不要再新增平行清单或参考文档，避免多份文档互相影响。

## 治理原则

- 项目尚未上线，不需要兼容历史脏数据或旧接口形态。
- TypeScript 类型要完整，尽可能减少 `any` / `unknown` / 裸 `Record<string, unknown>`。
- 测试要覆盖真实风险，不用脆弱断言或噪声日志掩盖问题。
- 架构设计优先，跨模块边界必须有明确 DTO、parser 或 domain type。
- 文件职责要清晰，避免一个文件承担过多业务分支。
- 核心功能需要有必要注释，尤其是异步流程、计费、SSE、去重、权限和外部 provider 边界。
- 生成过程要产品化为可见、可恢复、可重试的生产流程。
- 生成结果要沉淀为资产，而不是临时 task output。
- API Key、Gateway、Billing 等商业化能力要有独立产品边界，不应半开放。
- FFmpeg、视频合成、字幕烧录等媒体处理能力应下沉到 `packages`，server 只负责 API 编排，不直接持有媒体处理实现。
- OSS、本地存储、上传、下载、签名 URL、public URL / provider URL 解析等存储能力应下沉到 `packages`，server/worker 不直接散落 OSS SDK 调用。
- 与业务编排无关的通用能力都应优先沉淀为 package：auth、安全、限流、metrics、event bus、workflow engine、task engine、prompt engine、subtitle engine、gateway adapter 等。

## 当前总判断

`excuse` 后续最重要的方向不是继续堆更多生成按钮，而是从“AI 内容生成工具”升级为“AI 创作生产平台”。

当前最关键的问题集中在三类：

- Canvas 自动执行、SSE、图片/视频回显仍需要继续产品化和工程化收口。
- Credit、Notification、Audit、OpenAI Gateway、Metrics、API Key 等产品化能力仍需要明确开放状态和验收口径。
- 资产中心、Model Lab、管理后台、开发者中心属于后续增强，不应抢在 Canvas 主体验之前。

## 已完成的工程阻塞项

以下事项已完成，不应作为新的待办重复处理。

### 1. Lint 阻塞已完成

状态：已完成，commit：`52284e2`

完成内容：

- `SubtitleEditor.tsx`：将单个 `useEffect` 拆分为句子同步和样式同步两个 effect，补齐依赖。
- `subtitle/service.ts`：展开单行 `try { await ... } catch {}`。
- `subtitle-burner.ts`：展开两处单行 `try-catch`。

验证结果：

- `bun run lint` 通过，0 errors，0 warnings。

### 2. Server SSE Manager 测试阻塞已完成

状态：已完成，commit：`1c72a0c`

完成内容：

- 移除 `notifications-routes.test.ts` 中污染全局模块的 `sse-manager` mock。
- 修复 `sse-manager.test.ts` 中 `dispatchToUser` 多连接测试被 mock 干扰的问题。

验证结果：

- `bun run test` 通过，262 pass，0 fail。

### 3. 测试代码 `as any` 阻塞已完成

状态：已完成，commit：`4232701`

完成内容：

- 新增 `MockGenerationRecord` 接口。
- 替换 `dbState.records` 的松散数组类型。
- 消除 `apps/server/test/subtitle-service.test.ts` 中实际类型逃逸。

验证结果：

- `rg -n "\bas any\b|@ts-ignore|@ts-expect-error" apps packages` 中无实际类型逃逸，只剩注释说明。

### 4. Server 测试 `mock.module` 隔离已完成

状态：已完成，commit：`f16bc76`

完成内容：

- `canvas-videos-outcome.test.ts` 等大量使用 `mock.module` 的 server 测试在非 isolate 模式下互相污染（如 `jwt.sign` 变 undefined），导致 `bun test --cwd apps/server` 出现 72/279 失败并扩散到 auth/billing/upload/generate/notifications 等无关测试。
- `apps/server` 的 `test` 脚本默认改为 `bun test --isolate`；root `test` 的 server 部分改为 `bun run --cwd apps/server test`，使 `bun run test` 也走 isolate 策略；AGENTS.md 同步更新测试命令说明。

验证方式：

- server 全量：`bun run --cwd apps/server test`（279 pass / 0 fail）。
- 单文件：`bun test apps/server/test/canvas-videos-outcome.test.ts`。
- 多个 `mock.module` 文件混跑：`bun test --isolate a.test.ts b.test.ts`。

## P0：Canvas 可信赖创作工作台

目标：用户点击自动执行后，不刷新页面也能看到真实进度、图片、视频、失败项和最终状态。

### P0 真实体验复核

状态：已复核（2026-06-14，commit：`d211790`）

复核依据：代码级走查 + 自动化测试（client 54 pass / server 279 pass / typecheck 3 端绿 / lint 0 错 0 警）。本轮未做本地 provider 端到端手工跑流，结论以代码路径和测试为准；如具备本地 DashScope 环境建议再补一次手工验收。

复核结论：

- 自动执行全部：经得起。`triggerPhase` fire-and-forget 立即返回，`running=true` 仅驱动 UI；恢复态由 mount/projectStatus 时的 `fetchCanvasPipelineRuns` 接管；阶段完成由 SSE `phaseDone` 主路径 + 3s 轮询兜底双通道推进。页面不会卡住。
- SSE 实时刷新：经得起。`notifyNode(...)` 在每个节点完成时触发（`references.ts`/`videos.ts`/`regenerate.ts`/`storyboard.ts`），`handlePipelineNodeUpdate` 无条件 `projectVersion++` → `loadProject()`，所以**单个角色/场景/镜头资产完成即重载**，不限于阶段边界。
- polling fallback：本轮修复后经得起（见下）。原差异检测只比 projectStatus + shot.status，SSE 断线时角色/场景图片逐个完成要到阶段结束才回显；现已扩展到比对 referenceImageUrl/turnaroundSheetUrl。
- 图片回显：经得起。SSE 模式靠 `notifyNode` 重载；polling 模式靠 `hasCanvasPollDelta` 的 URL 差异触发重载。
- 视频回显：经得起。shot.status 变化被差异检测捕获，且 `videos.ts` 单镜头完成即 `notifyNode`。
- 终止后状态收敛：经得起。`handleCancelActive` → 后端取消活跃 run/task/assets → 前端 `setRunning(false)` + `loadProject()`，无需刷新。

发现问题（已修复，commit：`d211790`）：

1. **CanvasFlow pollData stale closure**（即本轮修复前唯一的 lint warning，`react/exhaustive-deps`）。节点构建 effect 使用了 `pollData`（驱动 `activeImageTaskIds` → 节点「生成中」角标与「正在生成参考图」占位），但依赖数组遗漏。阶段内图片开始/完成、或单次重新生成（无 running phase）时，节点 spinner 不会刷新。已把 `pollData` 加入依赖，并把映射逻辑抽成纯函数 `buildActiveImageTaskMaps` 便于单测。
2. **polling fallback 差异检测遗漏角色/场景图片 URL**。SSE 断线（纯轮询）时，角色/场景参考图逐个完成只改变 `referenceImageUrl`，不改变 projectStatus/shot.status，旧逻辑不触发重载，要等到阶段结束才回显。已抽 `hasCanvasPollDelta` 并扩展比对维度。

下一步修复：

- 暂无阻塞性待办。如需进一步收敛，可考虑：polling 模式下节点级「生成中」spinner 也依赖 pollData（Fix #1 已覆盖主路径），以及可选地让差异检测在 polling 模式启用更短节流（当前固定 5s）。

### 1. 自动执行体验

已完成：

- `tasks` 表 + Worker claim 机制 + lock heartbeat + orphan sweep 已实现，commit：`a2b4c9f`
- Worker `task-handler.ts` 已支持 canvas phase handlers dispatch，commit：`e3d6277`
- `canvas_pipeline_runs` 表和状态追踪已存在。
- Pipeline stepper 自动推进已实现，commit：`095d151`
  - Worker 完成当前 phase task 后，如果 `autoProgress=true`，自动创建下一个 phase task
  - `PAUSE_BEFORE` 阻塞 storyboard 和 videos 阶段（需用户确认）
  - 并发守卫：下一个 phase 没有 active run 时才推进
- Canvas analyze 路由支持 `autoProgress` 分支，commit：`095d151`
  - `autoProgress=true` → 创建 pipeline_run + task（Worker 执行）
  - `autoProgress=false` → 保持 fire-and-forget 模式（向后兼容）
- model-preferences PATCH 支持 `autoProgress` 字段，commit：`095d151`
- 前端 "自动执行全部"按钮设置 `autoProgress=true` 后只触发 phase 1（analyze），commit：`b123756`
- 暂停阶段（storyboard、videos）前端确认按钮已实现，commit：`d73cd15`
  - PipelineController 用 `pendingConfirmIdx` 状态替代倒计时自动触发
  - 显示 "确认继续 → [阶段]" + "暂不执行" 按钮
  - 页面刷新后根据项目状态（refs_all_ready / prompts_ready）恢复确认提示
  - 所有 8 个 phase 路由支持 `autoProgress` task-driven 模式，commit：`d73cd15`
- 暂停、继续、终止、重试失败阶段已实现，commit：`e3dbccb`
  - `POST /projects/:projectId/cancel-active` 终止活跃 pipeline run + 关联 task + 活跃 canvas_assets
  - 前端 "终止当前阶段" 按钮
  - 失败阶段可单独重试（handleRunFrom 已支持 failedPhaseIdx）
  - 暂停 = PAUSE_BEFORE 确认提示，继续 = 确认按钮触发

待办：

- 暂无。

验收：

- 用户刷新页面不会丢失自动执行状态。
- 某一阶段失败后，不影响用户看到已完成产物。
- 失败项可以单独重试。

### 2. 图片和视频实时回显

已完成：

- 统一资产轮询接口 `/api/canvas/projects/:projectId/assets/poll` 已实现，commit：`633672c`
- 接口返回 `assets`、`bindings`、`activeTasks`、`costs`、`projectStatus`、`generatedAt`。
- 前端 SSE 收到事件后调用轮询接口刷新真实数据。
- SSE 断开或漏事件时，前端自动进入 polling fallback（连接模式：sse | polling | disconnected）。
- 画布和镜头列表以资产绑定结果为准。
- `activeImageTaskIds` 已从 `canvas_assets` 表填充（character/location），commit：`0a79421`
- `activeTasks` 已扩展包含 canvas_asset 条目（text/image/video × character/location/shot/project），commit：`0a79421`
- Worker 视频任务成功时标记 `shotVideo` canvas_asset 为 succeeded + setCanvasAssetActive，commit：`0a79421`
- Worker 视频任务失败/超时时标记 `shotVideo` canvas_asset 为 failed，commit：`0a79421`
- 前端 CharacterNode/LocationNode 在 activeImageTaskIds 非空时显示"正在生成" spinner，commit：`d783551`
- 前端支持用户查看同一镜头的历史图片和历史视频（AssetHistory 组件），commit：`67f9548`
- 前端支持用户锁定满意角色图或场景图，后续生成不自动覆盖，commit：`67f9548`
- 暂停阶段（storyboard、videos）前端确认按钮已实现，commit：`d73cd15`
- **（P0 真实体验复核修复，`d211790`）** CanvasFlow 节点构建 effect 补 `pollData` 依赖并抽取 `buildActiveImageTaskMaps`：阶段内图片开始/完成、单次重新生成时节点「生成中」角标与「正在生成参考图」占位能随轮询刷新，不再 stale。
- **（P0 真实体验复核修复，`d211790`）** polling fallback 差异检测抽取为 `hasCanvasPollDelta` 并扩展到比对角色 referenceImageUrl/turnaroundSheetUrl 与场景 referenceImageUrl：SSE 断线时角色/场景图片逐个完成也能触发重载回显，不必等到阶段结束。

待办：

- 暂无。

验收：

- 图片生成完成后无需刷新即可显示。
- 视频生成完成后无需刷新即可播放。
- 终止任务后页面能自动停止 loading，并显示取消或失败状态。
- SSE 不可用时，轮询仍能让页面最终收敛到正确状态。

### 3. Canvas 产物资产化

已完成：

- `canvas_assets` 表创建（10 类 category、5 状态 lifecycle、目标实体绑定、isActive/locked），commit：`ae0fb92`
- `canvas-assets.repo.ts` 完整仓库（create/running/succeeded/failed/cancelled/setActive/succeededByTaskId 等），commit：`ae0fb92`
- 所有 6 个非视频 canvas 服务模块 + regenerate 模块在生成前后创建并更新 canvas_asset 记录，commit：`195ebac`
  - analysis → `analysis` asset
  - characters → `characterProfile` asset per character
  - locations → `locationProfile` asset per location
  - references → `characterPortrait` + `characterTurnaround` per character, `locationRef` per location
  - storyboard → `storyboard` asset
  - continuity-rebuild → `continuityReport` + `videoPrompt` per shot
  - videos → `shotVideo` per shot（保持 running 直到 Worker 完成）
  - regenerate → 按实体类型创建对应 asset
- asset polling 接口从 `canvas_assets` 表填充 `activeImageTaskIds`，commit：`0a79421`
- Worker 完成视频任务时标记对应 `shotVideo` canvas_asset 为 succeeded，commit：`0a79421`
- 前端支持用户查看同一镜头的历史图片和历史视频，commit：`67f9548`
  - `GET /assets/:targetEntityType/:targetEntityId` 查询历史资产
  - AssetHistory 组件在 NodeDetailPanel 中展示角色肖像/转面图、场景参考图、镜头视频的历史版本
- 前端支持用户锁定满意角色图或场景图，后续生成不自动覆盖，commit：`67f9548`
  - `PATCH /asset/:assetId/lock` 切换锁定状态
  - `PATCH /asset/:assetId/activate` 切换当前活跃版本
  - 锁定版本显示 🔒 标记，活跃版本显示绿色边框 + "当前版本" 标签

待办：

- 暂无。

验收：

- 用户能查看同一镜头的历史图片和历史视频。
- 用户能锁定满意角色图或场景图，后续生成不会自动覆盖。
- 后续 I2V/R2V 能稳定使用已有参考图。

### 4. 用户可理解的状态面板

已完成：

- CanvasStatusBar 组件已实现，commit：`cb0fd99`
  - 项目状态：中文翻译标签 + 颜色编码（草稿/已分析/角色已生成/.../已完成/失败）
  - 当前运行阶段 + 模型名（如 "正在生成角色 · 千问 3.7 Plus"）
  - PAUSE_BEFORE 待确认提示（"⏸ 待确认：分镜"）
  - 阶段进度计数（"阶段 3/8"）
  - 活跃任务计数（"任务 2（文本 1 · 图片 1）"）
  - 连接状态：SSE 实时同步 / 轮询同步中 / 连接断开
  - 最后数据更新时间
- 任务队列面板 + 失败原因分类，commit：`2416feb`
  - TaskQueuePanel 组件：展示「进行中的任务」+「最近失败」两栏，按任务类型/目标对象/状态/重试次数/错误摘要呈现。
  - 共享失败分类器 `classifyCanvasFailure`（`packages/shared/src/canvas-failure.ts`）：把后端 errorMessage 归类为 balance（余额）/ content（内容审核）/ network（网络）/ storage（存储）/ cancel（取消）/ provider（模型服务）/ system（系统），并给出下一步建议。
  - poll 端点扩展：`activeTasks` 携带 `errorMessage`/`retryCount`/`updatedAt`；新增 `recentFailures` 数组（failed/cancelled 记录，倒序限 20 条），来源覆盖 generation_records + canvas_assets。
  - CanvasStatusBar 新增「任务队列」可点击按钮，有失败时红色角标提示；点击展开 TaskQueuePanel（选中节点时自动收起，避免面板重叠）。
  - 测试：`apps/server/test/canvas-asset-poll.test.ts` 新增 recentFailures 分类测试（balance/content/cancel 三类 + 倒序）。

待办：

- （无）

验收：

- 用户不用打开控制台，也能知道当前卡在哪里。
- 失败不只显示“失败”，还要说明是 provider、网络、存储、余额、取消或系统错误。

## P1：资产中心和创作资产复用

目标：让生成结果从一次性输出变成可管理、可复用、可组合的创作资产。

### 1. 资产中心升级

当前状态：部分完成（统一资产列表 v1 + 筛选分页 v1.1 + 来源精确定位 v1.2 + 上传文件删除 v1.3 + 搜索与项目选择器 v1.4，commit：`312902e`、`9ade395`、`6c78415`、`7a8047c`、`4501b8d`、`1762ece`、`b0805bb`）。

已完成：

- 统一资产列表 v1：`/api/assets` 合并 generation_records + canvas_assets + uploaded_files 三种来源，DTO 只暴露标量字段（不外泄 inputJson/outputJson）。
- `/assets` 页面改用统一资产 DTO，支持 source（来源）/kind（类别）/status（状态）/projectId（URL `?project=`）基础筛选。
- 资产卡片支持预览（图片/视频/图标）、下载、复制链接、回到 Canvas 项目（`projectId` → `/canvas/:projectId`）。
- Canvas 资产（角色图/场景图/镜头视频/项目文档）进入资产中心；previewUrl 优先稳定 publicUrl。
- v1.1：筛选条件下推服务端，支持 source/kind/status/projectId/model/createdFrom/createdTo（model 精确匹配，时间范围 SQL 层过滤，limit clamp 上限 200）。
- v1.1：页面筛选同步 URL query（`/assets?kind=shot&model=wanx2.1-i2v-turbo&createdFrom=2026-06-01`），筛选变更触发服务端重新查询。
- v1.1：模型输入框 + 开始/结束日期输入 + 清空筛选按钮。
- v1.1：轻量分页（Plan A：hasMore 启发式 + "加载更多"按钮）。
- v1.1：Canvas 资产来源文案更明确（"打开角色/场景/镜头所在项目"而非笼统"打开项目"）。
- v1.2：资产中心支持 Canvas 深链，角色/场景/镜头资产可跳转并自动选中对应节点（URL 约定 `/canvas/:projectId?focus=char:<id>` / `loc:<id>` / `shot:<id>`）。
- v1.2：CanvasEditor 根据 URL `focus` 参数自动选中节点并打开右侧详情面板，项目加载后消费一次，不覆盖用户手动选择。
- v1.2：按钮文案区分有无深链（有 focus → "定位角色/场景/镜头节点"，无 focus → "打开角色/场景/镜头所在项目"）。
- v1.3：uploaded_files 在资产中心支持安全删除；被字幕项目或生成记录引用时返回 409 并阻止物理删除。
- v1.4：资产中心支持服务端模糊搜索（ilike），搜索条件同步 URL query。
- v1.4：资产中心支持 Canvas 项目选择器，下拉选择替代手动 projectId。

待办（未完成）：

- 删除资产的统一产品策略（generation_records/canvas_assets 的删除、隐藏、回收站策略）。
- uploaded_files 编辑产品流程（重命名、用途、metadata）。
- 高级筛选 UI 优化（排序、标签、收藏等）。

验收：

- 用户能找到之前生成过的素材。
- 用户能从资产中心回到对应 Canvas 项目或镜头。

### 2. 参考资产复用

当前状态：部分完成（镜头额外参考资产 v0.1 + 资产库选择 v0.2 + 服务端归属校验 v0.3，commit：`4fb64b3`、`e886876`、`本轮新增 commit`）。

已完成：

- v0.1：canvas_shots 支持保存 referenceAssetsJson（最多 8 个参考资产，每个含 assetId/url/role/可选 label/可选 source）。
- v0.1：PATCH /api/canvas/shots/:shotId 支持更新 referenceAssetsJson，Elysia schema 校验（role 枚举、maxItems 8、label maxLength 100）。
- v0.1：视频生成、重试、重新生成镜头变体时合并角色/场景自动引用与镜头额外参考资产，并去重后传给 provider（角色/场景在前，用户额外引用在后）。
- v0.2：镜头详情支持从资产中心直接选择多个图片参考资产（选择器前端过滤 image/character/location/上传图片候选，自动推断 role、按 assetId/url 去重保存），手动输入 URL 降级为高级兜底入口。
- v0.2：已选参考资产支持在镜头详情内调整基础 role（角色图/场景图/风格图/首帧图/其他）。
- v0.3：服务端保存参考资产前按 assetId 回查真实记录做归属与 URL 可信度校验——`uploaded_file`/`asset_library` 必须属于当前账号且 URL 匹配记录中可信 URL（canvas_assets 先查、generation_records 回退），`manual` 仅校验合法 http(s) URL；统一归一化（label trim、source 缺省 manual）、按 assetId/url 去重、最多 8 个；不信任前端 source 字符串。

待办：

- 根据参考资产数量自动推荐 T2V/I2V/R2V 模型，并在 UI 上解释选择原因。
- 支持将资产应用到一个镜头、一组镜头或整个项目。

验收：

- 用户能明确知道当前镜头用了哪些参考图。 ✓
- 多参考图生成视频时，模型选择不会出现明显不兼容。 ✓

## P2：产品化能力决策和验收

目标：让 Credit、Notification、Audit、OpenAI Gateway、Metrics、API Key 不再只是工程骨架，而是有明确产品状态和验收闭环。

### 1. Credit 计费闭环

当前状态：部分完成。

已完成：

- 普通 `/api/generate` 主流程已接入预估费用、`reserveCredit`、成功扣费和失败退款。
- retry 流程已重新 reserve。
- worker 处理异步视频任务时，成功会 debit，失败或超时会 refund。
- OpenAI Gateway 已接入 reserve、debit、refund。
- `packages/db/src/repositories/credit.repo.ts` 已具备余额、reserve、debit、refund、交易幂等和 usage event 记录能力。

未完成：

- Canvas 的文本分析、角色提取、场景提取、参考图生成、分镜、连续性重建等阶段仍直接调用 provider，没有完整 credit reserve/debit/refund 闭环。**按下方决策（暂不收费），当前不实现 Canvas 前置阶段的 credit 闭环。**
- Canvas 视频阶段主要依赖生成记录和 worker 结算，前置阶段成本不进入 credit 体系（同上，暂不收费故不进入）。
- Canvas 任务缺少面向用户的预估成本、实际扣费、失败退款说明 → **预估成本可见已完成**（见「1a. 成本可见 slice」），实际扣费/退款按决策暂不适用。
- 缺少覆盖 Canvas 全链路计费的端到端测试（暂不收费，credit 闭环测试暂不需要）。

决策项（已决定）：

- **已决定：Canvas 前置阶段暂不收费，标注为 beta/free quota，不进 credit 体系，避免 credit 数据误导用户**（2026-06-14）。
- 后续若改为收费，需要为每个 Canvas provider 调用建立统一的 cost estimate、reserve、debit、refund 策略，并补端到端测试。

### 1a. 成本可见 slice（已完成）

状态：已完成（P2-1 轻量版，对应决策「先不定，做成本可见即可」）。

完成内容：

- 后端 `asset-poll.ts` 新增 `costSummary` rollup：`{ totalEstimatedCents, totalFinalCents, totalFailedCents, byPhase }`，phase 从 `canvas_asset.category` / `generation_record.category` 推导，复用现有 `costs` 数组，非破坏性。
- `packages/shared/src/canvas.ts` 新增 `CanvasCostPhase` / `CanvasCostSummary` 类型（镜像 DB `CanvasPipelinePhase`，避免 shared ← db 反向依赖）。
- 前端 `CostPanel.tsx`：总览三栏（预估/已结算/失败）+ 按阶段拆分 + beta 未计费说明。
- `CanvasStatusBar.tsx`：成本按钮 + 一行摘要 chip（预估¥X · 已结算¥Y），与任务队列按钮互斥展开。
- `CanvasEditor.tsx`：`showCost` 状态 + CostPanel 渲染 + 选中节点时关闭浮层。
- 测试：`canvas-asset-poll.test.ts` 扩展 costSummary 断言 + 多阶段聚合专项测试；客户端 vitest 44 pass；typecheck 三端绿 + lint 0 错。

验收（已满足）：

- 用户能回答「这次自动生成大概花了多少钱」（状态栏 chip + 面板按阶段拆分）。
- 成本明确标注 beta 期间暂未计费，不进 credit，不误导用户。
- 扣费/退款因决策暂不收费而不适用。

完成定义：

- 所有上线收费路径都能证明 reserve、debit、refund 三段闭环。
- Canvas 收费策略有明确产品结论。
- 用户能回答“这次自动生成大概花了多少钱”。
- 用户能看到失败任务是否扣费或退款。
- 对失败、取消、超时、重复回调都有测试覆盖。

### 2. Notification 真实触发器

当前状态：已完成（P2-2，四类真实触发器 + 点击定位 + SSE 实时 + 测试）。

已完成：

- notifications route 已支持列表、未读数、标记已读、全部已读。
- `pushNotification()` 可以创建持久通知并通过 SSE 推送。
- 前端 Navbar 已有通知铃铛和未读数展示。
- **（P2-2 新增）四类真实触发器全部接入**：
  - 任务成功：worker `task-processor` SUCCEEDED → `task_completed`（meta 携带 recordId/category）。
  - 任务失败：worker `task-processor` FAILED/超时 + `canvas-videos` 提交失败 → `task_failed`。
  - Canvas 全部完成：worker `checkProjectCompletion` 检测到 projectStatus='completed' → `canvas_completed`（meta 携带 projectId）。
  - 余额不足：server `generate.ts`（×2）+ `openai-gateway.ts` 在 `reserveCredit` 抛出 `INSUFFICIENT_BALANCE` 时 → `balance_warning`。
- **（P2-2 新增）统一桥接**：新增 db `notifyNotification()`（写表 + `pgClient.notify('notification')`），worker 与 server 共用同一通道；server `startSSEListener` 监听 notification 频道经 `@excuse/events` 的 `createNotificationDispatcher` 推送。`pushNotification` 委托给该桥接，消除 server/worker 双路径。
- **（P2-2 新增）结构化定位 payload**：notifications 表新增 `meta` JSONB 列（`NotificationMeta`：projectId/recordId/assetId/category）+ `canvas_completed` 枚举值（migration `0021_ambiguous_owl`），前端按 meta 实现点击定位（canvas→画布项目 / task→工作台 / balance→计费）。
- **（P2-2 新增）前端铃铛下拉**：Navbar 铃铛展开通知列表（按类型图标 + 未读高亮 + 相对时间）、全部已读、点击定位、SSE 实时更新未读角标（`useNotificationsStore` + realtime-sync 订阅 `notification` 事件）。
- **（P2-2 新增）测试**：events 通知 dispatcher（+5：channel/parse/map/dispatch/error）、worker 触发器（+3：task_completed/task_failed/canvas_completed）、server 余额不足（+1：402 + balance_warning 触发）。修复 worker 测试 mock 未覆盖 `notifyNotification` 导致命中真实 DB 的问题。

未完成：

- API Key 风险事件（过期/额度）等系统风险类通知暂未接入（决策：第一批仅覆盖用户可见的生成/计费事件）。
- 通知点击定位到「具体资产/镜头」的二级精度（目前 task 定位到工作台记录、canvas 定位到项目首页，未深链到单个 shot/asset）。

决策项（已决定）：

- 第一批推送：任务成功、任务失败、Canvas 全部完成、余额不足四类（用户可见事件）。系统风险事件（API Key 等）后续单独排期。

完成定义（已满足）：

- 至少覆盖任务成功、任务失败、Canvas 全部完成、余额不足四类真实通知。 ✓
- 前端不用刷新即可看到未读数变化（SSE `notification` 事件实时驱动角标）。 ✓
- 用户不在 Canvas 页面时，也能知道生成完成或失败（铃铛未读 + 列表）。 ✓
- 通知点击后能定位到具体问题或产物（meta 驱动路由跳转）。 ✓

### 3. Audit 关键动作覆盖

当前状态：大部分覆盖，commit：`06ee5f6`。

已完成：

- 注册、登录已有 audit。
- 上传文件删除已有 audit。
- 普通生成任务已有 audit。
- API Key 创建和撤销已有 audit。
- **（`06ee5f6` 新增）Canvas 关键动作审计**：`canvas_project_create` / `canvas_project_delete` / `canvas_phase_run`（task-driven 与 fire-and-forget 两种模式）/ `canvas_cancel`（终止活跃阶段 + 资产）/ `canvas_asset_regenerate`（角色 / 场景 / 镜头重新生成）。
- **（`06ee5f6` 新增）OpenAI Gateway 调用审计**：`gateway_call`（succeeded / failed，detail 含 model / recordId / token / 费用 / error）。
- **（`06ee5f6` 新增）credit 资金流审计**：`credit_reserve` / `credit_debit` / `credit_refund`，gateway + generate + retry 三来源由 `CreditFlowDetail.source` 区分。
- **（`06ee5f6` 新增）生成状态变更审计**：`generation_retry` / `generation_cancel`，detail 含 `previousStatus`。
- **（`06ee5f6` 新增）audit payload DTO 化**：`domain-types.ts` 定义 9 个 `AuditDetail` DTO + union；`audit-logs` schema detail 列 `$type<AuditDetail>()`；`audit.ts` helper 与 `AuditEntry` 收口；migration `0022_chunky_raider` 扩充 `auditActionEnum` 11 个值并已应用到 dev DB。
- **（`06ee5f6` 新增）附带修复**：`createFireAndForgetPhase` 改为 `factory(runId)` 延迟求值，service 函数能拿到新建 run 的 id（原重构将 run 创建移入 helper 后 service 调用引用了越界的 `run.id`）。
- **（`06ee5f6` 新增）测试**：`apps/server/test/audit-routes.test.ts` 覆盖 `gateway_call` / credit 三件套 / `generation_retry` / `generation_cancel` 六类钩子，通过 `setAuditWriter` 注入捕获断言；canvas 钩子经 typecheck + 既有 `canvas-routes` 测试覆盖。

未完成：

- notification 读取、全部已读等用户行为没有审计决策。
- worker 内部的 debit / refund（视频任务结算）尚未在路由层之外补审计；当前覆盖路由层 hook，worker 侧 credit 结算审计待后续。

决策项：

- 明确哪些行为必须审计，哪些只需要日志（已落地：路由层资金 / 外部 provider / 资源删除 / 状态变更 / Canvas 批量执行已审计）。
- 明确 audit 是否用于后台安全追踪，还是也要进入管理后台。
- notification 读取等用户行为是否需要审计。

完成定义（进度）：

- 权限、资金、外部 provider 调用、资源删除、批量自动化动作均有审计策略。 ✓
- 每类必须审计动作都有测试。 ✓（`audit-routes.test.ts`）
- audit payload 使用明确 DTO，不落入随意 JSON 堆叠。 ✓（`AuditDetail` DTO + `$type`）

### 4. OpenAI Gateway 产品状态

当前状态：API 已暴露，产品决策未完成。

已完成：

- `/v1/models` 和 `/v1/chat/completions` 已挂载。
- 支持 API Key/JWT 鉴权。
- 已接入 credit reserve、debit、refund。
- 基础兼容 OpenAI Chat Completions 请求形态。

未完成：

- 不支持 streaming。
- 目前主要支持文本对话，能力边界需要写清楚。
- 没有前端入口、开发者中心或文档入口。
- 尚未决定近期是否作为正式产品能力开放。

决策项：

- 如果正式开放，需要补齐 API 文档、示例、错误码、限流策略、流式响应、开发者中心。
- 如果内测隐藏，需要文档标注 beta/internal，并限制入口。
- 如果暂缓关闭，需要确保普通用户没有入口，并在部署层明确是否暴露 `/v1`。

完成定义：

- 明确标记为“正式开放 / 内测隐藏 / 暂缓关闭”之一。
- 如果正式开放，需要有文档、测试、限流、计费、错误处理、streaming 决策和用量查询。
- 如果隐藏或暂缓，需要确认前端、文档和部署入口都不误导用户。
- 不出现“后端已经暴露，但用户看不懂怎么用”的半成品状态。

### 5. Metrics / Health 部署可观测性

当前状态：开发级可用，生产级不足。

已完成：

- server 有 health 和基础 metrics route。
- worker 有独立 health。
- 已能观察基础请求、SSE 在线、worker 轮询状态等信息。
- **（`9a04434` 新增）生成任务状态分布已接入 metrics**：`MetricsCollector` 新增 `recordGenerationStatus`，`generation.byStatus` 不再恒为 `{}`（此前为死字段，永远返回空对象）。接入点为主 generate 路径的 `failed`/`processing`/`succeeded`/`cancelled` 与 OpenAI 网关的 `succeeded`/`failed`。受内存单例架构限制，worker 异步视频终态（DashScope 轮询后的 succeeded/failed）发生在独立进程，无法聚合到 server 的 `/api/health/metrics`——这是 in-memory metrics 的固有边界，而非接入遗漏。

未完成：

- metrics 主要是内存态，重启后丢失，不适合多实例聚合。
- 缺少 Prometheus 或类似标准格式。
- 缺少 provider 错误率、模型耗时、任务队列积压、Canvas 阶段耗时等关键指标（生成任务状态分布已接入，见上方 `9a04434`）。
- metrics route 是否需要鉴权还未决策。

决策项：

- 决定上线前是否引入 Prometheus 格式指标。
- 决定 metrics 是否只给内网访问，还是需要鉴权。
- 明确最低部署观测指标清单。

完成定义：

- 部署时能回答服务是否存活、DB 是否可用、worker 是否工作、任务是否积压、provider 是否异常。
- metrics 暴露策略明确，不泄露敏感信息。
- 有一组可复制的线上排障检查命令或文档。

### 6. API Key 产品化

当前状态：后端能力可用，前端产品化不足。

已完成：

- API Key route 已支持创建、列表、撤销。
- bearer token 中的 `exc_` API Key 能进入认证链路。
- API Key 创建和撤销已有 audit。

未完成：

- 前端没有 API Key 管理入口。
- 缺少密钥只展示一次、复制、命名、撤销确认等产品体验验收。
- API Key 权限范围、速率限制和使用统计还不完整。

决策项：

- 决定 API Key 是否随 OpenAI Gateway 一起开放。
- 决定是否需要 scoped key，例如只允许 gateway、只允许生成、只读统计等。

完成定义：

- 如果开放，需要前端管理页、创建后只显示一次、复制、撤销确认、使用说明和限流策略。
- 如果开放，需要支持 key 命名、撤销、scope、rate limit、quota。
- 如果不开放，需要隐藏入口，并保留后端仅供内部或测试使用。

## P3：Model Lab、管理后台和运营能力

目标：提升内部模型调试效率，并为后续商业化运营准备后台能力。

### 1. Model Lab

待办：

- 增加内部模型实验页。
- 支持测试文本、图片、视频模型。
- 支持参数表单、prompt 输入、结果预览、成本显示。
- 支持保存测试结果，并一键复用到 Canvas 默认配置。
- 支持同 prompt 多模型对比。

验收：

- 新模型接入时可以先在 Model Lab 验证，不污染正式 Canvas 流程。
- 运营或开发能比较模型质量和成本。

### 2. 管理后台

待办：

- 项目和任务检索。
- 用户、余额、用量、成本统计。
- 失败任务诊断。
- provider 错误率和模型成本统计。
- API Key 和 Gateway 客户管理。

验收：

- 出现用户问题时，运营能定位任务、资产、扣费、错误原因。
- 可以按模型、用户、项目维度查看成本。

## P4：基础设施和通用能力 package 治理

目标：将 FFmpeg、视频合成、字幕烧录、OSS、本地文件存储、auth、安全、限流、metrics、event bus、workflow、task、prompt、subtitle 等与具体 API 编排无关的能力从 server 业务层剥离，沉淀为可复用 package。

判断标准：

- 如果一个能力可以被 server、worker、测试、未来 admin/customer/model-lab 多处复用，应拆为 package。
- 如果一个能力不需要知道 Elysia route、HTTP request、React 页面状态，应拆为 package。
- 如果一个能力未来可能替换实现，例如 OSS 换 S3、FFmpeg 换云端转码、内存限流换 Redis，应拆为 package。
- 如果一个能力只是在编排业务流程、鉴权当前请求、返回 API 响应，可以留在 app 层。

### 1. 新增 `packages/ffmpeg` 或 `packages/video-compose`

状态：已完成，commit：`65e775b`

待办：

- 新建独立 package 承载 FFmpeg 调用、探测、合成、转码、字幕烧录等能力。
- 暴露稳定接口，例如 `probeMedia()`、`composeVideo()`、`burnSubtitles()`、`extractThumbnail()`。
- package 内部负责 FFmpeg binary 检测、参数拼装、临时目录、错误归一化、日志脱敏。
- server 不直接调用 `ffmpeg` 命令，不直接拼接复杂 FFmpeg 参数。
- worker handler 通过该 package 执行耗时媒体任务。

验收：

- server 侧没有 FFmpeg 业务实现，只保留 API 入参校验和任务创建。
- worker 侧媒体处理调用来自 `packages/ffmpeg` 或 `packages/video-compose`。
- FFmpeg 不存在、输入文件缺失、合成失败、字幕失败都有明确错误码和测试。
- package 可以被 Canvas、字幕、最终视频合成、Model Lab 复用。

### 2. 媒体处理任务化

待办：

- 视频合成、字幕烧录、缩略图提取等耗时操作必须走 worker task。
- task input 只包含 assetId、projectId、shotId、subtitleConfig 等业务引用，不传大块临时数据。
- task output 产出 asset，而不是只返回本地路径。
- 失败后不创建伪资产，成功后资产写入统一资产模型。

验收：

- 刷新页面不会丢失视频合成或字幕烧录进度。
- 合成成功后最终视频进入资产中心。
- 合成失败能在任务面板看到可理解错误。

### 3. 包边界约束

待办：

- `packages/ffmpeg` 不依赖 server route、React、Elysia。
- `packages/ffmpeg` 可以依赖 shared types，但不直接操作 DB。
- DB 写入由 worker/service 完成，FFmpeg package 只返回结构化结果。
- package 内部不能散落业务项目状态判断。

验收：

- 单元测试可以不启动 server 直接测试 FFmpeg 参数和错误处理。
- 未来替换 FFmpeg binary、切换容器镜像或增加云端转码时，不需要改 API route。

### 4. 新增 `packages/storage` 或 `packages/asset-storage`

状态：已完成，commit：`8ac92b3`

完成内容：

- 从 `packages/provider` 中拆出 `AssetStorage` 到独立 `packages/storage`。
- `packages/storage` 承载本地存储、OSS 上传、下载、删除、public URL 构建。
- 暴露 `AssetStorage` 类和 `OSSConfig` 类型。
- package 有独立单元测试（224 行）。
- `packages/provider` 改为依赖 `@excuse/storage`，不再直接持有存储实现。

### 5. Storage 与 Asset 分层

待办：

- `packages/storage` 只负责文件对象存取，不直接操作 DB。
- 资产记录创建、业务绑定、SSE 通知由 worker/service 完成。
- 存储返回结构化结果：`storageKey`、`publicUrl`、`providerUrl`、`mimeType`、`sizeBytes`、`checksum`。
- provider 临时 URL、前端 public URL、provider 可复用 URL 要明确分开。
- OSS 上传失败不应阻塞本地 asset 创建，但必须记录 failure metadata。

验收：

- provider 返回临时 URL 后，worker 能下载并持久化为本地或 OSS 资产。
- Canvas 后续 I2V/R2V 使用的是 provider 可访问 URL，而不是只能前端访问的本地 URL。
- 替换 OSS provider 或切换 bucket/prefix 不需要修改 API route。

### 6. 新增 `packages/auth` 或强化认证安全包

状态：已完成，commit：`de60178`

当前迹象：

- `apps/server/src/utils/crypto.ts` 中有 API Key hash。
- `apps/server/src/plugins/auth.ts` 承担 JWT、Bearer、API Key 认证。
- API Key secret、hash、prefix、scope、撤销、过期等能力未来会被 Gateway、Customer Web、Admin Web 复用。

待办：

- 将 API Key hash、secret 生成、prefix 解析、scope 校验、过期校验下沉到 `packages/auth` 或 `packages/security`。
- server auth plugin 只做 Elysia 适配，不实现核心认证算法。
- API Key 相关 DTO 与错误码放 shared/auth 或 auth package。

验收：

- API Key hash/verify 不再只存在 server utils。
- Gateway、普通 API、未来 customer/admin 都复用同一认证包。
- secret 只显示一次、prefix、scope、过期、撤销都有测试。

### 7. 新增 `packages/rate-limit`

状态：已完成，commit：`b575959`

当前迹象：

- `apps/server/src/plugins/rate-limit.ts` 直接绑定 `elysia-rate-limit`，规则硬编码为全局每分钟 60 次。
- Gateway 未来需要按 key、scope、customer、daily/monthly quota 做更细限流。

待办：

- 将 rate limit 策略、key generator、错误响应、存储适配器抽为 package。
- server plugin 只负责把 HTTP request 转成 rate-limit 输入。
- 支持内存实现和未来 Redis/DB 实现。

验收：

- 普通用户限流、API Key 限流、Gateway quota 可以复用同一策略层。
- 限流测试不需要启动 Elysia server。

### 8. 新增 `packages/metrics` 或 `packages/observability`

状态：已完成，commit：`a80936f`

当前迹象：

- `apps/server/src/services/metrics.ts` 是内存指标收集器，只在 server 内可用。
- worker health/metrics 与 server metrics 尚未统一。

待办：

- 将 counters、latency histogram、error count、task metrics、SSE online metrics 抽成 package。
- 支持内存 snapshot 和 Prometheus 文本导出。
- server/worker 只注册各自采集点。

验收：

- server 和 worker 使用同一 metrics 包。
- metrics route 只负责鉴权和输出，不负责指标计算。
- 可以在测试中 reset/snapshot 指标。

### 9. 新增 `packages/events` 或 `packages/realtime`

状态：部分完成，事件常量、NOTIFY payload 解析、SSE 事件映射、用户连接 hub、NOTIFY dispatcher 已进入 `packages/events`（commit：`3d3c292`、`refactor(events): extract sse hub and notify dispatcher`）。本轮新增 PostgreSQL `LISTEN` 频道注册 wiring（`NotifyListenerTransport` + `startNotifyListeners`，纯 adapter，不创建 DB 连接、不打 server logger、不吞错误），server `sse-manager` 改用该 helper 注册 `generation_status` / `notification` 两个频道，真实 `pgClient`、dispatcher、logger、错误处理仍由 server 注入，package 不依赖 DB runtime（commit：`refactor(events): share notify listener wiring`）。剩余：domain event 和 user notification 分层、业务发布事件改造、SSE 可替换性继续推进。

当前迹象：

- `apps/server/src/services/sse-manager.ts` 承担连接管理、dispatch、logger 与错误处理；`LISTEN` 的 channel 注册 wiring 已委托给 `@excuse/events` 的 `startNotifyListeners`，真实 `pgClient` 仍由 server 注入。
- 通知 route 直接调用 `dispatchToUser()`。

待办：

- 将 domain event type、SSE event type、event bus、PostgreSQL NOTIFY/LISTEN adapter 抽成 package。基础 SSE event type、连接 hub、NOTIFY payload dispatcher、LISTEN 频道注册 wiring 已完成，剩余 domain event 分层、业务发布事件改造、SSE 可替换性继续推进。
- server SSE route 只负责 HTTP SSE 连接。
- notification、generation、canvas 只发布 domain event，不直接关心 SSE 连接。

验收：

- 事件定义集中，前后端不重复写 payload。
- SSE 可替换为 WebSocket 或 polling event log 时，不需要改业务 service。
- domain event 和 user notification 明确分层。

### 10. 新增 `packages/workflow-engine` 和 `packages/task-engine`

状态：部分完成，`packages/task-engine` 已完成 retry/error 分类、retry/fail 决策和 handler registry 基础拆分（commit：`2c0d727`、`refactor(task-engine): add handler registry`、`refactor(task-engine): centralize failure action decisions`），`packages/workflow-engine` 已完成 Canvas phase 顺序、task type 映射、自动推进决策的基础拆分（commit：`refactor(workflow-engine): extract canvas phase rules`）。`canvas.analyze`、`canvas.characters`、`canvas.locations`、`canvas.characterRefs`、`canvas.locationRefs`、`canvas.storyboard`、`canvas.continuity`、`canvas.rebuild`、`canvas.videos` 已从 worker 动态 server service 调用中移除，改为 worker 直接调用 `@excuse/prompt-engine` / `@excuse/canvas-engine` / `@excuse/provider` 执行（commit：`refactor(worker): execute canvas analysis without server service`、`refactor(worker): execute canvas characters without server service`、`refactor(worker): execute canvas locations without server service`、`refactor(worker): execute canvas character refs without server service`、`refactor(worker): execute canvas location refs without server service`、`refactor(worker): execute canvas storyboard without server service`、`refactor(worker): execute canvas continuity without server service`、`refactor(worker): execute canvas rebuild without server service`、`refactor(worker): execute canvas videos without server service`），并已抽出 worker Canvas execution helpers 复用项目加载、资产状态和标准化 mapper（commit：`refactor(worker): share canvas execution helpers`）。新增 `packages/canvas-runtime` 已承载 Canvas 视频模型选择、参数校验、任务提交、资产 taskId 绑定和生成记录创建，server 的生成/重试/重新生成路径与 worker 的视频阶段共用同一实现（commit：`refactor(canvas-runtime): share canvas video submission`）。剩余：worker 仍负责 DB 适配、run/task 创建，后续需要继续抽 Canvas domain service。

当前迹象：

- 项目已经有 tasks、workflows、workflow_steps 表。
- `apps/worker/src/task-handler.ts` 负责 task dispatch、retry delay、错误分类。
- `apps/worker/src/canvas-handlers.ts` 动态加载 server canvas service，说明 worker 与 server 业务实现耦合仍偏高。

待办：

- 将 task definition、retry policy、task dispatch contract、claim/retry/cancel 状态机抽为 `packages/task-engine`。基础 retry policy、failure action decision、handler registry、成功/失败状态落库 adapter contract、claim/sweep 领取与孤儿恢复 adapter、heartbeat 续锁 adapter（worker `heartbeat.ts` 不再直接依赖 `@excuse/db`）、cancel 取消 adapter（server canvas route 取消动作通过 adapter 调用）已完成。worker success/failure/retry/claim/sweep、heartbeat、cancel 状态机动作均已通过 task-engine adapter 收口；`task-engine` 仍是纯业务规则/adapter contract package，不依赖 `@excuse/db`。
- 将 workflow step definition、advance logic、batch partial success、pause/cancel/resume 抽为 `packages/workflow-engine`。基础 Canvas phase/advance decision 已完成；Canvas pipeline run 状态规则（`isActivePipelineRun` / `isTerminalPipelineRun` / `filterActivePipelineRuns` + `CANVAS_ACTIVE_RUN_STATUSES` / `CANVAS_TERMINAL_RUN_STATUSES`）已沉淀到 workflow-engine，`canvas.ts` cancel-active 改用 `filterActivePipelineRuns`；worker 自动推进的并发守卫改用 `canAdvanceToPhase(nextPhase, { hasActiveRun })`，DB 查询 `findActiveRunForPhase` 仍留在 worker 层（commit：`refactor(worker): use workflow phase advance guard`）。phase decision 规则（`isPauseBeforePhase` / `canAdvanceToPhase(phase, {hasActiveRun})` / `isRetryablePipelineRun` + `CANVAS_RETRYABLE_RUN_STATUSES`）已补齐，`decideCanvasAutoAdvance` 内部改用 `isPauseBeforePhase`；`getNextRunnablePhase` 不单独抽出（与 `getNextCanvasPhase` + `canAdvanceToPhase` 重复，避免并行 API 漂移）。batch partial success 已新增纯规则 `decideBatchOutcome`（`empty` / `in_progress` / `all_succeeded` / `all_failed` / `partial_failed`，`cancelled` 计入 failed count），Canvas 视频阶段 `generateVideos` 已接入，把本次提交结果分类交给 workflow-engine，既有提交阶段语义不变（commit：`refactor(workflow-engine): add batch outcome rules`、`refactor(canvas): use workflow batch outcome for videos`）；其它批量收口点（旧 generation record worker、`service-helpers.reconcileProjectShots`）暂未接入，避免一次性改变既有语义。Canvas pipeline command 纯规则（`WorkflowCommand` + `canCancelPipelineRun` / `canRetryPipelineRun` / `canResumeFromPhase`，复用 `isActivePipelineRun` / `isRetryablePipelineRun` / `isPauseBeforePhase`）已补齐，`canvas.ts` cancel-active 改用 `runs.filter(canCancelPipelineRun)`（commit：`refactor(workflow-engine): add pipeline command rules`）；shot 级 retry（`retryShotVideo` / `retryFailedShots`）判的是 shot.status 而非 pipeline run 状态，未接入 `canRetryPipelineRun`，避免硬造业务。剩余：真正执行 pause/cancel/resume 的更高层 command adapter（纯规则已沉淀，adapter 仍在 app 层）；Canvas domain service 边界继续整理；events/realtime 的 DB listen adapter 与 domain event 分层。
- worker 只注册 handler 并运行 engine。基础 handler registry 已完成，worker task dispatch 已从 switch 改为 registry；任务失败后的 `@excuse/db` 动态 import 已改为静态 import，worker 状态机动作（claim/sweep/success/failure/retry、heartbeat、cancel）均通过 task-engine adapter 进入。
- Canvas phase 的纯业务逻辑从 server modules 拆到 package 或 domain service，worker 不再动态 import server 文件。`canvas.analyze`、`canvas.characters`、`canvas.locations`、`canvas.characterRefs`、`canvas.locationRefs`、`canvas.storyboard`、`canvas.continuity`、`canvas.rebuild`、`canvas.videos` 已完成 worker 去 server service；Canvas 视频提交 runtime 已完成 server/worker 复用；worker 的资产生命周期 facade（`runCanvasAssetStep`、`generateCanvasImageAsset`）已下沉到 `packages/canvas-runtime`；server 的 `analysis`、`characters`、`locations`、`storyboard`、`continuity/rebuild` JSON/text 资产编排已接入 `runCanvasAssetStep`；server 的 `references` 图片资产编排已接入 `generateCanvasImageAsset`，`regenerate` 角色/场景重新生成已接入 `runCanvasAssetStep`；`packages/workflow-engine` 已新增可注入 adapter 的 `createNextCanvasPipelineTask`，worker 自动推进不再手写 run/task/link 创建细节。task-engine adapter 侧已全部收口（claim/sweep `eefc5ed`、heartbeat `0e65e9a`、cancel `d3c007f`、worker dynamic import 收口 `d51f6c4`），剩余方向不再是 task-engine adapter，而是：`workflow-engine` 的 pause/cancel/resume 规则（batch partial success 已完成 `decideBatchOutcome` 并接入 Canvas 视频阶段）；Canvas domain service 边界继续整理；events/realtime 的 DB listen adapter 与 domain event 分层。

验收：

- worker 已不再依赖 `../../server/src/...`。
- 自动执行全部由 workflow engine 推进。
- task retry/cancel/fail 的测试不需要启动 server。

### 11. 新增 `packages/prompt-engine` 或 `packages/canvas-engine`

状态：部分完成，`packages/prompt-engine` 已完成 Canvas prompt 模板、LLM JSON parser、shot video prompt builder 的基础拆分（commit：`refactor(prompt-engine): extract canvas prompt utilities`）；`packages/canvas-engine` 已完成镜头连续性校验规则基础拆分（commit：`refactor(canvas-engine): extract continuity rules`）以及 analysis/character/location/storyboard 的 LLM 输出 schema 校验器（commit：`e62cee1`、`refactor(server,worker): validate canvas LLM output before persisting`），server 与 worker 的 10 个 `parseLLMJson` 调用点已全部走校验器收口。Canvas 阶段执行的共享核心已完成下沉到 `packages/canvas-runtime`（消除 server fire-and-forget 与 worker task-driven 两条路径的逐行复制）：全部 9 个阶段的 drift-prone 核心已抽到 `canvas-runtime/src/phases/`，server 与 worker 改为调用同一核心。文本阶段（`runAnalysisPhase`/`generateCharacterEntity`/`generateLocationEntity`/`runStoryboardPhase`）收口 prompt→validate→chat 为 `runTextLlmOnce`、收口归一化映射为 `canvas-runtime/normalize.ts`；修复 server locations 用 name 而非 id 通知的 bug、对齐 storyboard 状态写。纯计算阶段（`runContinuityPhase`/`buildShotVideoPromptEntity`）收口校验+report 与 per-shot prompt 构建。媒体阶段（`generateCharacterRefAssets`/`generateLocationRefAsset`/`submitShotVideoEntity`）收口 prompt 模板（`buildCharacterPortraitPrompt`/`buildCharacterTurnaroundPrompt`/`buildLocationRefPrompt`）+ 图片生成+persist + 视频提交+reference 解析+model 后缀重定；host 保留资产行 lifecycle、per-entity 循环+skip-guards+notifyNode、project-status 分支。

当前迹象：

- `apps/server/src/modules/canvas/prompt-builder.ts`、`prompts.ts`、`analysis.ts`、`storyboard.ts` 等承载大量 Canvas 领域逻辑。
- 这些逻辑未来可能被 server、worker、Model Lab 或测试复用。

待办：

- 将 prompt 模板、结构化输出 parser、storyboard builder、continuity rules、character/location extraction schema 抽成 package。基础 prompt/parser/video prompt builder、continuity rules、以及 analysis/character/location/storyboard 的 LLM 输出 schema 校验器（server+worker 共 10 个调用点）已完成，剩余更完整 Canvas domain engine 继续推进。
- server route 只负责接收请求和创建任务。
- worker 调用 engine 完成实际生成或解析。

验收：

- Canvas prompt 构造和 JSON parser 有独立单元测试。
- prompt engine 不依赖 Elysia，不直接写 DB，不发 SSE。
- worker/server 复用同一套 prompt 和 parser。

### 12. 新增 `packages/subtitle-engine`

状态：已完成，commit：`a269aa6`

当前迹象：

- `apps/server/src/modules/subtitle/service.ts` 负责项目创建，同时调用音频提取。
- `apps/worker/src/subtitle-processor.ts` 负责 ASR 轮询、ASS 生成、字幕烧录、上传、SSE。
- `packages/provider/src/audio-extractor.ts` 和 `subtitle-burner.ts` 实际是 FFmpeg/subtitle 能力，不应归属 provider。

待办：

- 将 ASS/SRT/VTT 生成、字幕样式转换、句子时间轴处理、ASR transcript parser 抽为 `packages/subtitle-engine`。
- 音频提取和字幕烧录放入 `packages/ffmpeg` 或 `packages/video-compose`。
- ASR provider client 保留在 provider，字幕领域逻辑不放 provider。

验收：

- 字幕格式转换和样式渲染可独立测试。
- provider 包只处理 DashScope/ASR API，不包含 FFmpeg 业务。
- server 创建字幕项目不直接执行耗时媒体处理。

### 13. 新增 `packages/gateway` 或 `packages/openai-compatible`

状态：部分完成，`packages/gateway` 已完成 OpenAI-compatible 错误响应、chat request normalize、chat completion response mapper、models response mapper 的基础拆分（commit：`refactor(gateway): extract openai protocol helpers`）。剩余：streaming adapter、provider 调用 service、usage/credit 协议测试和开发者中心开放策略后续继续推进。

当前迹象：

- `apps/server/src/routes/openai-gateway.ts` 承担 OpenAI-compatible request/response、鉴权、计费、provider 调用。
- Gateway 如果产品化，需要被开发者中心、后台、测试复用。

待办：

- 将 OpenAI-compatible schema、request normalize、response mapper、error mapper、streaming adapter 抽成 package。基础 error/request/response/model mapper 已完成，streaming adapter 和更完整 service 边界后续推进。
- server route 只负责鉴权、限流、调用 gateway service。
- Gateway service 复用 billing、auth、rate-limit、provider。

验收：

- OpenAI-compatible 协议兼容测试不需要启动完整 server。
- 后续支持 streaming 时，不需要重写 route 主体。

### 14. Package 拆分优先级

优先级建议：

1. `packages/storage` 或 `packages/asset-storage`：先解决 OSS、本地存储、URL 混乱。
2. `packages/ffmpeg` 或 `packages/video-compose`：迁移音频提取、字幕烧录、最终视频合成。
3. `packages/task-engine`：稳定 worker task claim、retry、cancel、error 分类。
4. `packages/workflow-engine`：让 Canvas 自动执行全部脱离前端和 server fire-and-forget。
5. `packages/events` 或 `packages/realtime`：统一 NOTIFY、SSE、domain event、notification。
6. `packages/subtitle-engine`：把字幕格式、样式、ASR transcript parser 从 server/worker/provider 中拆开。
7. `packages/canvas-engine` 或 `packages/prompt-engine`：沉淀 Canvas prompt、parser、storyboard、continuity。
8. `packages/auth` / `packages/security`、`packages/rate-limit`、`packages/metrics`：随着 Gateway 产品化推进。
9. `packages/gateway` 或 `packages/openai-compatible`：在确定 Gateway 开放状态后推进。

## 参考项目迁移指南

本节合并自历史参考材料。后续 Claude 不需要再打开其他参考文档，只需要按本文执行。

### 1. 总体参考判断

`puzzle-bobble` 更适合作为工程可靠性参考：

- 长任务状态机与可靠任务队列。
- workflow run / step / task 抽象。
- SSE 与 PostgreSQL NOTIFY 事件模型。
- 预授权、结算、退款的计费事务边界。
- 模型目录、能力、定价、参数 schema 治理。
- Worker 健康检查、锁续期、孤儿任务恢复、重试分类。

`lumora` 更适合作为产品平台化参考：

- creative、model-lab、admin、customer、gateway 多产品线边界。
- 统一资产轮询契约：`assets`、`bindings`、`activeTasks`、`costs`。
- API Gateway 的 customer、key、scope、quota、rate limit、usage、credit ledger 闭环。
- `TaskTypeRegistry` 为每类任务声明 billing、asset、recovery 策略。
- `WorkflowStepper` 将自动执行从前端按钮链路转移到 worker orchestration。

### 2. Monorepo 分层与 shared/core

参考文件：

- `/Users/yxswy/Documents/puzzle-bobble/packages/core/src/types.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/db/src/schema.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/core/src/types.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/web-api-client/src/types.ts`

迁移建议：

- 强化 `packages/shared`，集中维护 Canvas phase、shot status、pipeline run status、SSE event type、task type。
- DB enum、API DTO、前端类型不要各自重复定义。
- 跨 app 的业务协议优先放 shared/core，再由 DB schema 和前端派生。
- 可替换、可复用、与 HTTP 编排无关的能力优先拆到 package；app 层只保留 route、auth glue、任务创建、响应映射。

### 3. 环境配置治理

参考文件：

- `/Users/yxswy/Documents/puzzle-bobble/packages/config/src/index.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/config/src/index.test.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/config/src/index.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/config/src/runtime-path.ts`

迁移建议：

- 用 Zod 统一校验 server、worker、provider、storage、cors、rateLimit、retention 配置。
- 生产环境禁止默认 `JWT_SECRET`、默认 DB、默认开放 CORS。
- 对 DashScope、OSS、OpenAI-compatible gateway 做跨字段校验。

### 4. 错误码与 API 响应

参考文件：

- `/Users/yxswy/Documents/puzzle-bobble/packages/core/src/errors.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/api/src/modules/common.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/api/src/modules/gateway/errors.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/api/src/modules/projects/errors.ts`

迁移建议：

- 建立稳定 `ErrorCode` registry。
- 统一处理 AppError、ZodError、JSON SyntaxError 和未知错误。
- API 不要混用 `{ success: false }`、`{ error }`、`{ data }` 多种形态。
- Gateway 对外错误码必须稳定，不能泄露 provider 原始敏感 payload。

### 5. Worker 任务队列可靠性

参考文件：

- `/Users/yxswy/Documents/puzzle-bobble/apps/worker/src/index.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/worker/src/retry.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/worker/src/handlers.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/worker/src/complete.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/task-engine/src/index.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/worker/src/index.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/worker/src/services/task-recovery.ts`

迁移建议：

- 新增统一 `tasks` 表，或将现有 generation records/task polling 泛化。
- task 需要 `queued/running/retrying/succeeded/failed/canceled` 状态。
- 增加 `attempts`、`maxAttempts`、`nextRunAt`、`lockedBy`、`lockedUntil`、`errorJson`。
- Worker 使用 claim 机制，避免多个 worker 抢同一任务。
- 长任务需要 lock heartbeat，worker 崩溃后 orphan sweep 恢复。
- Canvas analyze、characters、locations、refs、storyboard、prompts、videos 都应从 server fire-and-forget 迁到 worker task。

### 6. Workflow Run / Step / Task

参考文件：

- `/Users/yxswy/Documents/puzzle-bobble/packages/creative/src/pipeline.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/creative/src/task-creation.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/worker/src/orchestrator.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/workflow-engine/src/index.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/workflow-engine/src/stepper.test.ts`

迁移建议：

- `canvas_pipeline_runs` 作为 workflow run。
- 增加或强化 `canvas_pipeline_steps`：`phaseKey`、`status`、`taskIds`、`startedAt`、`finishedAt`、`errorJson`。
- 自动执行全部由 worker/stepper 推进，不由前端逐个调用接口。
- step 成功后推进下一步；失败时支持重试、跳过、取消。
- batch step 允许部分成功继续，但必须记录 failed tasks。

### 7. SSE 与 PostgreSQL NOTIFY

参考文件：

- `/Users/yxswy/Documents/puzzle-bobble/apps/api/src/modules/pg-listener.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/api/src/modules/projects/sse.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/web/src/lib/sse.ts`

迁移建议：

- 所有状态变化必须先写库，再 NOTIFY，再 SSE。
- SSE 只通知“有变化”，真实数据以 poll/detail 接口为准。
- 事件 payload 需要包含 `projectId`、`phase`、`taskId`、`status`、`updatedAt`。
- 前端需要展示 `sse | polling | disconnected` 连接状态。
- SSE 断开后自动进入 polling fallback。

### 8. 通知系统与状态事件解耦

参考文件：

- `/Users/yxswy/Documents/puzzle-bobble/apps/api/src/modules/notifications.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/api/src/modules/events.ts`
- `/Users/yxswy/Documents/unknown/lumora/docs/operations/测试策略与验收矩阵.md`

迁移建议：

- domain event 和 user notification 分开。
- 任务状态变化先产生 domain event，再由 notification policy 决定是否生成用户通知。
- 第一批通知覆盖：任务成功、任务失败、Canvas 全部完成、余额不足。
- 通知应能跳转到项目、任务或资产。

### 9. Credit 预授权、扣费、退款和幂等

参考文件：

- `/Users/yxswy/Documents/puzzle-bobble/packages/billing/src/index.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/creative/src/task-creation.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/worker/src/complete.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/credit-ledger/src/index.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/api/src/modules/gateway/billing.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/api/src/modules/gateway/service.ts`

迁移建议：

- 所有收费任务遵循 reserve -> execute provider -> debit/refund。
- reservation 失败时任务不能继续执行。
- provider 成功但结算失败，不能再错误 refund。
- debit/refund 需要按 taskId 幂等。
- Canvas 前置阶段是否收费必须先做产品决策。

### 10. 模型目录、能力和价格治理

参考文件：

- `/Users/yxswy/Documents/puzzle-bobble/packages/billing/src/model-catalog.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/creative/src/providers.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/model-registry/src/index.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/model-registry/src/models/types.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/model-registry/src/models/bailian.ts`

迁移建议：

- 在 `packages/provider/src/model-configs.ts` 之外增加能力层。
- 每个模型声明 `inputModes`、`maxInputImages`、`supportedRatios`、`durationRange`、`supportsPromptExtend`。
- Canvas 生成视频时根据参考资产数量自动推荐 T2V/I2V/R2V。
- 后端二次校验模型能力，避免前端绕过导致 provider error。

### 11. Provider 能力与任务处理器

参考文件：

- `/Users/yxswy/Documents/puzzle-bobble/apps/worker/src/handlers.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/creative/src/providers.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/worker/src/handlers/shot-generate-image.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/worker/src/handlers/shot-generate-video.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/worker/src/services/media-generation.ts`

迁移建议：

- provider adapter 只负责调用外部模型，不处理业务状态。
- worker handler 负责读取 input、调用 provider、保存资产、更新业务实体、结算计费。
- cancel-aware polling 要成为通用工具。
- provider 空结果、异常结构、超时都必须有明确错误码。

### 12. 资产生成链路与资产轮询

参考文件：

- `/Users/yxswy/Documents/puzzle-bobble/packages/creative/src/assets.ts`
- `/Users/yxswy/Documents/unknown/lumora/docs/operations/资产轮询与成本回显契约.md`
- `/Users/yxswy/Documents/unknown/lumora/apps/api/src/modules/assets/asset-query-service.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/worker/src/services/asset-persistence.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/creative-web/src/features/projects/hooks.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/creative-web/src/features/projects/components/ShotCard.tsx`

迁移建议：

- Canvas 结果不要直接依赖 task output。
- 新增 asset-centric polling：`assets`、`bindings`、`activeTasks`、`costs`。
- 角色图、场景图、镜头图、镜头视频、最终视频都应创建 asset。
- 同一镜头多次生成要保留历史资产。
- 存储字段区分 `sourceUrl`、`publicUrl`、`providerUrl`、`localPath`。
- OSS 上传失败不应阻塞 asset 创建，但要记录 metadata。

### 13. 前端体验参考

参考文件：

- `/Users/yxswy/Documents/puzzle-bobble/apps/web/src/components/model-selector.tsx`
- `/Users/yxswy/Documents/puzzle-bobble/apps/web/src/components/task-list.tsx`
- `/Users/yxswy/Documents/unknown/lumora/apps/creative-web/src/features/projects/pages/FlowPage.tsx`
- `/Users/yxswy/Documents/unknown/lumora/apps/creative-web/src/features/projects/components/TaskPanel.tsx`
- `/Users/yxswy/Documents/unknown/lumora/apps/customer-web/src/features/customer/pages/CustomerKeysPage.tsx`

迁移建议：

- Canvas 顶部展示当前阶段、进行中数量、失败数量、最后更新时间。
- 任务面板展示 task type、target、status、model、retry、error。
- 镜头卡片展示当前图片/视频、历史资产、参考图、生成状态。
- API Key 若开放，secret 只显示一次，支持复制、prefix、状态、限流、额度、最近使用。

### 14. 测试体系与可注入设计

参考文件：

- `/Users/yxswy/Documents/puzzle-bobble/packages/config/src/index.test.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/worker/src/*.test.ts`
- `/Users/yxswy/Documents/unknown/lumora/docs/operations/测试策略与验收矩阵.md`
- `/Users/yxswy/Documents/unknown/lumora/apps/api/src/modules/assets/asset-query-service.test.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/api/src/modules/gateway/money-flow.test.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/worker/src/services/task-recovery.test.ts`

迁移建议：

- Worker handler 使用依赖注入，不直接 import 全局 DB/provider。
- Canvas SSE 测试覆盖事件漏发、重复事件、断线重连、polling fallback。
- 计费测试覆盖余额不足、预占、扣费、退款、恢复不重复扣费。
- 资产测试覆盖 provider 成功但文件持久化失败、OSS 上传失败、重复恢复不重复建资产。
- 权限测试覆盖客户只能看自己的 key、余额、流水、任务、资产。

### 15. 运维与健康检查

参考文件：

- `/Users/yxswy/Documents/puzzle-bobble/apps/worker/src/index.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/core/src/metrics.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/api/src/modules/api-metrics.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/worker/src/index.ts`

迁移建议：

- Worker health 返回 workerId、running、lastActiveAt、tasksProcessed、database、storage、uptime、memory。
- Server/worker 都输出 version、db 状态、storage 状态。
- metrics 增加 SSE 连接数、任务处理数、失败数、平均耗时、provider error count。
- shutdown 时停止接新任务，等待当前任务完成或留给 recovery。

### 16. FFmpeg 与视频合成 package 参考

参考文件：

- `/Users/yxswy/Documents/unknown/lumora/packages/video-compose/src/concat.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/video-compose/src/ffmpeg-runner.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/video-compose/src/types.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/worker/src/handlers/video-compose-final.ts`

迁移建议：

- `excuse` 不应把 FFmpeg 合成、字幕烧录、转码逻辑写进 server route。
- 建议新增 `packages/ffmpeg` 或 `packages/video-compose`。
- server 只创建媒体处理任务，worker 调 package 执行。
- package 只处理媒体输入输出和错误归一化，不写 DB、不发 SSE、不处理用户权限。
- 合成结果必须进入统一资产模型，并由 asset polling 回显。

### 17. OSS 与 Storage package 参考

参考文件：

- `/Users/yxswy/Documents/unknown/lumora/packages/asset-service/src/index.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/asset-service/src/oss.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/asset-service/src/oss.test.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/worker/src/services/asset-persistence.ts`

迁移建议：

- `excuse` 不应在 server route、worker handler、provider service 中散落 OSS SDK 调用。
- 建议新增 `packages/storage` 或 `packages/asset-storage`。
- package 负责本地/OSS 存储切换、上传、下载、删除、public URL、provider URL、错误归一化。
- package 不写 DB、不发 SSE、不处理权限；业务层拿到存储结果后创建 asset 记录。
- OSS 上传失败时可以保留本地资产，但必须把失败原因写入 asset metadata，方便后续排障。

### 18. API Gateway 产品化参考

参考文件：

- `/Users/yxswy/Documents/unknown/lumora/docs/product/API网关产品设计.md`
- `/Users/yxswy/Documents/unknown/lumora/apps/api/src/modules/gateway/proxy-routes.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/api/src/modules/gateway/service.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/api/src/modules/gateway/quota.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/customer-web/src/features/customer/pages/CustomerKeysPage.tsx`

迁移建议：

- Gateway 必须明确为正式开放、内测隐藏、暂缓关闭之一。
- 如果开放，需要开发者中心：API Key、余额、用量、流水、任务、调用示例。
- Key 支持 scope、rate limit、daily quota、monthly quota、status、lastUsedAt。
- 客户只能查询自己的 key、usage、transactions、tasks。

### 19. Claude 执行提示

后续可以按以下提示拆任务给 Claude：

1. “请只参考 `docs/TODO.md`，不要再读取其他清单或参考文档。”
2. “请先为 Canvas 设计并实现 `assets/bindings/activeTasks/costs` 轮询接口，保持 SSE 只作为变化通知。”
3. “请为 Canvas 前端增加 `sse | polling | disconnected` 模式，SSE 收到事件后刷新 poll 数据。”
4. “请设计 `tasks` 表和 Worker claim 机制，先只支持 Canvas phase task。”
5. “请建立 Canvas `TaskDefinition` 注册表，为每类任务声明 billing/asset/recovery 策略。”
6. “请把 Canvas analyze/characters/locations/storyboard/rebuild 从 server fire-and-forget 迁到 Worker task。”
7. “请引入 workflow step 抽象，让自动执行全部由后端 orchestrator 推进，而不是前端逐步调用接口。”
8. “请决定 OpenAI Gateway 是正式开放、内测隐藏还是暂缓关闭，并补对应文档和入口处理。”
9. “请将 FFmpeg、视频合成、字幕烧录能力抽到 `packages/ffmpeg` 或 `packages/video-compose`，server 只创建任务，worker 调包执行。”
10. “请将 OSS、本地存储、上传下载、public/provider URL 解析抽到 `packages/storage` 或 `packages/asset-storage`，server/worker 不直接散落 OSS SDK 调用。”
11. “请梳理 server/worker 中所有非编排能力，按 `storage -> ffmpeg -> task-engine -> workflow-engine -> events -> subtitle-engine -> canvas-engine -> auth/rate-limit/metrics -> gateway` 的顺序拆包。”

### 20. 注意事项

- 不建议直接照搬 `puzzle-bobble` 的框架形态；`excuse` 当前使用 Elysia + Eden treaty，保留即可。
- 不建议直接照搬 `lumora` 的 SQLite；`excuse` 当前 PostgreSQL + Drizzle 更适合 SSE/NOTIFY 和多进程部署。
- 不建议一次性迁移所有 Worker/task/workflow/billing；优先解决 Canvas 可靠性。
- 不建议立刻把 `excuse` 拆成多个 Vite app；先拆清产品边界和路由边界。
- `lumora` 的 React Flow 页面可参考数据回显，不代表 Canvas 主体验必须使用 React Flow。
- 不建议把 FFmpeg 逻辑写进 server；媒体处理应作为 package + worker task，而不是 API 请求内同步执行。
- 不建议把 OSS SDK 调用散落在 server、worker、provider 中；存储能力应通过 package 统一封装。
- 不建议 worker 动态 import server 业务模块；worker 应调用 package/domain engine，而不是复用 route/service 文件。
- 不建议 provider 包承载非 provider 能力；FFmpeg、storage、subtitle format、prompt parser 都不应长期留在 provider。
- 如果未来任务量更大，再考虑 Redis/BullMQ/Temporal，不要过早引入重型系统。

## 暂不建议做的事

- 不建议立刻拆成多个前端应用；先拆清产品边界和路由边界。
- 不建议先做复杂支付、发票、套餐；先把成本展示和 credit 闭环做可靠。
- 不建议继续只修补单个 SSE 事件；应补统一资产轮询和 pipeline run 状态。
- 不建议把 API Gateway 半开放给普通用户；要么隐藏，要么补完整开发者中心。
- 不建议把 Canvas 做成自由流程图编辑器；当前优先做稳定、清晰、可控的导演工作台。

## 推荐执行顺序

1. Canvas 统一资产轮询接口。
2. 前端 SSE + polling fallback。
3. 自动执行全部迁移为 pipeline run / step / task。
4. 角色、场景、镜头资产化和历史资产展示。
5. Canvas 成本回显和失败/退款说明。
6. Notification 真实触发器。
7. 对 OpenAI Gateway、API Key、Notification 做产品开放决策。
8. 明确 Canvas 前置阶段是否收费，并补齐 credit 策略。
9. 补齐必须上线能力的端到端测试。
10. 整理部署可观测性文档和 metrics 暴露策略。
11. Model Lab 内部实验页。
12. 新增 `packages/ffmpeg` 或 `packages/video-compose`，迁移视频合成和字幕烧录能力。
13. 新增 `packages/storage` 或 `packages/asset-storage`，迁移 OSS、本地存储和 URL 解析能力。
14. 新增 `packages/task-engine`，迁移 task definition、retry、cancel、error 分类。
15. 新增 `packages/workflow-engine`，迁移 Canvas 自动执行 stepper。
16. 新增 `packages/events` 或 `packages/realtime`，迁移 NOTIFY/SSE/domain event 映射。
17. 新增 `packages/subtitle-engine`，迁移字幕格式、样式、ASR transcript parser。
18. 新增 `packages/canvas-engine` 或 `packages/prompt-engine`，迁移 Canvas prompt、parser、storyboard、continuity。
19. 随 Gateway 决策推进 `packages/auth`、`packages/rate-limit`、`packages/metrics`、`packages/gateway`。
20. 管理后台和运营统计。

## 验收命令

每轮整改后至少运行：

```bash
bun run typecheck
bun run lint
bun run build
bun run test
bun run test:client
bun run test:db
rg -n "\bas any\b|@ts-ignore|@ts-expect-error" apps packages
```

完成定义：

- 上述命令全部通过。
- `rg any` 只允许出现在注释说明、tsconfig 模板注释或第三方声明不可控场景，测试代码不例外。
- 跨模块边界必须有明确 DTO/parser/domain type 和能失败的测试。
- 每个独立待办完成后，必须提交对应 git commit，不混入其他待办。
