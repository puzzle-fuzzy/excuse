# TODO

> 审计日期：2026-06-19  
> 审计范围：`apps/client`、`apps/server`、`apps/worker`、`packages/*`、根配置、脚本与现有测试。  
> 当前总体判断：项目已经具备清晰的 Bun + Elysia + React monorepo 形态，领域包、任务队列、SSE、计费、Provider、Canvas 流水线和测试体系都有基础。但随着功能增长，部分包边界、前端页面职责、运行时配置和测试结构开始出现“可维护性债务”。本次审计列出的治理项已按风险和收益排序执行完毕（见「执行状态」）。

## 执行状态

本次审计的 12 项待办（P0-1/2/3、P1-4/5/6/7、P2-8/9/10、P3-11/12）**已全部完成**，逐项经源码与提交验证为真（见下「核查结论」）。完成记录与对应 commit 写入 [`CHANGELOG.md`](./CHANGELOG.md)，不在本文件保留 commit 历史。

> 无未完成项。后续新增迭代待办请新增条目。

## 本次审计已运行的检查

- `bun run check:boundaries`：通过。
- 代码规模抽样：最大业务页面/模块集中在 `ModelLab.tsx`、`Assets.tsx`、`ShotReferenceAssets.tsx`、`dashscope-client.ts`、`task-engine/src/index.ts` 等。
- 测试规模抽样：现有测试覆盖较多，但大测试文件和厚 mock 需要继续拆分治理。

## 核查结论（2026-06-19 复核）

逐项核对「执行状态」中 12 项的提交与产物，确认全部真实完成：

- **P0-1/2/3 架构治理** — `CanvasRuntimeAdapters` 接口、共享 env-helpers、server `bootstrap.ts`/worker lifecycle 均已落地（commit `15df5506`/`71d1cdbe`/`12a2a0de`）。
- **P1-4 ModelLab 拆分** — `ModelLab.tsx` 实测 588 行（810→588），`useModelLabModels.ts` hook 与 `ModelComparisonSection.tsx` 组件均已存在（commit `25ed1061`/`45c06943`/`93a90d5c`）。
- **P1-5/6/7、P2-8/9/10、P3-11/12** — 各自 commit 与 CHANGELOG 记录一致，源码可验证。

完整验收套件复核全绿：

- `check:boundaries` ✅ · `typecheck` ✅（server/client/worker/e2e 全 0）· `lint` ✅（0 error，20 预存 warning 均在 `scripts/`）· `build` ✅ · `test` ✅（server 554/0、worker/packages 全绿）· `test:client` ✅（376/0）

> ⚠️ 复核附记：`apps/client` 的 `tsc -b` 增量 buildinfo（`node_modules/.tmp/tsconfig.app.tsbuildinfo`）曾处于损坏状态，会逐文件抛出 **虚假的** `TS6133/TS6192 unused` 报错且每次报错文件不同（如一度误报 `Workspace.tsx` 的 `ScrollArea`、`Canvas.tsx` 的 `Video`，实际二者均在用 / 不存在该 import）。删除 buildinfo 全量重建后恢复正常。属本地一次性缓存故障（文件在 `.gitignore` 内），非代码缺陷；若再遇 client typecheck 报单文件 unused 错误，先删该 buildinfo 再重建。
