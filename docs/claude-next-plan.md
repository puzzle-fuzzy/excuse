# Claude A 下一轮执行计划：PipelineController pipeline-run 轮询迁移到 react-query

更新时间：2026-06-14

本文给 Claude A 执行。Claude B 当前在处理 **Canvas 阶段耗时 + 任务队列积压 Prometheus 指标**（`packages/metrics` 新增 DB 派生指标聚合 + `packages/db` 新增聚合 repository + `apps/server/src/routes/metrics.ts` 合并 in-process 与 DB-derived 输出），Claude A 本轮继续推进 P4.1「`@tanstack/react-query`」方向，把 `apps/client/src/components/canvas/PipelineController.tsx` 内手写的 3s `setInterval` 轮询逻辑（line 364-409）抽到 react-query 的 `useQuery` + `refetchInterval` + `invalidateQueries`，与上一轮 canvas 资产轮询改造保持一致的失效路径。不要碰 Gateway、Metrics、Provider、API Key 页面、worker、DB schema。

## 上轮复核结论（已通过）

上一轮 Claude A 完成并提交：

- `b5f2c83 refactor(canvas): migrate assets polling to react-query`
- `96b2cfc docs(changelog): backfill canvas polling react-query commit hash`

复核结果：

- `apps/client/test/canvas-poll.test.ts`：1 file / 21 pass / 0 fail（含上一轮 9 条原 polling 行为 + 本轮新增 12 条 react-query 行为：`refetchIntervalFor` 4 种 connectionMode × activeTasks 组合、projectId 切换、disconnected enabled、projectVersion invalidate、placeholderData、返回 shape、refresh）。
- `bun run typecheck`：server / client / worker 三端通过。
- `apps/client/src/hooks/use-canvas-assets-polling.ts`：141 行重写为 `useQuery` + `refetchInterval` 回调（动态根据 `connectionMode` + `activeTasks` 计算）+ `useEffect` watch `projectVersion` 调 `invalidateQueries`；`refetchIntervalFor` 作为纯函数导出便于单测；返回 shape `{ pollData, connectionMode, isPolling, lastPollAt, refresh }` 向后兼容。
- `apps/client/src/api/query-client.ts`：+7 行追加 `canvasAssetsPollingQueryKeys` 常量；既有 export 未破坏。
- `docs/TODO.md` P0「Canvas 可信赖创作工作台」待办行已替换为「已全部完成」注释。
- `CHANGELOG.md` Changed 区已记录并回填 commit `b5f2c83`。
- 暂存区零跨界（未碰 `packages/` / `apps/server/` / `apps/worker/` / SSE 客户端 / `apps/client/src/api/client.ts`）。

保持上一轮的纪律。

## 本轮目标

把 `PipelineController.tsx` 内 line 364-409 的 pipeline-run 兜底轮询抽到 react-query，与 canvas 资产轮询保持一致的数据失效路径。

当前状态：

- `apps/client/src/components/canvas/PipelineController.tsx` line 364-409 用 `useEffect` + `window.setInterval(..., 3000)` 每 3s 调 `fetchCanvasPipelineRuns(projectId)`；run 命中 succeeded/failed 时调 `onPhaseComplete` 或 `setError` 并 advance。
- 上一轮 canvas 资产轮询已经迁移到 react-query（`useCanvasAssetsPolling`），`apps/client/src/api/query-client.ts` 已经有 `canvasAssetsPollingQueryKeys` 常量；本轮在同一文件追加 `canvasPipelineRunsQueryKeys`。
- 项目里 `useRealtimeSync` 的 `projectVersion` + `phaseDone` 是 SSE 主路径，polling 是兜底，避免断线或漏事件时自动执行卡在 running；本轮保留这个语义。
- `apps/client/src/api/client.ts` 的 `fetchCanvasPipelineRuns(projectId)` 直接复用，本轮不改。

本轮要做的：

1. **在 `apps/client/src/api/query-client.ts` 追加 `canvasPipelineRunsQueryKeys`**（不动既有常量）。
2. **新建 `apps/client/src/hooks/use-canvas-pipeline-runs-polling.ts`**：用 `useQuery` 包裹 `fetchCanvasPipelineRuns`，`enabled` 由 `running && currentPhase >= 0 && projectId` 控制，`refetchInterval` 固定 3000ms（与原 polling 一致），`placeholderData: (prev) => prev` 保持上一份数据避免闪烁；暴露 `{ runs, isPolling }`，不暴露业务推进逻辑。
3. **`PipelineController.tsx` 改造**：用新 hook 替换 line 364-409 的 `useEffect` + `setInterval`；业务推进逻辑（succeeded → advance / failed → setError）放到一个 watch `runs` 的 `useEffect` 里，**保留原行为**：
   - 命中 succeeded/failed 时按 `activeRunIdRef.current` 优先匹配，否则按 `phase.key + status` 匹配。
   - 命中后清 `activeRunIdRef.current`、调 `onPhaseComplete`、失败时 setRunning(false) + setFailedPhaseIdx。
   - 命中失败时复用 `${phase.label} 失败: ${run.errorMessage || '未知错误'}` 文案。
4. **SSE 主路径不变**：`phaseDone` 事件仍由 `useRealtimeSync` 接管并直接驱动 `onPhaseComplete`；polling hook 仅作为兜底。本轮**不要**把 phaseDone 也接到 `invalidateQueries`（避免和现有 SSE 路径重复触发）。
5. **`PipelineController` 已有的 mount restore 逻辑（line 149-211 `fetchCanvasPipelineRuns` 单次拉取恢复 running state）保持不动**：那是一次性恢复，不是轮询，不需要迁移。如果新 hook 的 queryKey 与 restore 路径冲突，单独说明。
6. **补 hook 单元测试**：覆盖 enabled 切换、refetchInterval、placeholderData、projectVersion invalidate、返回 shape。
7. 在 `docs/TODO.md` 的 P4.1 第 2 条「`@tanstack/react-query`」下方追加一行勾选式说明「Canvas pipeline-run 兜底轮询已迁移」（不删条目，因为 P4.1 是持续推进项；仅追加完成说明）。
8. 在 `CHANGELOG.md` `[Unreleased]` 的 Changed 区记录本轮完成内容和 commit。

本轮不要处理：

- 改造 `useRealtimeSync` 或 `phaseDone` SSE 路径。
- 改造 CanvasEditor.tsx（消费方零改动；hook 接口向后兼容）。
- 改造 `apps/client/src/api/client.ts` 的 `fetchCanvasPipelineRuns` 实现。
- 改造其他页面的 polling（Workspace / Subtitle / Assets 等）— 仅 PipelineController。
- 改造 SSE 客户端（`apps/client/src/api/sse.ts`）。
- 资产中心、API Key 页面、开发者页、Metrics、Gateway、Provider、worker。
- DB schema / migration。

## 重要规则：完成后必须 commit

- 本轮 1 个 commit（hash 回填可以追一个 docs commit）。
- commit 前必须运行 `git status --short` 和 `git diff --name-only --cached`。
- 暂存区只能包含本任务文件，**绝对不要**混入 Claude B 的 packages/metrics / metrics.ts / db repository 文件。
- 完成说明写入 `docs/TODO.md` P4.1 第 2 条下方（追加一行，不删条目）。
- 完成记录和 commit 写入根目录 `CHANGELOG.md`。
- 如果 `docs/TODO.md` / `CHANGELOG.md` 与 Claude B 并行修改冲突，优先提交代码；文档冲突在最终回复里说明。
- commit 成功后，在最终回复里写出 commit hash。

**强制检查**：commit 前必须确认 `git diff --name-only --cached` 输出**不包含**：

- `packages/`（任何路径，本轮零 package 改动）
- `apps/server/`（任何路径，本轮零 server 改动）
- `apps/worker/`（任何路径，本轮零 worker 改动）
- `apps/client/src/api/sse.ts`
- `apps/client/src/api/client.ts`（`fetchCanvasPipelineRuns` 已存在，不需要改）
- `apps/client/src/api/asset-library.ts`
- `apps/client/src/api/notifications.ts`
- `apps/client/src/api/api-keys.ts`
- `apps/client/src/api/billing.ts`
- `apps/client/src/lib/asset-library.ts`
- `apps/client/src/lib/notification-target.ts`
- `apps/client/src/lib/generation-utils.ts`
- `apps/client/src/lib/canvas-poll.ts`（hasCanvasPollDelta 不动）
- `apps/client/src/pages/Assets.tsx`
- `apps/client/src/pages/Canvas.tsx`（列表页；本轮不动）
- `apps/client/src/pages/CanvasEditor.tsx`（消费方零改动；如必须改，先停止说明）
- `apps/client/src/pages/Workspace.tsx`
- `apps/client/src/pages/Subtitle.tsx`
- `apps/client/src/pages/SubtitleEditor.tsx`
- `apps/client/src/pages/Billing.tsx`
- `apps/client/src/pages/ApiKeys.tsx`
- `apps/client/src/pages/Developers.tsx`
- `apps/client/src/components/canvas/`（除 `PipelineController.tsx`）
- `apps/client/src/components/Navbar.tsx`
- `apps/client/src/components/ui/`
- `apps/client/src/stores/realtime-sync.ts`（仅消费其 `projectVersion` / `phaseDone`，不重写 store）
- `apps/client/src/stores/workspace.ts`
- `apps/client/src/stores/generation.ts`
- `apps/client/src/stores/subtitle.ts`
- `apps/client/src/stores/notifications.ts`
- `apps/client/src/hooks/use-canvas-assets-polling.ts`（上一轮已动；本轮不动）
- `apps/client/src/App.tsx`
- `apps/client/src/main.tsx`
- `apps/client/src/auth/`
- `apps/client/src/test-setup.ts`

## 文件边界

Claude A 可以修改：

```txt
apps/client/src/components/canvas/PipelineController.tsx      (line 364-409 polling 改用新 hook)
apps/client/src/hooks/use-canvas-pipeline-runs-polling.ts     (新建 hook)
apps/client/src/hooks/use-canvas-pipeline-runs-polling.test.ts (新建 hook 单元测试)
apps/client/src/api/query-client.ts                          (追加 canvasPipelineRunsQueryKeys 常量；不破坏既有 export)
apps/client/test/canvas-pipeline-runs-polling.test.ts         (如 vitest 配置要求 test 在 test/ 目录，则放这里；与 hook test 二选一即可)
docs/TODO.md
CHANGELOG.md
```

Claude A 不要修改：

```txt
docs/claude-parallel-plan.md
packages/**                                     (本轮零 package 改动)
apps/server/**                                  (本轮零 server 改动)
apps/worker/**                                  (本轮零 worker 改动)
apps/client/src/api/sse.ts                      (SSE 客户端不动)
apps/client/src/api/client.ts                   (fetchCanvasPipelineRuns 已存在)
apps/client/src/api/asset-library.ts
apps/client/src/api/notifications.ts
apps/client/src/api/api-keys.ts
apps/client/src/api/billing.ts
apps/client/src/lib/asset-library.ts
apps/client/src/lib/notification-target.ts
apps/client/src/lib/generation-utils.ts
apps/client/src/lib/canvas-poll.ts
apps/client/src/pages/**                        (本轮不动；CanvasEditor 仅消费 PipelineController，零改动)
apps/client/src/components/canvas/**            (除 PipelineController.tsx；如必须改 CanvasFlow 等，先停止说明)
apps/client/src/components/Navbar.tsx
apps/client/src/components/ui/**
apps/client/src/stores/**                       (本轮不动 store)
apps/client/src/hooks/use-canvas-assets-polling.ts  (上一轮已动)
apps/client/src/App.tsx
apps/client/src/main.tsx
apps/client/src/auth/**
apps/client/src/test-setup.ts
```

如果必须修改边界外文件，**先停止并在最终回复说明原因**。

## 第一步：调研 PipelineController 现有 polling 逻辑

阅读 `apps/client/src/components/canvas/PipelineController.tsx` line 364-409 全文，确认：

1. 当前 polling 是怎么发起的（`fetchCanvasPipelineRuns(projectId)` + `setInterval(..., 3000)`）。
2. `running` / `currentPhase` 状态切换时 polling 的启停行为（`useEffect` 依赖 + `cancelled` 标志 + `clearInterval`）。
3. run 匹配规则：`activeRunIdRef.current` 优先精确匹配；缺省按 `phase.key + (succeeded|failed)` 模糊匹配。
4. 命中 succeeded 时：`activeRunIdRef.current = null` → `onPhaseComplete()` → `setFailedPhaseIdx(-1)` → `advanceAfterPhase(currentPhase)`。
5. 命中 failed 时：`setError(\`${phase.label} 失败: ${run.errorMessage || '未知错误'}\`)` + `setRunning(false)` + `setCurrentPhase(-1)` + `setFailedPhaseIdx(currentPhase)` + `setElapsed(0)` + `phaseStartedAtRef.current = 0` + `onPhaseChange?.(null)`，**不**调 `onPhaseComplete`。
6. catch 块是静默兜底（`// 静默兜底：下一轮或 SSE 事件会继续接管状态。`）。
7. `useEffect` 依赖数组：`[running, currentPhase, projectId, onPhaseComplete, onPhaseChange, advanceAfterPhase]`。

把 polling 完整逻辑理清后再动手。**本轮目标是行为零变化**（同样的命中规则、同样的状态推进、同样的错误文案），只是把数据来源从 `setInterval` 改为 react-query。

## 第二步：在 query-client.ts 追加 query key 常量

修改：

```txt
apps/client/src/api/query-client.ts
```

在 `canvasAssetsPollingQueryKeys` 之后追加：

```ts
export const canvasPipelineRunsQueryKeys = {
  /** 单个项目的 pipeline-run 兜底轮询 query key；refetchInterval 由 hook 固定 3000ms */
  poll: (projectId: string) => ['canvas-pipeline-runs-poll', projectId] as const,
  /** 全部项目的 pipeline-run（用于全局 invalidate） */
  all: ['canvas-pipeline-runs-poll'] as const,
}
```

注意：

- 不要改既有 query keys 常量（包括上一轮加的 `canvasAssetsPollingQueryKeys`）。
- 不要 import 任何业务模块；query-client.ts 应保持纯常量 + queryClient 实例。

## 第三步：新建 useCanvasPipelineRunsPolling hook

新建：

```txt
apps/client/src/hooks/use-canvas-pipeline-runs-polling.ts
```

骨架（最终实现可能略有差异）：

```ts
import type { CanvasPipelineRun } from '@excuse/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { fetchCanvasPipelineRuns } from '@/api/client'
import { canvasPipelineRunsQueryKeys } from '@/api/query-client'
import { useRealtimeSync } from '@/stores/realtime-sync'

/** Pipeline-run 兜底轮询间隔（ms），与原 PipelineController 内 setInterval 一致 */
const PIPELINE_RUNS_POLL_INTERVAL_MS = 3000

export interface UseCanvasPipelineRunsPollingOptions {
  /** 是否启用轮询；通常 = `running && currentPhase >= 0` */
  enabled: boolean
}

/**
 * 兜底轮询 Canvas pipeline runs。
 *
 * 设计约束：
 * - SSE 主路径（`phaseDone` 事件）由 `useRealtimeSync` 接管并直接驱动 onPhaseComplete；
 *   本 hook 仅作为 SSE 断线 / 漏事件时的兜底，避免自动执行卡在 running。
 * - 不暴露业务推进逻辑（advance / setError）：消费方在 useEffect 里 watch `runs`，
 *   按 `activeRunId` 或 `phase.key + status` 命中规则推进，行为与原 setInterval 实现一致。
 * - `projectVersion` 变化时主动 invalidate，让 SSE 事件也能立刻触发一次 fetch（与 canvas 资产轮询一致）。
 */
export function useCanvasPipelineRunsPolling(
  projectId: string | undefined,
  options: UseCanvasPipelineRunsPollingOptions,
) {
  const queryClient = useQueryClient()
  const projectVersion = useRealtimeSync(s => projectId ? s.projectVersions[projectId] : 0)

  const enabled = Boolean(projectId) && options.enabled

  const queryKey = projectId
    ? canvasPipelineRunsQueryKeys.poll(projectId)
    : ['canvas-pipeline-runs-poll', 'disabled'] as const

  const query = useQuery<CanvasPipelineRun[]>({
    queryKey,
    queryFn: () => fetchCanvasPipelineRuns(projectId!),
    enabled,
    refetchInterval: enabled ? PIPELINE_RUNS_POLL_INTERVAL_MS : false,
    placeholderData: prev => prev, // 保持上一份数据，避免轮询时 UI 闪烁
    staleTime: 0, // 每次都重新请求（与原 polling 行为一致）
    gcTime: 30_000, // 项目切换后保留 30s，便于回切时秒显
  })

  // projectVersion 变化时（SSE 事件触发）→ invalidateQueries
  useEffect(() => {
    if (!projectId || projectVersion === 0)
      return
    queryClient.invalidateQueries({ queryKey: canvasPipelineRunsQueryKeys.poll(projectId) })
  }, [projectVersion, projectId, queryClient])

  return {
    /** 最新一次轮询拿到的 runs；首轮未完成时为 undefined */
    runs: query.data,
    /** 是否正在拉取（含初次 + refetch），等价于原 polling 的"正在轮询"语义 */
    isPolling: query.isFetching,
  }
}
```

实现要点：

- **返回 shape 极简**：只暴露 `{ runs, isPolling }`；业务推进逻辑留在消费方。
- `enabled` 由调用方传入（`running && currentPhase >= 0`）；hook 内部加 `projectId` 守卫。
- `refetchInterval` 用 `enabled ? 3000 : false` 切换；不需要根据 activeTasks 动态计算（pipeline-run 不是 idle/polling 双语义）。
- `placeholderData: prev => prev` 保持上一份数据，等价于原 setInterval 的"轮询时不清空"。
- 不要在 hook 内部直接订阅 phaseDone（保持职责单一；phaseDone 由 PipelineController 自己消费 useRealtimeSync）。

注意：

- 如果原 polling 还有「组件卸载时停止」逻辑，react-query 自动处理（useQuery 卸载即停止 refetch）。
- 如果原 polling 有「projectId 变化时立即重新拉」语义，react-query 通过 queryKey 变化自动触发新 query。
- 不要新增其他 hook / store；本轮只新建 useCanvasPipelineRunsPolling。

## 第四步：改造 PipelineController.tsx 用新 hook

修改：

```txt
apps/client/src/components/canvas/PipelineController.tsx
```

**删除** line 363-409 的整个 `useEffect`（SSE 兜底 polling），替换为：

```ts
// SSE 是主路径；polling 用作兜底，避免断线或漏事件时自动执行卡在 running。
const { runs: polledRuns } = useCanvasPipelineRunsPolling(projectId, {
  enabled: running && currentPhase >= 0,
})

// watch polledRuns，命中 succeeded/failed 时推进状态（行为与原 setInterval 一致）
useEffect(() => {
  if (!running || currentPhase < 0)
    return
  const phase = PHASES[currentPhase]
  if (!phase || !polledRuns)
    return

  const runId = activeRunIdRef.current
  const run = runId
    ? polledRuns.find(r => r.id === runId)
    : polledRuns.find(r => r.phase === phase.key && (r.status === 'succeeded' || r.status === 'failed'))

  if (!run)
    return

  if (run.status !== 'succeeded' && run.status !== 'failed')
    return

  activeRunIdRef.current = null
  onPhaseComplete()

  if (run.status === 'failed') {
    setError(`${phase.label} 失败: ${run.errorMessage || '未知错误'}`)
    setRunning(false)
    setCurrentPhase(-1)
    setFailedPhaseIdx(currentPhase)
    setElapsed(0)
    phaseStartedAtRef.current = 0
    onPhaseChange?.(null)
    return
  }

  setFailedPhaseIdx(-1)
  advanceAfterPhase(currentPhase)
}, [polledRuns, running, currentPhase, onPhaseComplete, onPhaseChange, advanceAfterPhase])
```

实现要点：

- **保留原命中规则**：`activeRunIdRef.current` 优先精确匹配，否则按 `phase.key + (succeeded|failed)` 模糊匹配。
- **保留原错误文案**：`${phase.label} 失败: ${run.errorMessage || '未知错误'}`。
- **保留原状态推进**：失败时 setRunning(false) + setCurrentPhase(-1) + setFailedPhaseIdx(currentPhase) + setElapsed(0) + phaseStartedAtRef.current = 0 + onPhaseChange?.(null)，不调 onPhaseComplete；成功时 setFailedPhaseIdx(-1) + advanceAfterPhase。
- **保留 catch 静默语义**：react-query 的 queryFn 抛错会进 `query.error`，不进 `query.data`；消费方仅看 `runs`，等同于原 catch 静默兜底。**不需要额外处理**。
- **依赖数组**：与原 useEffect 一致（`[running, currentPhase, projectId, onPhaseComplete, onPhaseChange, advanceAfterPhase]` 替换为 `[polledRuns, running, currentPhase, onPhaseComplete, onPhaseChange, advanceAfterPhase]`；`projectId` 由 hook 内部处理）。

注意：

- 不要改 line 149-211 的 mount restore 逻辑（一次性恢复，不是轮询）。
- 不要改 line 411-446 的 PAUSE_BEFORE / elapsed timer 逻辑（不是轮询）。
- 不要改 line 232-269 的 triggerPhase 逻辑（不是轮询）。
- 不要改 PHASES 元数据 / getPhaseIndex / RunningPhaseInfo 类型。

## 第五步：检查 CanvasEditor 等消费方

确认 PipelineController 的 props 接口不变（`projectId / project / modelPreferences / onPhaseComplete / onPhaseChange / phaseDone / onPhaseDoneConsumed`），消费方 CanvasEditor 不需要改：

```bash
grep -rn "PipelineController" apps/client/src/
```

如果消费方仅通过 props 传递数据，**不需要修改消费方**。

如果发现 PipelineController 暴露的 API 必须扩（如新增 ref / imperative handle），**先停止并在最终回复说明**，列出额外字段，决定是否扩 props 或调整。

**本轮目标是消费方零改动**；如果做不到，最小化消费方 diff（仅调整字段名 / 类型）。

## 第六步：补 hook 单元测试

新建：

```txt
apps/client/src/hooks/use-canvas-pipeline-runs-polling.test.ts
（或 apps/client/test/canvas-pipeline-runs-polling.test.ts，按 vitest config 现有约定）
```

至少覆盖：

1. **enabled=true** → useQuery 启动 + `refetchInterval=3000`（用 `vi.useFakeTimers` 推进 + `mockFetchCanvasPipelineRuns` 断言调用次数）。
2. **enabled=false**（如 `running=false`）→ useQuery 不启动 + `runs=undefined`。
3. **projectId 切换** → queryKey 切换，触发新 fetch（mock 返回不同 runs）。
4. **projectVersion 变化** → `invalidateQueries` 被调用（用 `queryClient.invalidateQueries` spy）。
5. **placeholderData**：第一次 fetch 完成前 `runs=undefined`；fetch 完成后变为数据；refetch 时 `runs` 不会回退到 undefined。
6. **返回 shape**：`{ runs, isPolling }` 2 个字段都存在；`isPolling` 在 fetch 期间为 true。
7. **mock fetchCanvasPipelineRuns 抛错** → `runs` 保持 undefined（兜底静默，不抛到消费方）。

测试注意：

- 用 `@testing-library/react` 的 `renderHook` + `waitFor` 测异步行为。
- mock `fetchCanvasPipelineRuns`（vitest mock）。
- 用 `QueryClientProvider` 包裹 hook，配置 `staleTime: 0` 等测试友好参数。
- mock `useRealtimeSync` 的 `projectVersion`（不要测真实 SSE）。
- 用 `vi.useFakeTimers` + `vi.advanceTimersByTime(3000)` 推进 refetchInterval；或用 `waitFor` 等真实 setTimeout。

## 第七步：更新 TODO 和 CHANGELOG

修改 `docs/TODO.md`：

- 在 P4.1 第 2 条「`@tanstack/react-query`」下方追加一行（不删条目）：

```txt
   - ✅ Canvas 资产轮询、CanvasEditor 项目刷新、PipelineController 兜底轮询已迁移到 react-query（commit: `<本轮 hash>`）。
```

- 不要碰 P0 / P1 / P2 / P3 / P4 其他章节，避免与 Claude B 在 metrics 区域的修改撞行。
- 不要碰 P2.5 Metrics 章节（Claude B 当前在动）。

修改根目录 `CHANGELOG.md`：

- 在 `[Unreleased]` 的 Changed 区追加：

```txt
- Canvas pipeline-run 兜底轮询改造为 react-query：`apps/client/src/components/canvas/PipelineController.tsx` line 364-409 手写 `setInterval` + `useEffect` 重写为消费新建 hook `useCanvasPipelineRunsPolling`（`apps/client/src/hooks/use-canvas-pipeline-runs-polling.ts`），hook 用 `useQuery` + `refetchInterval=3000` + `placeholderData` 保持上一份数据；命中 succeeded/failed 的状态推进逻辑（按 `activeRunIdRef` 精确 / `phase.key + status` 模糊匹配 + 失败文案 `${phase.label} 失败: ${errorMessage || '未知错误'}`）迁移到消费方 watch `runs` 的 useEffect，行为零变化；`apps/client/src/api/query-client.ts` 追加 `canvasPipelineRunsQueryKeys` 常量；`projectVersion` 变化通过 `queryClient.invalidateQueries` 走 react-query 统一失效路径；补 hook 单元测试覆盖 enabled 切换 / projectId 切换 / projectVersion invalidate / placeholderData / 错误兜底（commit: `<本轮 hash>`）。
```

- 写入本轮 commit 短 hash（commit 完成后回填）。

如果文档与 Claude B 冲突：

- 不要覆盖 Claude B 的 metrics 记录。
- 可以先提交代码，文档冲突在最终回复里说明。

## 验证命令

至少运行：

```bash
bun run --cwd apps/client test -- use-canvas-pipeline-runs-polling
bun run --cwd apps/client typecheck
```

如时间允许，再运行：

```bash
bun run typecheck
bun run lint
bun run --cwd apps/client test
```

如果 lint 因 Claude B 并行未提交文件失败，不要修改 Claude B 文件；最终回复说明。

## 推荐 commit

```bash
git add apps/client/src/components/canvas/PipelineController.tsx \
  apps/client/src/hooks/use-canvas-pipeline-runs-polling.ts \
  apps/client/src/hooks/use-canvas-pipeline-runs-polling.test.ts \
  apps/client/src/api/query-client.ts \
  docs/TODO.md \
  CHANGELOG.md

git diff --name-only --cached
```

⚠️ 如果第五步发现必须改 `CanvasEditor.tsx` 或其他边界外文件，把该文件加入 add 列表；但**仅限最小 diff**，并在最终回复说明原因。

**强制检查**：commit 前必须确认 `git diff --name-only --cached` 输出**不包含**：

- `packages/`（任何路径）
- `apps/server/`（任何路径）
- `apps/worker/`（任何路径）
- `apps/client/src/api/sse.ts`
- `apps/client/src/api/client.ts`
- `apps/client/src/stores/realtime-sync.ts`（如未修改，不要 add）
- `apps/client/src/pages/Assets.tsx`
- `apps/client/src/pages/CanvasEditor.tsx`（如未修改，不要 add）
- `apps/client/src/components/canvas/`（除 `PipelineController.tsx`）
- `apps/client/src/hooks/use-canvas-assets-polling.ts`

确认无误后提交：

```bash
git commit -m "refactor(canvas): migrate pipeline-run fallback polling to react-query"
```

最终回复必须包含：

- 本轮 commit hash。
- 实际运行的验证命令（特别是 client typecheck 输出）。
- `git diff --name-only --cached` 的最终输出（证明未跨界）。
- 第一步「调研」结果：原 polling 的关键命中规则（activeRunId 精确 vs phase.key 模糊）、错误文案、状态推进顺序。
- 第五步「消费方」结果：CanvasEditor 等消费方是否需要改动，原因。
- 一个真实的命中示例（来自不同 currentPhase + run.status 组合），便于后续维护。
- 与 Claude B 是否有冲突（特别是 `docs/TODO.md` / `CHANGELOG.md`）。
