# Claude 下一轮执行计划

更新时间：2026-06-14

本文是下一轮交给 Claude 执行的短期计划。长期事项仍维护在 `docs/TODO.md`，不要新增“项目整改总清单”等平行清单。

## 本轮复核结论

当前分支：

```bash
feat/unified-asset-library
```

Claude 已完成资产中心 v1 与 v1.1，并形成 4 个明确提交：

- `312902e feat(assets): add unified asset library api`
- `9ade395 feat(assets): show canvas assets in library`
- `6c78415 feat(assets): support server-side library filters and hasMore`
- `7a8047c feat(assets): add url-driven filters, pagination, and source labels`

已确认完成：

- `GET /api/assets` 合并 `generation_records`、`canvas_assets`、`uploaded_files`。
- `/assets` 页面改为统一资产 DTO。
- Canvas 角色图、场景图、镜头视频、项目文档进入资产中心。
- 支持 `source/kind/status/projectId/model/createdFrom/createdTo` 服务端筛选。
- 支持 URL query 驱动筛选与轻量“加载更多”分页。
- Canvas 来源文案已从笼统“打开 Canvas 项目”优化为“打开角色/场景/镜头所在项目”。

当前还发现一个文档问题：

- `docs/TODO.md` 的 P1-1 仍写着 `本轮新增待提交`，但 v1.1 已经提交为 `6c78415` 和 `7a8047c`。下一轮第一步要修正为精确 commit 列表。

## 重要边界

当前工作区存在一批“视频加字幕/字幕编辑”的未提交改动，这些不是本轮资产中心任务：

- `apps/client/src/pages/Subtitle.tsx`
- `apps/client/src/pages/SubtitleEditor.tsx`
- `apps/client/src/stores/subtitle.ts`
- `apps/server/src/routes/subtitle.ts`
- `apps/worker/src/subtitle-processor.ts`
- 以及相关 subtitle 测试和 schema 文件

下一轮 Claude 执行资产中心任务时：

- 不要修改、格式化、暂存或提交上述字幕相关改动。
- 若必须运行全量 lint/test，允许它们被检查，但提交时必须只提交本轮资产中心与 TODO 文档相关文件。
- 提交前务必用 `git status --short` 和 `git diff --name-only --cached` 确认范围。

## 下一轮目标

继续 P1「资产中心升级」，做 v1.2：资产来源精确定位。

目标不是继续扩大筛选系统，而是解决用户在资产中心点击后“只能回到项目首页，找不到具体素材来源”的问题：

- 从资产卡片进入 Canvas 时，能定位到具体角色、场景、镜头或项目节点。
- Canvas 页面能根据 URL 自动选中节点并打开右侧详情面板。
- 资产中心的来源按钮和链接语义清楚，用户知道会跳到哪里。
- `docs/TODO.md` 同步精确记录 v1/v1.1/v1.2 commit。

本轮不要处理删除策略，也不要做 uploaded_files 管理闭环。删除与上传管理涉及产品决策，留到后续单独切片。

## 第一阶段：修正 TODO 的 v1.1 commit 标注

修改 `docs/TODO.md` P1-1 当前状态。

从：

```md
当前状态：部分完成（统一资产列表 v1 + 筛选分页 v1.1，commit：`312902e`、`9ade395`、本轮新增待提交）。
```

改为：

```md
当前状态：部分完成（统一资产列表 v1 + 筛选分页 v1.1，commit：`312902e`、`9ade395`、`6c78415`、`7a8047c`）。
```

并保留“精确跳转到单个 shot/asset 或自动选中 Canvas 节点”作为本轮要完成的待办，完成后再移动到“已完成”。

## 第二阶段：定义 Canvas 深链 URL 约定

使用现有 Canvas 节点 ID 规则，不新建复杂路由。

当前节点 ID 规则在 `apps/client/src/components/canvas/CanvasFlow.tsx`：

- story：`story`
- analysis：`analysis`
- character：`char-${character.id}`
- location：`loc-${location.id}`
- shot：`shot-${shot.id}`
- continuity：`continuity`

建议 URL 约定：

```txt
/canvas/:projectId?focus=story
/canvas/:projectId?focus=analysis
/canvas/:projectId?focus=char:<characterId>
/canvas/:projectId?focus=loc:<locationId>
/canvas/:projectId?focus=shot:<shotId>
/canvas/:projectId?focus=continuity
```

前端解析后转换为真实节点 ID：

```ts
story -> { id: 'story', type: 'storyInput' }
analysis -> { id: 'analysis', type: 'analysis' }
char:<id> -> { id: `char-${id}`, type: 'character' }
loc:<id> -> { id: `loc-${id}`, type: 'location' }
shot:<id> -> { id: `shot-${id}`, type: 'shot' }
continuity -> { id: 'continuity', type: 'continuityCheck' }
```

要求：

- 无效 `focus` 不报错，忽略即可。
- 如果项目数据还没加载完成，等 `project` 加载后再尝试选中。
- 选中时关闭任务队列和成本面板，避免和右侧节点详情重叠。
- 不要破坏用户手动点击节点的现有行为。

## 第三阶段：让 CanvasEditor 支持 focus 自动选中

修改 `apps/client/src/pages/CanvasEditor.tsx`。

建议实现：

- 从 `window.location.search` 或 React Router 的 search params 读取 `focus`。
- 增加一个小工具函数，例如：

```ts
function resolveFocusNode(focus: string | null, project: ProjectDTO): { id: string, type: string } | null
```

- 根据项目数据校验目标是否存在：
  - `char:<id>` 必须在 `project.characters` 中存在。
  - `loc:<id>` 必须在 `project.locations` 中存在。
  - `shot:<id>` 必须在 `project.shots` 中存在。
  - `continuity` 只有 `project.continuityIssues.length > 0` 时才选中。
  - `story` 和 `analysis` 可按现有节点存在条件处理，`analysis` 需要 `project.analysis` 存在。
- `useEffect` 在 `project` 加载完成后设置 `selectedNode`。
- 避免每次 project reload 都覆盖用户手动选择，可以用 ref 记录当前 focus 是否已消费：

```ts
const consumedFocusRef = useRef<string | null>(null)
```

当 URL 的 `focus` 变化时再重新消费。

验收：

- 打开 `/canvas/<projectId>?focus=shot:<shotId>` 后，右侧自动打开对应镜头详情。
- 打开 `/canvas/<projectId>?focus=char:<characterId>` 后，右侧自动打开角色详情。
- 打开无效 focus 时页面正常加载，不显示错误。

## 第四阶段：资产中心生成精确 Canvas 链接

修改 `apps/client/src/lib/asset-library.ts` 与 `apps/client/src/pages/Assets.tsx`。

当前已有 `getCanvasProjectUrl` 与 `getCanvasSourceLabel`，下一轮在它们基础上增强即可。

建议新增：

```ts
export function getCanvasFocusParam(item: AssetLibraryItem): string | null
export function getCanvasAssetUrl(item: AssetLibraryItem): string | null
```

映射策略：

- `item.source !== 'canvas_asset'`：返回现有项目 URL 或 `null`。
- `targetEntityType === 'character' && targetEntityId`：`focus=char:<id>`。
- `targetEntityType === 'location' && targetEntityId`：`focus=loc:<id>`。
- `targetEntityType === 'shot' && targetEntityId`：`focus=shot:<id>`。
- `targetEntityType === 'project'`：`focus=story` 或不加 focus，二选一；建议不加 focus，避免误导。
- 没有 `projectId`：返回 `null`。

按钮文案建议：

- 角色资产：`定位角色节点`
- 场景资产：`定位场景节点`
- 镜头资产：`定位镜头节点`
- 项目资产：`打开项目`
- 其他：沿用已有文案

验收：

- 资产中心点击角色/场景/镜头来源按钮后，能直接打开 Canvas 并选中对应节点。
- 复制链接仍复制素材本身 URL，不要改成复制 Canvas 深链。
- 下载行为不变。

## 第五阶段：补测试

### 客户端工具函数测试

扩展 `apps/client/test/asset-library.test.ts`。

至少覆盖：

- character asset 生成 `/canvas/:projectId?focus=char:<id>`。
- location asset 生成 `/canvas/:projectId?focus=loc:<id>`。
- shot asset 生成 `/canvas/:projectId?focus=shot:<id>`。
- project asset 不强行生成错误 focus。
- 非 canvas asset 不生成 Canvas focus 链接。

### CanvasEditor focus 测试

如果当前客户端测试结构方便，新增或扩展 CanvasEditor 测试，覆盖：

- URL 带 `focus=shot:<id>` 时打开镜头详情。
- 无效 focus 不崩溃。

如果 CanvasEditor 测试成本过高，本轮至少把 focus 解析函数独立导出并做纯函数测试，不要为了测试大幅重构组件。

## 第六阶段：更新 TODO 并提交

完成后更新 `docs/TODO.md` P1-1。

建议结构：

```md
当前状态：部分完成（统一资产列表 v1 + 筛选分页 v1.1 + 来源精确定位 v1.2，commit：`312902e`、`9ade395`、`6c78415`、`7a8047c`、`新commit`）。

已完成：
- ...
- v1.2：资产中心支持 Canvas 深链，角色/场景/镜头资产可跳转并自动选中对应节点。

待办（未完成）：
- 删除资产的统一产品策略。
- uploaded_files 管理闭环（删除/编辑产品流程）。
- 模糊搜索、项目选择器、高级筛选 UI 优化。
```

不要把 P1-1 直接标为“已完成”，因为删除策略、上传管理和高级搜索仍未完成。

## 验证命令

本轮建议至少运行：

```bash
bun run --cwd apps/client test -- asset-library.test.ts
bun run --cwd apps/client test
bun run --cwd apps/client typecheck
bun run lint
```

如果修改了 shared DTO 或服务端资产返回结构，再补：

```bash
bun test apps/server/test/assets-routes.test.ts
bun run --cwd apps/server typecheck
```

注意：如果全量 lint/test 因当前工作区已有字幕相关未提交改动失败，先判断失败是否来自本轮资产中心改动。不要把字幕改动混入本轮提交。

## 提交要求

本轮建议 1 个提交：

```bash
git add apps/client/src/lib/asset-library.ts \
  apps/client/src/pages/Assets.tsx \
  apps/client/src/pages/CanvasEditor.tsx \
  apps/client/test/asset-library.test.ts \
  docs/TODO.md

git commit -m "feat(assets): deep link canvas asset sources"
```

如果新增 CanvasEditor 测试文件，也一并加入。

提交前必须确认：

```bash
git diff --name-only --cached
```

暂存区只能包含资产中心深链、Canvas focus、对应测试和 `docs/TODO.md`。不要包含字幕相关文件。
