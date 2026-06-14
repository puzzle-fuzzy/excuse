import { index, pgTable, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core'
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
