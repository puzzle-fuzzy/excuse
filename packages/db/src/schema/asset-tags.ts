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
