/**
 * 真实测试数据库基础设施
 *
 * - 连接到 Docker PostgreSQL 上的 excuse_test 数据库
 * - 运行 drizzle migrations 建表
 * - 每个测试包在事务中执行，测完自动 ROLLBACK，互不干扰
 * - 自动 seed 一个测试 account（generation_records / uploaded_files 的 FK 依赖）
 *
 * 技术方案：
 * 1. 用 max: 1 的 postgres.js 连接池，确保所有查询走同一连接
 * 2. beforeEach: 执行 BEGIN，注入 drizzle 实例到 setDb()
 * 3. afterEach: 执行 ROLLBACK
 *
 * 不用 drizzle 的 db.transaction()（它自动 commit/rollback），
 * 而是直接用底层 SQL 控制 BEGIN/ROLLBACK，让测试完全掌控事务生命周期。
 */

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { resolve } from 'node:path'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { setDb } from '../../src/db'

import * as schema from '../../src/schema'

/**
 * 测试库连接串：优先用 DATABASE_URL（CI / 自定义环境），否则回落到本地 Docker 默认（localhost:5433）。
 * CI 中 DATABASE_URL 指向 GitHub Actions postgres service（端口 5432），本地用 5433 避开宿主 PG。
 */
const TEST_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://excuse:excuse_dev@localhost:5433/excuse_test'
const MIGRATIONS_FOLDER = resolve(import.meta.dir, '../../drizzle')

/** 单连接 drizzle 实例（max: 1 保证 BEGIN/ROLLBACK 作用域正确） */
let db: PostgresJsDatabase<typeof schema>
let savepointCounter = 0

/**
 * beforeAll 调用：连接测试库并运行迁移
 */
export async function initTestDb() {
  const client = postgres(TEST_DATABASE_URL, { max: 1 })
  db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
}

/**
 * afterAll 调用：关闭连接
 */
export async function teardownTestDb() {
  // Drizzle 的 $client 是 postgres.js 底层连接，类型未暴露在公共 API 中
  // 通过 Record<string, unknown> 访问以避免 as any
  const internals = db as unknown as Record<string, unknown>
  const client = internals.$client as { end: () => Promise<void> } | undefined
  if (client) {
    await client.end()
  }
}

/**
 * beforeEach 调用：开启事务 + seed 测试 account + 注入 setDb()
 *
 * @returns accountId — 可直接用作 generation_records / uploaded_files 的 FK
 */
export async function beginTestTransaction(): Promise<{ accountId: string }> {
  await db.execute('BEGIN')

  // 注入到 repo 层
  // setDb 接受 Drizzle 实例，PostgresJsDatabase 的泛型推导可能不完全匹配
  // 通过 unknown 中转避免 as any
  setDb(db as unknown as Parameters<typeof setDb>[0])

  // Seed 测试 account（在事务内，ROLLBACK 时一起清理）
  const [account] = await db
    .insert(schema.accounts)
    .values({
      username: `test_${crypto.randomUUID().slice(0, 8)}`,
      email: `test_${crypto.randomUUID().slice(0, 8)}@example.com`,
      password: 'hashed_password',
    })
    .returning()

  return { accountId: account!.id }
}

/**
 * afterEach 调用：回滚事务
 */
export async function rollbackTestTransaction() {
  await db.execute('ROLLBACK')
}

/**
 * 注入已迁移的测试 DB 实例，但**不**开启 per-test 的 raw BEGIN/ROLLBACK 包裹。
 *
 * 适用于内部使用 drizzle `db.transaction()` 的 repository（raw BEGIN 内不能再嵌套
 * drizzle transaction —— 后者的 COMMIT 会提前提交外层事务）。调用方需自行清理
 * 写入的数据（如 DELETE）以保证测试隔离。
 *
 * 必须在 beforeAll 调用。始终重新 initTestDb：bun test 跨文件共享模块状态，
 * 上一个文件的 teardownTestDb 会关闭 client 但不置空模块级 `db` 变量，
 * `if (!db)` 会误判为已初始化而复用已关闭的 client。
 */
export async function useMigratedTestDb(): Promise<void> {
  await initTestDb()
  setDb(db as unknown as Parameters<typeof setDb>[0])
}

/**
 * 在测试中验证预期的数据库约束错误。
 *
 * PostgreSQL 在事务内遇到 unique/FK 等错误后会把整个事务标记为 aborted；
 * 如果不先回滚到 savepoint，后续 afterEach 的清理查询可能卡住或失败。
 */
export async function expectDbConstraintError(fn: () => Promise<unknown>): Promise<unknown> {
  const savepoint = `constraint_check_${savepointCounter++}`
  await db.execute(`SAVEPOINT ${savepoint}`)

  try {
    await fn()
  }
  catch (error) {
    await db.execute(`ROLLBACK TO SAVEPOINT ${savepoint}`)
    await db.execute(`RELEASE SAVEPOINT ${savepoint}`)
    return error
  }

  await db.execute(`RELEASE SAVEPOINT ${savepoint}`)
  throw new Error('Expected database constraint error, but operation succeeded')
}
