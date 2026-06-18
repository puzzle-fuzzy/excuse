# TODO

> 审计日期：2026-06-19  
> 审计范围：`apps/client`、`apps/server`、`apps/worker`、`packages/*`、根配置、脚本与现有测试。  
> 当前总体判断：项目已经具备清晰的 Bun + Elysia + React monorepo 形态，领域包、任务队列、SSE、计费、Provider、Canvas 流水线和测试体系都有基础。但随着功能增长，部分包边界、前端页面职责、运行时配置和测试结构开始出现“可维护性债务”。下面 TODO 按风险和收益排序。

## 建议执行顺序

1. ~~P0-1/2/3 架构治理~~ ✅（`15df5506`, `71d1cdbe`, `12a2a0de`）
2. ~~P1-6/7 脚本+引用~~ ✅（`dcaa6861`）
3. ~~P2-9 输入限制~~ ✅（`991d6a9c`）
4. ~~P3-11/12 规则+ADR~~ ✅（`f1846b11`, `2f65d8cd`）
5. ~~P2-10 clientLogger~~ ✅（`9ec7e135`）
6. ~~P1-5 统一命名~~ ✅（`7ad18c77`）
7. ~~P2-8 测试覆盖升级~~ ✅（`b52800f0`）
8. ~~P1-4 ModelLab 拆分~~ ✅（`25ed1061`）
8. 做 P1-4 拆分前端大页面 ModelLab.tsx（进行中）

## 本次审计已运行的检查

- `bun run check:boundaries`：通过。
- 代码规模抽样：最大业务页面/模块集中在 `ModelLab.tsx`、`Assets.tsx`、`ShotReferenceAssets.tsx`、`dashscope-client.ts`、`task-engine/src/index.ts` 等。
- 测试规模抽样：现有测试覆盖较多，但大测试文件和厚 mock 需要继续拆分治理。
