import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL || 'postgres://excuse:excuse_dev@localhost:5433/excuse'

// 导出原始 postgres 客户端，供 LISTEN/NOTIFY 使用
//
// 连接池参数显式配置：postgres 库默认 max=10，但 server + worker 两个进程
// 并存、且未来可能水平扩展 worker，裸用默认值会快速逼近 PG 的连接上限。
// - max：单进程最大连接数（可经 DB_MAX_CONNECTIONS 覆盖）
// - connect_timeout：建连超时，避免 DB 响应慢时进程无限挂起
// - idle_timeout：空闲连接自动释放，回收 PG slot
// 注：未设 prepare:false —— 本项目未使用 PgBouncer（见部署文档），
// 保留默认 prepared statement 以获得查询性能。
//
// numeric 类型解析覆盖：postgres 库默认把 numeric/decimal（OID 1700）解析为
// JS string（防大数精度丢失）。但本项目所有分值列（totalPriceCents / credit ledger /
// api-key spend）均为 numeric(20,4)——值域远小于 Number.MAX_SAFE_INTEGER（最大约
// 10^9 分 × 4 位小数 = 13 位有效数字 < float64 的 15~17 位），按 number 解析无损且与
// 既有分值运算/比较（如 `availableCents - amount`、`totalPriceCents > 0`）兼容。
// 否则 credit ledger 的 SQL 内运算虽在 PG 侧精确，但读回的 string 会让 JS 侧
// `totalSpendCents + actualCost` 退化为字符串拼接。
//
// 导出复用：测试 helper（packages/db/test/helpers/test-db.ts）自建 postgres 客户端，
// 必须挂同一 parser，否则分值列在测试里以 string 返回（与生产行为不一致）。
export const numericTypeParser = {
  numeric: {
    to: 1700,
    from: [1700],
    parse: (x: string) => Number.parseFloat(x),
    serialize: (x: number) => `${x}`,
  },
}

export const pgClient = postgres(connectionString, {
  max: Number(process.env.DB_MAX_CONNECTIONS) || 10,
  connect_timeout: 10,
  idle_timeout: 20,
  types: numericTypeParser,
})

// 内部实例 — 通过 getDb() 访问，不直接导出
let _db = drizzle(pgClient, { schema })

/** 获取当前 db 实例 */
export function getDb() {
  return _db
}

/** 替换 db 实例（测试用） */
export function setDb(instance: typeof _db) {
  _db = instance
}

/** 等待数据库连接可用，最多重试 maxRetries 次，每次间隔 delayMs */
export async function waitForDb(maxRetries = 10, delayMs = 1000): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await pgClient`SELECT 1`
      return
    }
    catch {
      if (i === maxRetries - 1)
        throw new Error(`数据库连接失败：已重试 ${maxRetries} 次`)
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }
}
