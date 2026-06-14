# Claude A 下一轮执行计划：资产中心 - 标签功能（v1）

更新时间：2026-06-14

本文给 Claude A 执行。Claude B 当前在处理 **Metrics Prometheus 文本格式 + `/metrics` 端点**（工作区已就绪但尚未提交：`packages/metrics/src/prometheus.ts` + `apps/server/src/routes/metrics.ts` + `apps/server/src/config.ts` + `apps/server/src/index.ts` 等待 commit）。Claude A 本轮做资产中心列表的「标签」能力（schema 两张新表 + 全栈贯通），收口 P1.1「资产中心升级」剩余唯一未完成子项。不要碰 Metrics、Gateway、Provider、API Key 页面、Canvas 组件。

## 上轮复核结论（已通过）

上一轮 Claude A 完成并提交：

- `efeaa11 feat(assets): add favorite filter and toggle endpoints`
- `7b48ce9 docs(changelog): backfill favorite commit hash`

复核结果：

- `apps/server/test/assets-routes.test.ts`：50 pass / 0 fail / 134 expect() calls（含 favorite 端点 + GET favorite 过滤 + 跨用户隔离）。
- `apps/client/test/assets-page.test.tsx` + `asset-library.test.ts`：2 files / 133 tests passed。
- `bun run typecheck`：server / client / worker 三端通过。
- `packages/db/src/schema/asset-favorites.ts` + migration `0026_fuzzy_baron_zemo.sql`：用 `unique('idx_asset_favorites_unique').on(...)` 形成真正的 UNIQUE CONSTRAINT，幂等行为正确。
- `packages/db/src/repositories/asset-favorites.repo.ts`：`onConflictDoNothing().returning()` 命中冲突时回查，行为正确。
- `apps/server/src/routes/assets.ts`：favorite 注入在 sort 之后、hasMore 之前；toggle 端点 `{ success: true, data: { isFavorite } }` 权威返回。
- `packages/db/src/schema/audit-logs.ts`：**未被越界修改**，决策「favorite toggle 不审计」正确避开了既有 schema 边界。
- `docs/TODO.md` P1.1 已收窄为「高级筛选 UI 优化：标签（排序、收藏已完成）」。
- `CHANGELOG.md` Added 区已记录并回填 commit `efeaa11`。

保持上一轮的纪律。

## 本轮目标

收口 P1.1 资产中心最后一块：标签能力。完成后 P1.1 全部子项完结。

产品形态（v1，简化的 UI）：

- 用户可在「标签管理」面板创建 / 删除个人标签（按账号隔离，名称唯一）。
- 用户可在资产卡片上打标 / 取消打标（多选既有标签）。
- 资产列表筛选区可按标签过滤（多选）。
- 资产列表返回时携带每条资产的标签名列表（`tagNames: string[]`）。

v1 不做：
- 标签颜色 / 图标。
- 标签重命名（删除后重建即可，简化 v1）。
- 标签使用计数（"3 个资产使用中"）。
- 标签自动补全 / 推荐。
- 跨用户共享标签（标签是用户私有的）。

目标：

- 新建 2 张表：`asset_tags`（标签定义）+ `asset_tag_assignments`（多对多关联）+ migration `0027_*.sql`。
- `packages/db` 新建 repo：标签 CRUD + 打标 / 取消 / 批量查询。
- 新增独立 route `apps/server/src/routes/asset-tags.ts`：标签 CRUD（`GET / POST / DELETE /api/asset-tags`）。
- 扩 `apps/server/src/routes/assets.ts`：`POST/DELETE /api/assets/:source/:id/tags/:tagId` + `GET /api/assets` 接受 `tagIds` 过滤 + 注入 `tagNames` 字段。
- `packages/shared/src/assets.ts`：`AssetLibraryItem.tagNames` + `AssetLibraryQuery.tagIds` + 新增 `AssetTagDTO`。
- `apps/client/src/lib/asset-library.ts`：filters 加 `tagIds: string[]`，URL 同步。
- `apps/client/src/api/asset-library.ts`：新增 tag CRUD + assign/unassign 客户端调用。
- `apps/client/src/pages/Assets.tsx`：标签管理 modal + 卡片标签区 + 筛选区标签多选。
- 补 server route 测试 + client 页面测试 + lib 测试。
- 从 `docs/TODO.md` 把 P1.1「高级筛选 UI 优化：标签（排序、收藏已完成）」整条删除（P1.1 全部完成）。
- 在 `CHANGELOG.md` `[Unreleased]` 记录本轮完成内容和 commit。

本轮不要处理：

- 标签颜色 / 重命名 / 使用计数。
- 已隐藏资产的恢复 UI（P1.1 写明「第一版只做隐藏」；`unhideCanvasAsset` / `unhideGenerationRecord` repo 函数已存在但产品决策不暴露 UI，本轮不触碰）。
- Gateway、provider、Canvas 组件、API Key、开发者页、Metrics、Notifications。
- 既有 schema 表结构变更（只允许新建 `asset_tags` + `asset_tag_assignments` 两张表）。
- 既有 migration 文件（0001 ~ 0026）。

## 重要规则：完成后必须 commit

- 本轮允许 1 ~ 2 个 commit：
  - **推荐 1 个 commit**：所有改动一起提交，hash 回填可以追一个 docs commit。
  - **允许拆 2 个 commit**：(1) schema + repo + route + shared types + server tests；(2) client UI + client tests。两个 commit hash 都要在 CHANGELOG 里回填。
- commit 前必须运行 `git status --short` 和 `git diff --name-only --cached`。
- 暂存区只能包含本任务文件，**绝对不要**混入 Claude B 的 metrics / health / config / server index / docs/metrics.md 文件。
- 完成事项从 `docs/TODO.md` 删除（P1.1「标签」整条删除）。
- 完成记录和 commit 写入根目录 `CHANGELOG.md`。
- 如果 `docs/TODO.md` / `CHANGELOG.md` 与 Claude B 并行修改冲突，优先提交代码；文档冲突在最终回复里说明。
- commit 成功后，在最终回复里写出 commit hash。

**强制检查**：commit 前必须确认 `git diff --name-only --cached` 输出**不包含**：

- `packages/metrics/`
- `apps/server/src/services/metrics.ts`
- `apps/server/src/routes/health.ts`
- `apps/server/src/routes/metrics.ts`
- `apps/server/src/config.ts`
- `apps/server/src/index.ts`
- `docs/metrics.md`
- `packages/gateway/`
- `packages/provider/`
- `packages/shared/src/openai-gateway.ts`
- `apps/server/src/routes/openai-gateway.ts`
- `apps/server/test/openai-gateway.test.ts`
- `apps/server/test/metrics-routes.test.ts`
- `apps/server/src/routes/api-keys.ts`
- `apps/server/src/routes/notifications.ts`
- `apps/client/src/pages/Developers.tsx`
- `apps/client/src/pages/ApiKeys.tsx`
- `apps/client/src/components/canvas/`
- `apps/client/src/components/Navbar.tsx`
- 既有 `packages/db/src/schema/*.ts` 文件（除新增的 `asset-tags.ts` + `asset-tag-assignments.ts`）
- 既有 `packages/db/drizzle/0001_*.sql` ~ `0026_*.sql`

## 文件边界

Claude A 可以新建：

```txt
packages/db/src/schema/asset-tags.ts                       (新建：标签定义)
packages/db/src/schema/asset-tag-assignments.ts            (新建：多对多关联)
packages/db/drizzle/0027_<drizzle 自动生成的名>.sql       (新建 migration；编号必须用 0027)
packages/db/src/repositories/asset-tags.repo.ts            (新建：CRUD)
packages/db/src/repositories/asset-tag-assignments.repo.ts (新建：assign/unassign/批量查询)
packages/shared/src/asset-tags.ts                          (新建：AssetTagDTO 类型)
apps/server/src/routes/asset-tags.ts                       (新建：标签 CRUD route)
apps/server/test/asset-tags-routes.test.ts                 (新建：route 测试)
```

Claude A 可以修改：

```txt
packages/db/src/schema/index.ts                       (追加 export * from './asset-tags' 和 './asset-tag-assignments')
packages/db/src/repositories/index.ts                (追加 export 两个 repo)
packages/shared/src/assets.ts                        (扩展 AssetLibraryItem.tagNames + AssetLibraryQuery.tagIds)
packages/shared/src/index.ts                         (追加 export * from './asset-tags'，若 shared 用 barrel 风格)
apps/server/src/routes/assets.ts                     (扩展 GET 加 tagIds filter + tagNames 注入；新增 POST/DELETE .../tags/:tagId 端点)
apps/server/src/index.ts                             (挂载 asset-tags route) ← 与 Claude B 在同一文件，注意只追加一行 .use(...)，不改其他行
apps/server/test/assets-routes.test.ts               (扩展 tagIds filter + assign/unassign 测试)
apps/server/test/helpers/test-factory.ts             (如需新增 makeTag fixture，可改；不破坏既有 fixture)
apps/client/src/api/asset-library.ts                 (新增 tag CRUD + assign/unassign 客户端调用)
apps/client/src/lib/asset-library.ts                 (filters 加 tagIds)
apps/client/src/pages/Assets.tsx                     (标签管理 modal + 卡片标签区 + 筛选下拉)
apps/client/test/assets-page.test.tsx                (扩展标签 UI 测试)
apps/client/test/asset-library.test.ts               (扩展 tagIds URL 同步测试)
docs/TODO.md
CHANGELOG.md
```

Claude A 不要修改：

```txt
docs/claude-parallel-plan.md
packages/metrics/**                                (Claude B 当前在动)
apps/server/src/services/metrics.ts                (Claude B 当前在动)
apps/server/src/routes/health.ts                   (Claude B 当前在动)
apps/server/src/routes/metrics.ts                  (Claude B 已新建)
apps/server/src/config.ts                          (Claude B 当前在动)
apps/server/src/index.ts                           ← 见上：仅允许追加一行 .use(createAssetTagRoutes(config))，禁止改其他行
packages/db/src/schema/audit-logs.ts               (既有 schema 绝对不动)
packages/db/src/schema/generation-records.ts       (既有 schema 绝对不动)
packages/db/src/schema/canvas-assets.ts            (既有 schema 绝对不动)
packages/db/src/schema/uploaded-files.ts           (既有 schema 绝对不动)
packages/db/src/schema/api-keys.ts                 (既有 schema 绝对不动)
packages/db/src/schema/notifications.ts            (既有 schema 绝对不动)
packages/db/src/schema/asset-favorites.ts          (上一轮新建，本轮不动)
packages/db/src/domain-types.ts                    (本轮 DTO 走 packages/shared/asset-tags.ts，不碰 domain-types)
packages/db/src/repositories/generation-records.repo.ts
packages/db/src/repositories/canvas-assets.repo.ts
packages/db/src/repositories/uploaded-files.repo.ts
packages/db/src/repositories/asset-favorites.repo.ts  (上一轮新建，本轮不动)
packages/provider/**
packages/gateway/**
packages/shared/src/openai-gateway.ts
apps/server/src/routes/openai-gateway.ts
apps/server/test/openai-gateway.test.ts
apps/server/src/routes/api-keys.ts
apps/server/src/routes/notifications.ts
apps/server/src/routes/upload.ts
apps/client/src/pages/Developers.tsx
apps/client/test/developers-page.test.tsx
apps/client/src/pages/ApiKeys.tsx
apps/client/test/api-keys-page.test.tsx
apps/client/src/components/canvas/**
apps/client/src/components/Navbar.tsx
apps/client/test/shot-reference-assets.test.tsx
apps/client/src/api/client.ts                      (fetchAssetLibrary 已经是泛型 query 透传，不需要改)
既有 migration 0001 ~ 0026                          (绝对不动)
docs/metrics.md                                    (Claude B 当前在动)
```

如果必须修改边界外文件，**先停止并在最终回复说明原因**。

## 第一步：定义 schema（两张表）

新建：

```txt
packages/db/src/schema/asset-tags.ts
```

```ts
import { index, pgTable, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core'
import { accounts } from './accounts'

/**
 * 资产标签表 — 用户级标签定义
 *
 * 与 asset_favorites 同样按 accountId 隔离；标签是用户私有，不跨账号共享。
 * 名称 (accountId, name) 复合唯一：同账号下不允许重名。
 *
 * v1 不做颜色 / 图标 / 重命名（删除后重建即可）。
 */
export const assetTags = pgTable('asset_tags', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').references(() => accounts.id).notNull(),
  /** 标签名，trim 后 1-32 字符，同账号下唯一 */
  name: varchar('name', { length: 32 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('idx_asset_tags_account').on(table.accountId, table.createdAt),
  unique('idx_asset_tags_account_name').on(table.accountId, table.name),
])
```

新建：

```txt
packages/db/src/schema/asset-tag-assignments.ts
```

```ts
import { foreignKey, index, pgTable, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core'
import { accounts } from './accounts'
import { assetTags } from './asset-tags'

/**
 * 资产标签分配表 — 多对多关联
 *
 * source 与 AssetLibrarySource 对齐（generation_record / canvas_asset / uploaded_file），
 * 复合唯一 (accountId, tagId, source, assetId) 保证同账号下同条资产不重复打同标签。
 *
 * 删除标签时（DELETE /api/asset-tags/:id）通过 ON DELETE CASCADE 自动级联删除分配。
 */
export const assetTagAssignments = pgTable('asset_tag_assignments', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').references(() => accounts.id).notNull(),
  tagId: uuid('tag_id').notNull().references(() => assetTags.id, { onDelete: 'cascade' }),
  /** 资产来源表 — 与 AssetLibrarySource 对齐（varchar + 应用层校验） */
  source: varchar('source', { length: 32 }).notNull(),
  /** 来源表的主键 */
  assetId: varchar('asset_id', { length: 64 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('idx_asset_tag_assignments_account').on(table.accountId, table.tagId),
  index('idx_asset_tag_assignments_asset').on(table.accountId, table.source, table.assetId),
  unique('idx_asset_tag_assignments_unique').on(table.accountId, table.tagId, table.source, table.assetId),
])
```

注意：

- `asset_tag_assignments.tag_id` 用 `references(() => assetTags.id, { onDelete: 'cascade' })`，删除标签自动级联删除分配。
- 不给 `source` 加 pgEnum，保持 varchar + 应用层校验（与 `asset_favorites.source` 一致）。
- 复合唯一索引 `idx_asset_tag_assignments_unique` 同时是业务约束和查询索引。

## 第二步：导出 schema 并生成 migration

修改 `packages/db/src/schema/index.ts`：

```ts
export * from './asset-tag-assignments'
export * from './asset-tags'
```

按 alphabetical 顺序插入（asset-favorites → asset-tag-assignments → asset-tags → audit-logs）。

生成 migration：

```bash
cd packages/db
bun run db:generate
```

确认生成的 migration 文件名以 `0027_` 开头（最新一个是 `0026_fuzzy_baron_zemo.sql`）。检查内容应包含：

- `CREATE TABLE "asset_tags" (...)` + `CONSTRAINT "idx_asset_tags_account_name" UNIQUE("account_id","name")`
- `CREATE TABLE "asset_tag_assignments" (...)` + FK `ON DELETE cascade` + `CONSTRAINT "idx_asset_tag_assignments_unique" UNIQUE(...)`
- `CREATE INDEX "idx_asset_tags_account" ...`
- `CREATE INDEX "idx_asset_tag_assignments_account" ...`
- `CREATE INDEX "idx_asset_tag_assignments_asset" ...`

如果 drizzle-kit 没把 `unique(...)` 生成为 UNIQUE CONSTRAINT（而是普通 INDEX），手动改 SQL 为 `CREATE UNIQUE INDEX`。

**绝对不要**修改 `0026` 及更早的 migration。

## 第三步：实现 repo

新建 `packages/db/src/repositories/asset-tags.repo.ts`：

至少导出：

```ts
export interface AssetTagRow {
  id: string
  accountId: string
  name: string
  createdAt: Date
}

/** 创建标签 — 同账号重名时抛错（route 层捕获返回 409） */
export async function createAssetTag(opts: {
  accountId: string
  name: string  // route 层已 trim + 限长 32
}): Promise<AssetTagRow>

/** 列出当前用户全部标签，按 createdAt desc */
export async function listAssetTags(accountId: string): Promise<AssetTagRow[]>

/** 按 id 查询单条标签（route 用于校验所有权） */
export async function findAssetTagById(opts: {
  accountId: string
  tagId: string
}): Promise<AssetTagRow | null>

/** 删除标签 — ON DELETE CASCADE 自动级联删除分配 */
export async function deleteAssetTag(opts: {
  accountId: string
  tagId: string
}): Promise<void>
```

实现要点：

- `createAssetTag` 直接 `insert`，让 PG 的 UNIQUE 约束抛错；route 层 try/catch 把 `DrizzleQueryError` + `cause.code === '23505'` 翻译成 409 conflict。
- 不做 trim/限长（route 层做）。
- `deleteAssetTag` 用 `where(and(eq(accountId), eq(id)))` 双重过滤，避免跨账号删除。

新建 `packages/db/src/repositories/asset-tag-assignments.repo.ts`：

至少导出：

```ts
export type AssetTagAssignmentSource = 'generation_record' | 'canvas_asset' | 'uploaded_file'

export interface AssetTagAssignmentKey {
  tagId: string
  source: AssetTagAssignmentSource
  assetId: string
}

/** 给资产打标 — 幂等（ON CONFLICT DO NOTHING） */
export async function assignAssetTag(opts: {
  accountId: string
  tagId: string
  source: AssetTagAssignmentSource
  assetId: string
}): Promise<void>

/** 取消打标 — 幂等（不存在不抛错） */
export async function unassignAssetTag(opts: {
  accountId: string
  tagId: string
  source: AssetTagAssignmentSource
  assetId: string
}): Promise<void>

/**
 * 批量查询当前用户全部 (tagId, source, assetId) 集合
 *
 * GET /api/assets 一次性查回，在 route 内存 Map<source:assetId, Set<tagId>> 做匹配。
 */
export async function listAssetTagKeys(accountId: string): Promise<AssetTagAssignmentKey[]>

/**
 * 批量查询 tagId → tagName 映射（当前用户）
 *
 * 注入 tagNames 时需要把 tagId 解析为 name；route 一次性拉两份数据（listAssetTags + listAssetTagKeys）。
 */
// 此函数不强制要求；route 可以复用 listAssetTags 自己构建 map。但封装一层更清晰。
export async function listAssetTagIdNameMap(accountId: string): Promise<Map<string, string>>
```

实现要点：

- `assignAssetTag` 用 `onConflictDoNothing()`（依赖复合唯一约束）。
- 跨账号隔离：所有 query 都带 `eq(accountId, opts.accountId)`。
- 本地声明 `AssetTagAssignmentSource` 联合类型，不反向 import `@excuse/shared`（与 `asset-favorites.repo.ts` 同样的循环依赖规避）。

修改 `packages/db/src/repositories/index.ts`：

```ts
export * from './asset-tag-assignments.repo'
export * from './asset-tags.repo'
```

## 第四步：扩展 shared types

新建 `packages/shared/src/asset-tags.ts`：

```ts
/**
 * 资产标签 DTO — 跨 DB / API / Client 共用
 *
 * 不使用 Date 类型（API 边界一律 ISO 字符串）。
 */
export interface AssetTagDTO {
  id: string
  name: string
  createdAt: string  // ISO
}

export interface AssetTagListResponse {
  success: true
  items: AssetTagDTO[]
}

export interface AssetTagCreateResponse {
  success: true
  data: AssetTagDTO
}

export interface AssetTagMutationResponse {
  success: true
}
```

修改 `packages/shared/src/assets.ts`：

4.1 在 `AssetLibraryItem` 追加字段：

```ts
export interface AssetLibraryItem {
  // ... 既有字段（含 isFavorite）
  /** 当前用户给该资产打的标签名列表（route 注入，可能为空数组） */
  tagNames: string[]
}
```

4.2 在 `AssetLibraryQuery` 追加字段：

```ts
export interface AssetLibraryQuery {
  // ... 既有字段（含 favorite）
  /** 仅返回打了指定 tagId 之一的资产（OR 关系）；缺省 = 不过滤 */
  tagIds?: string[]
}
```

修改 `packages/shared/src/index.ts`（如果 shared 用 barrel 风格）：

```ts
export * from './asset-tags'
```

注意：

- 不要改既有字段顺序或可选性。
- `tagNames` 必填（client 期望 string[]，不期望 undefined）；route 始终注入（即使空数组）。
- `tagIds` 查询参数保持可选；route 缺省视为不过滤。

## 第五步：实现标签 CRUD route

新建 `apps/server/src/routes/asset-tags.ts`：

```ts
import type { AssetTagCreateResponse, AssetTagListResponse, AssetTagMutationResponse } from '@excuse/shared'
import type { ServerConfig } from '../config'
import { createAssetTag, deleteAssetTag, listAssetTags } from '@excuse/db'
import { Elysia, t } from 'elysia'
import { createRequireAuthPlugin } from '../plugins/auth'
import { conflict, notFound, validationError } from '../utils/errors'

const MAX_NAME_LENGTH = 32

function serialize(row: { id: string, name: string, createdAt: Date }) {
  return { id: row.id, name: row.name, createdAt: row.createdAt.toISOString() }
}

export function createAssetTagRoutes(config: ServerConfig) {
  return new Elysia({ prefix: '/api/asset-tags' })
    .use(createRequireAuthPlugin(config))
    .get('/', async ({ userId }) => {
      const rows = await listAssetTags(userId)
      return { success: true, items: rows.map(serialize) } satisfies AssetTagListResponse
    }, { /* detail */ })
    .post('/', async ({ userId, body, set }) => {
      const name = body.name.trim()
      if (!name)
        return validationError(set, '标签名不能为空')
      if (name.length > MAX_NAME_LENGTH)
        return validationError(set, `标签名最长 ${MAX_NAME_LENGTH} 字符`)
      try {
        const row = await createAssetTag({ accountId: userId, name })
        return { success: true, data: serialize(row) } satisfies AssetTagCreateResponse
      }
      catch (err) {
        // 23505 = unique_violation
        if ((err as { cause?: { code?: string } }).cause?.code === '23505')
          return conflict(set, '同名标签已存在')
        throw err
      }
    }, {
      body: t.Object({ name: t.String({ description: '标签名，trim 后 1-32 字符' }) }),
      /* detail */
    })
    .delete('/:id', async ({ userId, params, set }) => {
      await deleteAssetTag({ accountId: userId, tagId: params.id })
      // 删除不存在的不报错（幂等）
      return { success: true } satisfies AssetTagMutationResponse
    }, {
      params: t.Object({ id: t.String() }),
      /* detail */
    })
}
```

注意：

- `POST /` 重名时捕获 `23505` 翻译成 409（参照 CLAUDE.md 关于 `DrizzleQueryError.cause` 的提示）。
- `DELETE /:id` 不做存在性校验，幂等删除（删除不存在的标签返回 200）。
- 不走 audit（同 favorite 决策：避免扩 audit 枚举）。
- 路径前缀 `/api/asset-tags`，与 assets.ts 的 `/api/assets/...` 区分。

## 第六步：扩 assets.ts route — tag filter + toggle + 注入

修改 `apps/server/src/routes/assets.ts`：

6.1 import 新 repo：

```ts
import {
  // ... 既有
  assignAssetTag,
  listAssetTagKeys,
  listAssetTags,
  unassignAssetTag,
} from '@excuse/db'
```

6.2 `GET /api/assets` 接受 `tagIds` 查询参数：

```ts
query: t.Object({
  // ... 既有
  tagIds: t.Optional(t.String({ description: '标签 ID 列表（逗号分隔），OR 关系：返回打了任一标签的资产' })),
}),
```

注意：query string 中数组用逗号分隔字符串，route 解析。

6.3 在合并 + 排序 + favorite 注入后，**注入 tagNames**：

```ts
// 查当前用户的 (tagId, tagName) 映射 + (source, assetId) → tagId[] 集合
const [tagRows, assignmentKeys] = await Promise.all([
  listAssetTags(userId),
  listAssetTagKeys(userId),
])
const tagNameMap = new Map(tagRows.map(t => [t.id, t.name]))
const assetTagsMap = new Map<string, Set<string>>() // key: `${source}:${assetId}`, value: tagId 集合
for (const k of assignmentKeys) {
  const key = `${k.source}:${k.assetId}`
  if (!assetTagsMap.has(key))
    assetTagsMap.set(key, new Set())
  assetTagsMap.get(key)!.add(k.tagId)
}

// tagIds 过滤（OR 关系）
const tagIdFilterRaw = typeof query.tagIds === 'string' ? query.tagIds : ''
const tagIdFilter = tagIdFilterRaw
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
const tagIdFilterSet = new Set(tagIdFilter)

// 注入 tagNames + 应用 tagIds 过滤
const filtered2 = filtered.filter((item) => {
  const tagIds = assetTagsMap.get(`${item.source}:${item.id}`) ?? new Set<string>()
  item.tagNames = [...tagIds].map(id => tagNameMap.get(id)).filter((n): n is string => Boolean(n))
  if (tagIdFilterSet.size > 0) {
    const hasAny = [...tagIds].some(id => tagIdFilterSet.has(id))
    if (!hasAny)
      return false
  }
  return true
})

// 用 filtered2 替换后续 hasMore / total
```

注意：

- 注入位置：在 favorite 注入之后、hasMore 之前。
- `tagNames` 按标签创建时间顺序（依赖 `assetTagsMap` 的 Set 插入顺序，而 Set 顺序由 `assignmentKeys` 查询顺序决定）— 不重要，UI 显示时按需排序。
- `tagIds` 过滤同样有 hasMore 计算偏差（同 favorite），是 v1 已知限制。

6.4 新增 assign/unassign 端点：

```ts
.post('/assets/:source/:id/tags/:tagId', async ({ params: { source, id, tagId }, userId, set }) => {
  // 校验标签属于当前用户（避免给不存在/他人的标签打标）
  const tag = await findAssetTagById({ accountId: userId, tagId })
  if (!tag)
    return notFound(set, '标签不存在')
  await assignAssetTag({ accountId: userId, tagId, source, assetId: id })
  return { success: true as const }
}, {
  params: t.Object({
    source: t.Union([
      t.Literal('generation_record'),
      t.Literal('canvas_asset'),
      t.Literal('uploaded_file'),
    ]),
    id: t.String(),
    tagId: t.String(),
  }),
  /* detail */
})
.delete('/assets/:source/:id/tags/:tagId', async ({ params: { source, id, tagId }, userId }) => {
  await unassignAssetTag({ accountId: userId, tagId, source, assetId: id })
  return { success: true as const }
}, { /* params + detail */ })
```

注意：

- 不审计（同 favorite 决策）。
- assign 时校验 tag 属于当前用户；其他资产的归属校验（assetId 是否属于当前用户）v1 暂不做（与 favorite endpoint 一致）。

6.5 更新 GET /assets 的 `detail.description`，把 tagIds 参数说明加进去。

## 第七步：挂载 asset-tags route

修改 `apps/server/src/index.ts`：

⚠️ **此文件 Claude B 也在改（挂载 metrics route）**。**严格规则**：

- 只追加 **1 行 import**：`import { createAssetTagRoutes } from './routes/asset-tags'`
- 只追加 **1 行 use**：`.use(createAssetTagRoutes(config))`
- 位置：在 `createAssetsRoutes(config)` 之后立即追加（保持资产相关 route 相邻）。
- **不要**修改其他行（不动 import 顺序、不调整既有 use 顺序、不动 export / listen / sseListener 等）。
- 如果 git 显示冲突（Claude B 已经改过 index.ts），先 `git pull` 或手动 merge；**不要覆盖 Claude B 的 `.use(createMetricsRoutes(config))`**。

## 第八步：扩展 client lib

修改 `apps/client/src/lib/asset-library.ts`：

```ts
export interface AssetLibraryFilters {
  // ... 既有（含 favorite）
  /** 按标签筛选（tagId 数组，OR 关系） */
  tagIds: string[]
}

export const DEFAULT_FILTERS: AssetLibraryFilters = {
  // ... 既有
  tagIds: [],
}

export function normalizeAssetLibraryFiltersFromSearchParams(params: URLSearchParams): AssetLibraryFilters {
  return {
    // ... 既有
    tagIds: params.get('tagIds')?.split(',').map(s => s.trim()).filter(Boolean) ?? [],
  }
}
```

URL 同步：`syncFiltersToUrl` 把 tagIds 用逗号拼接写回 URL（空数组不写）。

`createAssetLibraryQueryKey` 已经把整个 filters 当 key，无需手动展开。

修改 `apps/client/src/api/asset-library.ts`：

新增客户端调用函数（参照 `hideAsset` / `toggleAssetFavorite` 用 `fetch`）：

```ts
import type { AssetTagDTO } from '@excuse/shared'

export async function listAssetTags(): Promise<AssetTagDTO[]>
export async function createAssetTag(name: string): Promise<AssetTagDTO>
export async function deleteAssetTag(id: string): Promise<void>
export async function assignAssetTag(source: AssetLibrarySource, id: string, tagId: string): Promise<void>
export async function unassignAssetTag(source: AssetLibrarySource, id: string, tagId: string): Promise<void>
```

或用 Eden treaty（如果 type 推导够干净）。v1 推荐 fetch（与既有 hideAsset/toggleAssetFavorite 风格一致，避免 Eden 嵌套路径问题）。

`filtersToQueryParams` 把 `tagIds` 数组用 `join(',')` 后透传：

```ts
tagIds: filters.tagIds.length > 0 ? filters.tagIds.join(',') : undefined,
```

## 第九步：Assets 页面标签 UI

修改 `apps/client/src/pages/Assets.tsx`：

9.1 **标签管理 modal**：

- 在页头（与「清空筛选」按钮同一行）新增「标签管理」按钮。
- 点击打开 modal，显示当前用户全部标签列表（按 createdAt desc）：
  - 每行：标签名 + 删除按钮（lucide `Trash2`，确认弹窗）。
  - 顶部输入框 + 「创建」按钮，回车或点击创建。
- 创建成功后刷新列表（react-query invalidate）。
- 删除前用 ConfirmDialog 确认（删除会级联取消所有打标）。

9.2 **卡片标签区**：

- 卡片底部（在 status badge / 成本之下）显示当前资产的标签：
  - 前 3 个标签用 Badge 显示。
  - 超过 3 个显示「+N」。
  - hover 卡片时显示「+ 加标签」按钮（lucide `Tag` 或 `Plus`），点击弹出现有标签列表的多选 popover：
    - 已打标的标签显示打勾。
    - 点击未打勾的标签 → POST assign。
    - 点击已打勾的标签 → DELETE unassign。
- 操作成功后 invalidate asset library query（与 favorite toggle 一致）。

9.3 **筛选区标签多选下拉**：

- 在「仅看收藏」开关附近新增「标签」多选下拉：
  - 下拉项 = 当前用户全部标签（按 createdAt desc）。
  - 已选中的标签显示在筛选区（Badge 形式，可点 × 移除）。
  - 点击下拉项 → toggle tagId in filters.tagIds。
  - filters.tagIds 变化 → URL 同步 + query 刷新。
- 空标签列表时下拉显示「还没有标签，前往标签管理创建」提示。

9.4 `clearFilters` 必须重置 `tagIds` 回 `[]`。

9.5 `hasActiveFilters` 判定：tagIds 非空时算"有筛选"，让清空按钮可见。

注意：

- 标签管理 modal 不要复用 PreviewModal 的 Dialog（避免状态串扰）；用独立 Dialog 实例。
- 卡片标签 Badge 颜色保持中性（不引入颜色选择 UI），用 `bg-accent text-accent-foreground` 即可。
- 不要修改既有 KIND_CARDS / SOURCE_OPTIONS / STATUS_OPTIONS 常量结构。
- 不要修改 `AssetPreviewKind` / `getAssetLibraryPreviewKind` 等预览相关纯函数。

## 第十步：补 server route 测试

修改 `apps/server/test/assets-routes.test.ts`：

新增 `describe('GET /api/assets tagIds filter', ...)` + `describe('POST/DELETE /api/assets/:source/:id/tags/:tagId', ...)`：

1. `tagIds=t1,t2` → 返回打了 t1 或 t2 任一标签的资产；每条 item 含 `tagNames` 数组。
2. 不传 tagIds → 返回全部资产，tagNames 字段反映实际打的标签。
3. 跨用户隔离：A 用户的标签不会出现在 B 用户列表的 tagNames 里。

assign/unassign 路径：

4. POST assign 一条资产 → 200；GET 列表 tagNames 含对应标签名。
5. POST assign 不存在的 tagId → 404。
6. POST assign 不属于当前用户的 tagId → 404（route 校验所有权）。
7. DELETE unassign → 200；GET 列表 tagNames 不再含该标签。
8. DELETE unassign 未打标的组合 → 200（幂等）。

新建 `apps/server/test/asset-tags-routes.test.ts`：

9. GET /api/asset-tags 空列表 → items=[]。
10. POST /api/asset-tags { name: ' 高亮 ' } → 200，data.name='高亮'（trim 验证）。
11. POST 同名 → 409 conflict。
12. POST 空名 / 超长名 → 400。
13. DELETE /api/asset-tags/:id → 200；GET 列表不再含该标签。
14. DELETE 不存在的 id → 200（幂等）。
15. 跨用户：A 创建的标签 B 看不到（GET）；B DELETE A 的标签 → 200 但不影响 A 的标签（双重过滤）。

测试注意：

- 既有 favorite / sort / hide / filter 测试不能破坏；新增 `tagNames` 必填字段后既有 fixture 可能需要补默认值。
- 用真实 PG（`bun run test:db` 或 transaction-scoped）比 mock.module 更稳；但 server 测试套件现状可能用 mock.module，沿用既有风格。

## 第十一步：补 client 测试

修改 `apps/client/test/assets-page.test.tsx`：

1. 卡片显示 tagNames（mock query 返回 tagNames=['高亮', '草稿']）→ 渲染两个 Badge。
2. 卡片超过 3 个标签 → 显示「+N」。
3. 点击「+ 加标签」按钮 → 弹出标签下拉。
4. 点击未打勾的标签 → 调用 assign（verify fetch 调用）。
5. 标签管理 modal 打开 → 显示 listAssetTags 结果。
6. 创建标签输入 + 回车 → 调用 createAssetTag + 刷新列表。
7. 删除标签 → 弹出 ConfirmDialog → 确认后调用 deleteAssetTag。
8. 筛选区标签下拉选择 → filters.tagIds 变化 + URL 同步。
9. clearFilters → tagIds 重置为 []。

修改 `apps/client/test/asset-library.test.ts`：

1. `normalizeAssetLibraryFiltersFromSearchParams` 解析 `tagIds=t1,t2` → filters.tagIds=['t1','t2']。
2. tagIds 缺省 → []。
3. filters 含 tagIds 时 syncFiltersToUrl 写回 URL（用逗号拼接）。
4. filters.tagIds=[] 时 syncFiltersToUrl 不写 tagIds 参数。

## 第十二步：更新 TODO 和 CHANGELOG

修改 `docs/TODO.md`：

- 把 P1.1「资产中心升级」中的：

```txt
- 高级筛选 UI 优化：标签（排序、收藏已完成）。
```

**整条删除**（标签完成后 P1.1 全部子项完结）。

- 在 P1.1「验收」上方追加一行（如果觉得有产品价值）：

```txt
（v1 已完成：隐藏、上传编辑、排序、收藏、标签。下一轮如需扩标签颜色 / 重命名 / 使用计数，再单独开任务。）
```

或者直接删掉该行不追加，由后续轮次决定。

- 不要碰 P2 / P3 / P4 章节，避免与 Claude B 在 Metrics 区域的修改撞行。
- 不要碰 P2.5 Metrics / Health 章节（Claude B 当前在动）。

修改根目录 `CHANGELOG.md`：

- 在 `[Unreleased]` 的 Added 区追加：

```txt
- 资产中心列表新增标签能力（v1）：新建 `asset_tags`（用户级标签定义，复合唯一 `(accountId, name)`）+ `asset_tag_assignments`（多对多关联，复合唯一 `(accountId, tagId, source, assetId)`，tag 删除级联）两张表，migration `0027_*.sql`；新增 `GET / POST / DELETE /api/asset-tags` 标签 CRUD route（重名 23505 → 409，删除幂等）；扩 `GET /api/assets` 支持 `tagIds` 查询参数（逗号分隔，OR 关系）并在每条 `AssetLibraryItem` 注入 `tagNames` 字段；新增 `POST/DELETE /api/assets/:source/:id/tags/:tagId` assign/unassign 端点（幂等，跨三来源，assign 校验 tag 所有权）；Assets 页面新增「标签管理」modal（创建 / 列表 / 删除）+ 卡片标签区（前 3 + N 提示 + 多选打标 popover）+ 筛选区标签多选下拉；不进 audit，与 favorite toggle 一致（commit: `<本轮 hash>`）。
```

- 写入本轮 commit 短 hash（commit 完成后回填）。

如果文档与 Claude B 冲突：

- 不要覆盖 Claude B 的 metrics 记录。
- 可以先提交代码，文档冲突在最终回复里说明。

## 验证命令

至少运行：

```bash
cd packages/db && bun run db:generate    # 检查 migration 0027 生成正确
bun test apps/server/test/assets-routes.test.ts
bun test apps/server/test/asset-tags-routes.test.ts
bun run --cwd apps/client test -- assets-page.test.tsx
bun run --cwd apps/client test -- asset-library.test.ts
bun run --cwd apps/server typecheck
bun run --cwd apps/client typecheck
```

如时间允许，再运行：

```bash
bun run typecheck
bun run lint
bun run test:db   # 如果写了 repo 测试
```

如果 lint 因 Claude B 并行未提交文件失败，不要修改 Claude B 文件；最终回复说明。

## 推荐 commit

如果选择 1 个 commit：

```bash
git add packages/db/src/schema/asset-tags.ts \
  packages/db/src/schema/asset-tag-assignments.ts \
  packages/db/src/schema/index.ts \
  packages/db/drizzle/0027_*.sql \
  packages/db/src/repositories/asset-tags.repo.ts \
  packages/db/src/repositories/asset-tag-assignments.repo.ts \
  packages/db/src/repositories/index.ts \
  packages/shared/src/asset-tags.ts \
  packages/shared/src/assets.ts \
  packages/shared/src/index.ts \
  apps/server/src/routes/asset-tags.ts \
  apps/server/src/routes/assets.ts \
  apps/server/src/index.ts \
  apps/server/test/assets-routes.test.ts \
  apps/server/test/asset-tags-routes.test.ts \
  apps/client/src/api/asset-library.ts \
  apps/client/src/lib/asset-library.ts \
  apps/client/src/pages/Assets.tsx \
  apps/client/test/assets-page.test.tsx \
  apps/client/test/asset-library.test.ts \
  docs/TODO.md \
  CHANGELOG.md

git diff --name-only --cached
```

如果选择 2 个 commit（推荐，分离 backend 与 frontend 方便回归）：

```bash
# Commit 1: backend
git add packages/db/src/schema/asset-tags.ts \
  packages/db/src/schema/asset-tag-assignments.ts \
  packages/db/src/schema/index.ts \
  packages/db/drizzle/0027_*.sql \
  packages/db/src/repositories/asset-tags.repo.ts \
  packages/db/src/repositories/asset-tag-assignments.repo.ts \
  packages/db/src/repositories/index.ts \
  packages/shared/src/asset-tags.ts \
  packages/shared/src/assets.ts \
  packages/shared/src/index.ts \
  apps/server/src/routes/asset-tags.ts \
  apps/server/src/routes/assets.ts \
  apps/server/src/index.ts \
  apps/server/test/assets-routes.test.ts \
  apps/server/test/asset-tags-routes.test.ts

git commit -m "feat(assets): add tag schema and CRUD/assign endpoints"

# Commit 2: client UI
git add apps/client/src/api/asset-library.ts \
  apps/client/src/lib/asset-library.ts \
  apps/client/src/pages/Assets.tsx \
  apps/client/test/assets-page.test.tsx \
  apps/client/test/asset-library.test.ts \
  docs/TODO.md \
  CHANGELOG.md

git commit -m "feat(assets): add tag management UI and filter"
```

**强制检查**：每次 commit 前必须确认 `git diff --name-only --cached` 输出**不包含**：

- `packages/metrics/`
- `apps/server/src/services/metrics.ts`
- `apps/server/src/routes/health.ts`
- `apps/server/src/routes/metrics.ts`
- `apps/server/src/config.ts`
- `docs/metrics.md`
- `packages/gateway/`
- `packages/provider/`
- 既有 `packages/db/src/schema/*.ts` 文件（除新增的 `asset-tags.ts` + `asset-tag-assignments.ts`）
- 既有 `packages/db/drizzle/0001_*.sql` ~ `0026_*.sql`

`apps/server/src/index.ts` 只允许追加 import 一行 + use 一行（不能改其他行）。

提交后回填 commit hash 到 CHANGELOG（追加一个 docs commit 即可）。

最终回复必须包含：

- 本轮 commit hash（1 个或 2 个）。
- 实际运行的验证命令。
- `git diff --name-only --cached` 的最终输出（证明未跨界）。
- migration `0027_*.sql` 实际生成的 SQL（确认含 `CREATE TABLE asset_tags` + `asset_tag_assignments` + UNIQUE 约束 + FK ON DELETE cascade）。
- `apps/server/src/index.ts` 的实际改动 diff（应该只有 +2 行：1 行 import + 1 行 use）。
- 与 Claude B 是否有冲突 / 如何 merge（特别是 `apps/server/src/index.ts`）。
- 如果 TODO / CHANGELOG 未提交，说明原因。
