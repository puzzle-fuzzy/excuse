/**
 * 自动发现 workspace packages 并串行运行各自 `test` 脚本。
 *
 * Bun workspaces 不原生支持 `bun run --filter '*' test` 之类的并行聚合命令，
 * 故此脚本遍历 packages/*，发现含 test 脚本的包后逐一执行。
 *
 * 排除：packages 含 `test` 但需外部服务（如 PG）的包，默认跳过。
 * 可通过环境变量 RUN_DB_TESTS=1 启用 DB 测试。
 */

import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** 默认跳过的包（需外部服务） */
const DEFAULT_SKIP = new Set(
  process.env.RUN_DB_TESTS !== '1' ? ['db'] : [],
)

interface PackageResult {
  name: string
  status: 'pass' | 'fail' | 'skip'
  output: string
  durationMs: number
}

async function runPackageTests(): Promise<PackageResult[]> {
  const packagesDir = join(import.meta.dirname!, '..', 'packages')
  const entries = readdirSync(packagesDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort()

  const results: PackageResult[] = []

  for (const name of entries) {
    if (DEFAULT_SKIP.has(name)) {
      results.push({ name, status: 'skip', output: '(skipped — requires external service)', durationMs: 0 })
      continue
    }

    const pkgJsonPath = join(packagesDir, name, 'package.json')
    if (!existsSync(pkgJsonPath))
      continue

    const pkgJson = JSON.parse(await Bun.file(pkgJsonPath).text()) as { scripts?: Record<string, string> }
    if (!pkgJson.scripts?.test)
      continue

    const start = performance.now()
    const proc = Bun.spawn(['bun', 'run', 'test'], {
      cwd: join(packagesDir, name),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const output = await new Response(proc.stdout).text()
    const exitCode = await proc.exited

    results.push({
      name,
      status: exitCode === 0 ? 'pass' : 'fail',
      output: output.trim().split('\n').filter(Boolean).pop() ?? '',
      durationMs: Math.round(performance.now() - start),
    })
  }

  return results
}

if (import.meta.main) {
  const results = await runPackageTests()

  let failed = 0
  for (const r of results) {
    const icon = r.status === 'pass' ? '✅' : r.status === 'skip' ? '⏭️' : '❌'
    console.log(`${icon} ${r.name.padEnd(20)} ${r.output} (${r.durationMs}ms)`)
    if (r.status === 'fail')
      failed++
  }

  if (failed > 0) {
    console.error(`\n${failed} package(s) failed`)
    process.exit(1)
  }
}
