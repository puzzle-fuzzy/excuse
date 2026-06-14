# Claude B 下一轮执行计划：worker 资金类操作审计收口

更新时间：2026-06-14

本文给 Claude B 执行。Claude A 当前在处理 **资产中心 - 标签功能（v1）**（工作区已就绪：`asset_tags` / `asset_tag_assignments` schema + migration `0027_productive_exiles.sql` + asset-tags route + Assets.tsx 标签管理 modal 等待提交），Claude B 本轮收口 P2.3 Audit 第二条「worker 内部 debit/refund 的审计策略」，把 worker 进程里的资金类操作（视频任务扣款 / 退款 / 超时退款）补上审计，与 server Gateway 路径形成闭环。不要碰资产中心、Canvas 组件、API Key 页面、DB schema 表、Provider / Gateway route、Metrics。

## 上轮复核结论（已通过）

上一轮 Claude B 完成并提交：

- `82ce120 feat(notifications): deep link to canvas shot on click`
- `c26b009 docs(changelog): backfill notification deep link commit hash`

复核结果：

- `apps/worker/test/task-processor.test.ts`：28 pass / 0 fail / 60 expect() calls（含 canvas / 非 canvas / 失败 / 超时 4 个 meta payload case）。
- `apps/client/test/notification-target.test.ts`：14 pass / 0 fail（优先级矩阵全覆盖）。
- `apps/client/src/lib/notification-target.ts`：纯函数实现，优先级 `projectId+shotId` → `projectId` → `recordId` → undefined 清晰；无 React / router / fetch 依赖。
- `apps/client/src/components/Navbar.tsx`：commit message 注明顺手修复了「task_failed 无 recordId 时不再误跳 /」的边界 case。
- `packages/db/src/domain-types.ts`：仅 TypeScript interface 扩展（NotificationMeta 加 shotId），不动 schema 表。
- `apps/worker/src/task-processor.ts`：三处 notifyUser meta 都正确使用 `...(canvasMeta && { projectId, shotId })` 展开。
- `docs/TODO.md` P2.2：第二条「通知点击定位」整条删除；保留第一条「API Key 过期/额度不足/异常调用」（独立任务）。
- `CHANGELOG.md` Added 区已记录并回填 commit `82ce120`。

注：当前工作区 `bun run typecheck` 失败的错误全部来自 `apps/client/src/pages/Assets.tsx`（Claude A 未提交的标签任务中间状态：`tagManageOpen` / `TagManagementModal` / `deleting` 未使用、`tagIds` 类型 string vs string[]），与 Claude B 改动无关。Claude B 自己的代码 typecheck 通过。

保持上一轮的纪律。

## 本轮目标

收口 P2.3 Audit 第二条「worker 内部 debit/refund 的审计策略」。

当前状态：

- `auditActionEnum`（`packages/db/src/schema/audit-logs.ts`）已含 `credit_reserve` / `credit_debit` / `credit_refund` / `gateway_call` 等资金/调用类枚举，server 侧 Gateway 路径已在用。
- `CreditFlowDetail`（`packages/db/src/domain-types.ts:494`）已定义 `source: 'generate' | 'retry' | 'gateway' | 'worker_video'` —— **`worker_video` 已预留**，但当前无任何代码使用。
- `apps/server/src/services/audit.ts` 提供 `audit(action, opts)` helper，依赖 `@excuse/db` 的 `createAuditLog`。
- `apps/worker/src/task-processor.ts` 内三处资金类调用 **没有审计**：
  - 超时失败 → `refundReservedCredit()` → `refund()`（约 line 110-141）
  - 成功 → `debit()`（约 line 178-184）
  - 失败 → `refundReservedCredit()` → `refund()`（约 line 249-281）
- worker 因为架构边界 **不能 import `apps/server/src/services/audit`**，但可以直接 import `@excuse/db` 的 `createAuditLog`。

本轮要做的：

1. **新建 `apps/worker/src/services/audit.ts`**：轻量 audit helper（仿 server 的 `audit()` 函数，但路径独立、依赖 `@excuse/db` 的 `createAuditLog`）。
2. **task-processor.ts 三处资金类调用补 audit**：
   - 成功扣款 → `audit('credit_debit', { detail: { source: 'worker_video', ... } })`
   - 失败退款 + 超时退款 → `audit('credit_refund', { detail: { source: 'worker_video', ... } })`
3. **canvas-videos.ts 检查**：如果镜头视频提交阶段涉及 credit reserve/debit/refund（实际上不一定有，看代码），按需补 audit；如果该路径无资金操作，跳过并在最终回复说明。
4. **补 worker audit helper 单元测试 + task-processor 调用伴随 audit 测试**。
5. 在 `docs/TODO.md` 把 P2.3 第二条整条删除。
6. 在 `CHANGELOG.md` `[Unreleased]` 记录本轮完成内容和 commit。

本轮不要处理：

- P2.3 第一条「决策 notification 读取、全部已读等用户行为是否需要审计」— 决策类任务，本轮**附带决策**：通知读取不审计（与 favorite toggle 一致，高频内部操作不进 audit），但不实施「读取审计」，仅写决策到 TODO 注释；最终回复说明。
- P2.3 第三条「管理后台是否展示 audit」— 独立任务，本轮不做。
- worker 内部其他非资金类操作（如 task claim/release、orphan sweep）的审计 — v1 不做（不是产品安全敏感操作）。
- 资产中心、Canvas 组件、API Key 页面、开发者页、Metrics、Gateway route、Provider。
- DB schema 表结构变更（本轮完全不需要扩 `audit_action` 枚举，所有需要的值已存在）。
- DB migration 文件。
- 既有 audit 调用点（server 侧 Gateway / canvas / api-keys）的修改。

## 重要规则：完成后必须 commit

- 本轮 1 个 commit（hash 回填可以追一个 docs commit）。
- commit 前必须运行 `git status --short` 和 `git diff --name-only --cached`。
- 暂存区只能包含本任务文件，**绝对不要**混入 Claude A 的 asset-tags / asset-library / Assets.tsx / shared/assets.ts 文件。
- 完成事项从 `docs/TODO.md` 删除（P2.3 第二条整条删除）。
- 完成记录和 commit 写入根目录 `CHANGELOG.md`。
- 如果 `docs/TODO.md` / `CHANGELOG.md` 与 Claude A 并行修改冲突，优先提交代码；文档冲突在最终回复里说明。
- commit 成功后，在最终回复里写出 commit hash。

**强制检查**：commit 前必须确认 `git diff --name-only --cached` 输出**不包含**：

- `packages/db/src/schema/`（**绝对不动任何 pgTable**；本轮零 schema 变更）
- `packages/db/drizzle/`
- `packages/db/src/domain-types.ts`（`CreditFlowDetail.source` 已含 `'worker_video'`，本轮不动）
- `packages/db/src/repositories/audit-logs.repo.ts`（已有 `createAuditLog`，本轮不动）
- `packages/shared/src/assets.ts`
- `packages/shared/src/asset-tags.ts`
- `apps/server/src/routes/assets.ts`
- `apps/server/src/routes/asset-tags.ts`
- `apps/server/src/services/audit.ts`（server 已有 audit，本轮不动）
- `apps/server/src/routes/openai-gateway.ts`
- `apps/server/src/routes/notifications.ts`
- `apps/server/src/routes/metrics.ts`
- `apps/server/src/routes/health.ts`
- `apps/server/src/services/metrics.ts`
- `apps/server/src/config.ts`
- `apps/server/src/index.ts`
- `apps/client/**`
- `packages/gateway/`
- `packages/provider/`
- `packages/metrics/`
- `apps/worker/src/canvas-videos.ts`（仅在第三步检查发现需要审计时才动；否则不动）

## 文件边界

Claude B 可以新建：

```txt
apps/worker/src/services/audit.ts               (轻量 audit helper，仿 server 但路径独立)
apps/worker/src/services/index.ts               (export audit；如 worker 还没 services/index.ts 可一并新建)
apps/worker/test/audit.test.ts                  (audit helper 单元测试)
```

Claude B 可以修改：

```txt
apps/worker/src/task-processor.ts               (debit / 两处 refund 调用伴随 audit)
apps/worker/test/task-processor.test.ts         (扩 audit 调用断言)
apps/worker/src/canvas-videos.ts                (仅在第三步发现镜头视频提交涉及资金操作时；否则不动)
docs/TODO.md
CHANGELOG.md
```

Claude B 不要修改：

```txt
docs/claude-next-plan.md
packages/db/**                                    (本轮绝对不动；audit_action 枚举 + CreditFlowDetail 已有所需值)
packages/shared/**
packages/gateway/**
packages/provider/**
packages/metrics/**
packages/auth/**
packages/events/**
packages/workflow-engine/**
packages/task-engine/**
apps/server/**                                    (本轮绝对不动 server)
apps/client/**                                    (本轮绝对不动客户端)
apps/worker/src/index.ts                          (主轮询循环，本轮不动)
apps/worker/src/task-handler.ts                   (任务分发器，本轮不动)
apps/worker/src/canvas-handlers.ts                (canvas 阶段任务处理器，本轮不动)
apps/worker/src/canvas-execution.ts
apps/worker/src/pipeline-stepper.ts
apps/worker/src/canvas-analysis.ts
apps/worker/src/canvas-character-refs.ts
apps/worker/src/canvas-characters.ts
apps/worker/src/canvas-continuity.ts
apps/worker/src/canvas-location-refs.ts
apps/worker/src/canvas-locations.ts
apps/worker/src/canvas-rebuild.ts
apps/worker/src/canvas-storyboard.ts
apps/worker/src/subtitle-processor.ts
apps/worker/src/heartbeat.ts
apps/worker/src/health.ts
apps/worker/src/config.ts
apps/worker/test/config.test.ts
apps/worker/test/pipeline-stepper.test.ts
apps/worker/test/subtitle-processor.test.ts
```

如果必须修改边界外文件，**先停止并在最终回复说明原因**。

## 第一步：调研 worker 内部资金类调用点

仔细阅读 `apps/worker/src/task-processor.ts`，定位所有 `debit(...)` / `refund(...)` 调用：

预期位置：

1. **超时失败分支**（约 line 108-141）：
   - `await refundReservedCredit(record, refund, '视频任务超时退款')`（约 line 110）
   - `refundReservedCredit` 内部调用 `refund({...})`（约 line 313-322）

2. **成功分支**（约 line 178-184）：
   - `await debit({ accountId, generationRecordId, actualCents, description })`（约 line 178）

3. **失败分支**（约 line 249-281）：
   - `await refundReservedCredit(record, refund, ...)`（约 line 249）

4. **其他 worker 资金调用**：grep 全仓库确认：
   ```bash
   grep -rn "debit\|refund\|reserveCredit" apps/worker/src/
   ```
   预期除了 task-processor 外，`canvas-videos.ts`、`canvas-handlers.ts` 等可能也有调用；如果发现，纳入本轮范围（按相同的 source: 'worker_video' 模式审计）。

如果发现某些资金调用**已经**有审计（之前漏看），跳过该调用点，最终回复说明。

## 第二步：新建 worker audit helper

新建：

```txt
apps/worker/src/services/audit.ts
```

实现（参考 `apps/server/src/services/audit.ts`，保持 API 一致）：

```ts
import type { auditActionEnum, AuditDetail } from '@excuse/db'
import { createAuditLog } from '@excuse/db'
import { createLogger } from '@excuse/shared'

const logger = createLogger('worker-audit')

type AuditAction = typeof auditActionEnum.enumValues[number]

export interface WorkerAuditEntry {
  accountId?: string
  action: AuditAction
  targetId?: string
  detail?: AuditDetail
}

export type WorkerAuditWriter = (entry: WorkerAuditEntry) => Promise<void>

let auditWriter: WorkerAuditWriter = createAuditLog
let auditEnabled = Bun.env.NODE_ENV !== 'test'

/** 测试注入：替换 writer（与 server 的 setAuditWriter 风格一致） */
export function setWorkerAuditWriter(writer: WorkerAuditWriter): void {
  auditWriter = writer
  auditEnabled = true
}

/** 测试清理：恢复默认 writer */
export function resetWorkerAuditWriter(): void {
  auditWriter = createAuditLog
  auditEnabled = Bun.env.NODE_ENV !== 'test'
}

/**
 * 记录审计日志 — 失败时只 log 不阻塞业务
 *
 * 与 server 的 audit() 函数行为一致；独立路径避免 worker → server 反向依赖。
 * worker 不收集 IP（不在 HTTP 请求上下文），所以入参没有 ip 字段。
 */
export async function audit(
  action: AuditAction,
  opts?: {
    accountId?: string
    targetId?: string
    detail?: AuditDetail
  },
): Promise<void> {
  if (!auditEnabled)
    return
  try {
    await auditWriter({ action, ...opts })
  }
  catch (err) {
    logger.error({ action, err }, 'worker 审计日志写入失败')
  }
}
```

新建（如果 worker 还没有 services barrel）：

```txt
apps/worker/src/services/index.ts
```

```ts
export * from './audit'
```

注意：

- **不要**复用 `apps/server/src/services/audit.ts` 的代码（架构边界：worker 不依赖 server）。
- **不要**新增 `ip` 字段（worker 不在 HTTP 请求上下文）。
- `Bun.env.NODE_ENV !== 'test'` 默认关闭测试模式，与 server 行为一致。
- 类型 `AuditAction` 直接取 `auditActionEnum.enumValues[number]`，不需要手工维护枚举列表。
- `AuditDetail` union 已含 `CreditFlowDetail`（domain-types.ts:494），detail 类型推导正确。

## 第三步：检查 canvas-videos.ts 是否需要审计

阅读 `apps/worker/src/canvas-videos.ts`，确认镜头视频提交阶段是否调用 `debitCredit` / `refundCredit` / `reserveCredit`：

```bash
grep -n "debit\|refund\|reserveCredit" apps/worker/src/canvas-videos.ts
```

预期结果：

- 如果**无任何资金调用**（镜头视频提交只是创建 task，扣款在 task-processor 轮询成功后做）：跳过本步，最终回复说明「canvas-videos.ts 不涉及资金操作，无需审计」。
- 如果**有资金调用**：在调用处补 audit，使用与 task-processor 相同的 `source: 'worker_video'` 模式。

**不要**为了审计而修改 `canvas-videos.ts` 已有的 `notifyNotification` 调用（那是通知路径，不是审计路径）。

## 第四步：task-processor 三处资金调用伴随 audit

修改：

```txt
apps/worker/src/task-processor.ts
```

4.1 import 新 helper：

```ts
import { audit } from './services/audit'
```

4.2 **超时失败分支**（约 line 110-141）：在 `await refundReservedCredit(record, refund, '视频任务超时退款')` **之后**加 audit：

```ts
await refundReservedCredit(record, refund, '视频任务超时退款')
await audit('credit_refund', {
  accountId: record.accountId,
  targetId: record.id,
  detail: {
    accountId: record.accountId,
    generationRecordId: record.id,
    amountCents: record.cost?.totalPriceCents ?? 0,
    description: '视频任务超时退款',
    source: 'worker_video',
  },
}).catch(err => logger.warn({ err, recordId: record.id }, 'Failed to audit credit_refund on timeout'))
```

注意：

- 在 `refundReservedCredit` 之后审计（确认 refund 成功才记审计）；如果 refund 本身失败，审计也跳过（资金未流动）。
- `amountCents` 取 `record.cost?.totalPriceCents ?? 0`：超时分支不一定有 cost，缺省 0 表示「未扣款也未退款」。
- `source: 'worker_video'` —— 使用 `CreditFlowDetail` 已预留的来源。

4.3 **成功分支**（约 line 178-184）：在 `await debit({...})` **之后**加 audit：

```ts
if (actualCost?.totalPriceCents && actualCost.totalPriceCents > 0) {
  await debit({
    accountId: record.accountId,
    generationRecordId: record.id,
    actualCents: actualCost.totalPriceCents,
    description: `视频生成成功扣款：${record.model}`,
  })
  await audit('credit_debit', {
    accountId: record.accountId,
    targetId: record.id,
    detail: {
      accountId: record.accountId,
      generationRecordId: record.id,
      amountCents: actualCost.totalPriceCents,
      description: `视频生成成功扣款：${record.model}`,
      source: 'worker_video',
    },
  }).catch(err => logger.warn({ err, recordId: record.id }, 'Failed to audit credit_debit'))
}
```

4.4 **失败分支**（约 line 249-281）：在 `await refundReservedCredit(record, refund, ...)` **之后**加 audit：

```ts
await refundReservedCredit(record, refund, `视频生成失败退款：${record.model}`)
await audit('credit_refund', {
  accountId: record.accountId,
  targetId: record.id,
  detail: {
    accountId: record.accountId,
    generationRecordId: record.id,
    amountCents: record.cost?.totalPriceCents ?? 0,
    description: `视频生成失败退款：${record.model}`,
    source: 'worker_video',
  },
}).catch(err => logger.warn({ err, recordId: record.id }, 'Failed to audit credit_refund'))
```

注意：

- 三处 audit 都用 `.catch(err => logger.warn(...))`，**审计失败不阻塞业务**（与 server 行为一致）。
- 不要修改 `debit` / `refund` / `refundReservedCredit` 函数本身的签名；只在调用之后追加 audit。
- 不要把 audit 包到 `if (actualCost?.totalPriceCents > 0)` 之外（成功扣款的 audit 必须在金额 > 0 时才记，与 debit 调用条件一致）。
- 不要 audit `notifyUser` 或 `notify` 调用（通知 ≠ 审计，两条路径独立）。

## 第五步：补 worker audit helper 测试

新建：

```txt
apps/worker/test/audit.test.ts
```

至少覆盖：

1. `NODE_ENV !== 'test'` 默认启用，audit 调用 → createAuditLog 被调用 1 次，参数正确。
2. `NODE_ENV === 'test'` 默认禁用，audit 调用 → createAuditLog **不**被调用。
3. `setAuditWriter(customWriter)` 注入后，audit 调用 → customWriter 被调用，createAuditLog **不**被调用。
4. `resetWorkerAuditWriter()` 后，audit 调用 → 恢复默认 writer。
5. writer 抛错时，audit 函数本身**不**抛错（仅 logger.error）。

测试注意：

- 用 `setWorkerAuditWriter(mockWriter)` 注入 mock，避免依赖 DB。
- 每个测试 `afterEach(() => resetWorkerAuditWriter())`，避免污染后续测试。
- 用 `Bun.env.NODE_ENV` 控制 enable/disable；测试时可通过 `process.env.NODE_ENV = 'test'` 显式禁用，或 `setWorkerAuditWriter` 覆盖（推荐后者，避免全局 env 改动）。

## 第六步：扩 task-processor 测试

修改：

```txt
apps/worker/test/task-processor.test.ts
```

至少新增以下用例（建议新 `describe('credit audit', ...)`）：

1. **成功路径**：mock queryTask 返回 SUCCEEDED + actualCost.totalPriceCents > 0 → debit 调用 1 次 + `audit('credit_debit', ...)` 调用 1 次，detail.source === 'worker_video'。
2. **失败路径**：mock queryTask 返回 FAILED + record.cost.totalPriceCents > 0 → refund 调用 1 次 + `audit('credit_refund', ...)` 调用 1 次，detail.source === 'worker_video'。
3. **超时路径**：record.createdAt 早于 staleTimeoutMs 前 → refund 调用 1 次 + `audit('credit_refund', ...)` 调用 1 次，detail.description 含「超时」。
4. **金额为 0 的成功**：actualCost.totalPriceCents === 0 → debit **不**调用，`audit('credit_debit', ...)` **不**调用（与 debit 条件一致）。
5. **金额为 0 的失败**：record.cost.totalPriceCents === 0 → refund **不**调用（`refundReservedCredit` 内置短路），audit 也不调用。
6. **audit 抛错不阻塞业务**：mock audit writer 抛错 → debit/refund 仍正常返回，业务流程不中断（这条最难测，可以跳过或仅断言 logger.warn 被调用）。

测试注意：

- 用 `setWorkerAuditWriter(mockAuditWriter)` 注入 mock writer，验证 `mockAuditWriter.mock.calls[0][0]` 的 action / detail 字段。
- `afterEach(() => resetWorkerAuditWriter())`。
- 不要 mock `@excuse/db` 的 `createAuditLog`（用 writer 注入更干净）。
- 既有 notifyUser meta payload 测试不能破坏（上一轮 Claude B 加的 4 个 case）。

## 第七步：更新 TODO 和 CHANGELOG

修改 `docs/TODO.md`：

- 把 P2.3「Audit」中的第二条**整条删除**：

```txt
- worker 内部 debit/refund 的审计策略。
```

- 在 P2.3 待办下方追加一行**决策注释**（反映本轮附带决策，不算待办）：

```txt
- （决策：notification 读取、全部已读等用户行为不进 audit；参照 favorite toggle 等高频内部操作。下一轮如产品要求再开任务。）
```

- 保留 P2.3 第一条「决策 notification 读取...」原条目删除，由上面决策注释替代；或保留原条目但加 `（已决策：不审计）` 后缀。**两选一，由实施时根据上下文清晰度决定**，最终回复说明。
- 保留 P2.3 第三条「管理后台是否展示 audit」。
- 不要碰 P2.2 / P2.4 / P2.5 / P2.6 / P3 章节，避免与 Claude A 在资产中心区域的修改撞行。
- 不要碰 P1.1 资产中心章节（Claude A 当前在动）。

修改根目录 `CHANGELOG.md`：

- 在 `[Unreleased]` 的 Added 区追加：

```txt
- worker 资金类操作审计收口：新建 `apps/worker/src/services/audit.ts` 轻量 audit helper（仿 server 但路径独立，依赖 `@excuse/db` 的 `createAuditLog`，支持 writer 注入与 NODE_ENV=test 禁用）；`apps/worker/src/task-processor.ts` 三处资金调用伴随 audit — 成功扣款 → `credit_debit`、失败退款 / 超时退款 → `credit_refund`，detail 复用既有 `CreditFlowDetail` DTO 并显式标 `source: 'worker_video'`；audit 失败仅 `logger.warn` 不阻塞业务（与 server 行为一致）；补 worker audit helper 单元测试 + task-processor 调用伴随 audit 测试（commit: `<本轮 hash>`）。
```

- 写入本轮 commit 短 hash（commit 完成后回填）。

如果文档与 Claude A 冲突：

- 不要覆盖 Claude A 的资产标签记录。
- 可以先提交代码，文档冲突在最终回复里说明。

## 验证命令

至少运行（**必须加 `--isolate`**，避免 mock.module 跨文件污染）：

```bash
bun test --isolate apps/worker/test/audit.test.ts apps/worker/test/task-processor.test.ts
bun run --cwd apps/worker typecheck
```

⚠️ **typecheck 注意**：当前工作区因 Claude A 未提交的标签任务导致 `bun run typecheck`（根目录）失败。本轮**只需保证 worker 自己的 typecheck 通过**：

```bash
bun run --cwd apps/worker typecheck
```

不要修改 Claude A 的 Assets.tsx / asset-library.ts 来让根 typecheck 通过 — 那是 Claude A 的责任。

如时间允许（且 Claude A 已提交），再运行：

```bash
bun run typecheck
bun run lint
```

如果 lint 因 Claude A 并行未提交文件失败，不要修改 Claude A 文件；最终回复说明。

## 推荐 commit

```bash
git add apps/worker/src/services/audit.ts \
  apps/worker/src/services/index.ts \
  apps/worker/test/audit.test.ts \
  apps/worker/src/task-processor.ts \
  apps/worker/test/task-processor.test.ts \
  apps/worker/src/canvas-videos.ts \
  docs/TODO.md \
  CHANGELOG.md

git diff --name-only --cached
```

**强制检查**：commit 前必须确认 `git diff --name-only --cached` 输出**不包含**：

- `packages/`（任何子路径，本轮零 package 改动）
- `apps/server/`（任何子路径，本轮零 server 改动）
- `apps/client/`（任何子路径，本轮零 client 改动）
- `apps/worker/src/canvas-videos.ts` 仅在第三步实际修改时纳入

确认无误后提交：

```bash
git commit -m "feat(worker): audit credit debit/refund for video tasks"
```

如果 `docs/TODO.md` / `CHANGELOG.md` 因并行修改不能安全纳入提交：

```bash
git restore --staged docs/TODO.md CHANGELOG.md
git commit -m "feat(worker): audit credit debit/refund for video tasks"
```

最终回复必须包含：

- 本轮 commit hash。
- 实际运行的验证命令（特别是 worker typecheck 输出）。
- `git diff --name-only --cached` 的最终输出（证明未跨界）。
- 第一步「调研」结果：列出找到的所有 worker 资金调用点（除 task-processor 三处外是否还有其他）。
- 第三步「canvas-videos 检查」结果：是否需要修改 canvas-videos.ts，原因。
- 第七步「TODO P2.3 第一条决策」结果：通知读取审计的决策（不审计）+ TODO 里如何标注。
- 一个真实 worker audit detail payload 示例（来自成功路径 `credit_debit`），便于后续维护。
- 与 Claude A 是否有冲突（特别是 `docs/TODO.md` / `CHANGELOG.md`）。
- 如果 TODO / CHANGELOG 未提交，说明原因。
