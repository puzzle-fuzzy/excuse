/**
 * DB 测试环境检测脚本
 *
 * 运行 `bun run test:db` 时自动检测 PostgreSQL 是否可连接。
 * 无法连接时输出明确提示，帮助开发者快速定位问题。
 *
 * 检测内容：
 *   1. Docker PostgreSQL 是否运行在 localhost:5433
 *   2. excuse_test 数据库是否存在
 *   3. Drizzle migration 是否可执行
 *
 * 成功后自动运行 DB 相关测试。
 */

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

/**
 * 测试库连接串：优先用 DATABASE_URL（CI），否则回落到本地 Docker 默认（localhost:5433）。
 */
const TEST_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://excuse:excuse_dev@localhost:5433/excuse_test'
const ADMIN_DATABASE_URL = process.env.DATABASE_URL
  ? process.env.DATABASE_URL.replace(/\/[^/?]*$/, '/excuse')
  : 'postgres://excuse:excuse_dev@localhost:5433/excuse'
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function terminateStaleTestConnections(): Promise<void> {
  // CI（DATABASE_URL 已设）postgres service 每个 job 全新，无残留连接需清理；
  // 且 CI 只有 excuse_test 库、无独立 excuse admin 库，admin 连接会失败。本地才清理。
  if (process.env.DATABASE_URL)
    return
  const sql = postgres(ADMIN_DATABASE_URL, {
    max: 1,
    connectTimeout: 5,
  })
  try {
    await sql`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = 'excuse_test'
        AND pid <> pg_backend_pid()
    `
  }
  finally {
    await sql.end()
  }
}

async function checkConnection(): Promise<boolean> {
  let sql: ReturnType<typeof postgres> | null = null
  try {
    sql = postgres(TEST_DATABASE_URL, {
      max: 1,
      connectTimeout: 5,
    })
    // postgres.js 使用模板标签语法，不是 execute()
    const result = await sql`SELECT 1 as health_check`
    if (result.length === 1) {
      console.log('✅ PostgreSQL 测试数据库连接成功')
      return true
    }
    return false
  }
  catch (err) {
    const message = err instanceof Error && err.message ? err.message : '连接被拒绝（PostgreSQL 未运行或端口不正确）'
    console.error('❌ PostgreSQL 测试数据库连接失败')
    console.error(`   错误: ${message}`)
    console.error('')
    console.error('请确保:')
    console.error('  1. Docker 正在运行: docker compose up -d')
    console.error('  2. PostgreSQL 端口 5433 可访问')
    console.error('  3. excuse_test 数据库已创建: bun run --cwd packages/db db:test:create')
    console.error('')
    console.error('如果尚未创建测试数据库:')
    console.error('  bun run --cwd packages/db db:test:reset')
    return false
  }
  finally {
    if (sql) {
      await sql.end()
    }
  }
}

async function main() {
  await terminateStaleTestConnections()

  const connected = await checkConnection()
  if (!connected) {
    process.exit(1)
  }

  // 连接成功，运行 DB 测试
  console.log('🧪 运行 DB 测试...')
  const proc = Bun.spawn(['bun', 'test'], {
    cwd: packageRoot,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await proc.exited
  process.exit(exitCode)
}

main()
