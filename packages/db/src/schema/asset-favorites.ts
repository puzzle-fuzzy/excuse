import { index, pgTable, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core'
import { accounts } from './accounts'

/**
 * 资产收藏表 — 用户级「收藏」标记
 *
 * 资产中心把 generation_records / canvas_assets / uploaded_files 三种来源合并展示，
 * 但收藏是用户对「具体某条资产」的标记，需要记录来源 + 资产主键，避免不同来源主键冲突。
 *
 * 复合唯一约束 `idx_asset_favorites_unique` 保证同一用户对同一资产只能收藏一次，
 * 同时充当按 (account, source, asset) 查询的索引。
 * source 与 AssetLibrarySource 对齐：generation_record / canvas_asset / uploaded_file。
 * 不使用 pgEnum：保持 varchar + 应用层校验（联合类型），避免与既有 `AssetLibrarySource` 类型分裂。
 */
export const assetFavorites = pgTable('asset_favorites', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').references(() => accounts.id).notNull(),
  /** 资产来源表 — 与 AssetLibrarySource 对齐 */
  source: varchar('source', { length: 32 }).notNull(),
  /** 来源表的主键（generation_records.id / canvas_assets.id / uploaded_files.id） */
  assetId: varchar('asset_id', { length: 64 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('idx_asset_favorites_account').on(table.accountId, table.createdAt),
  unique('idx_asset_favorites_unique').on(table.accountId, table.source, table.assetId),
])
