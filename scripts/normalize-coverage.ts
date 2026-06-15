/**
 * 规范化 coverage/lcov.info 的路径分隔符
 *
 * 问题：Windows 下 Bun 生成的 lcov.info 用反斜杠路径
 *   SF:apps\server\src\modules\generation\output-parser.ts
 * 而 VSCode / Coverage Gutters 内部统一用正斜杠，导致覆盖率无法匹配当前打开的文件。
 *
 * 解决：把所有 SF: 行的反斜杠统一转为正斜杠，让 Coverage Gutters 能正确匹配。
 *
 * 用法：bun scripts/normalize-coverage.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const lcovPath = resolve(import.meta.dir, '..', 'coverage', 'lcov.info')

let content: string
try {
  content = readFileSync(lcovPath, 'utf8')
}
catch {
  console.warn('[normalize-coverage] coverage/lcov.info 不存在，跳过（请先运行 bun test）')
  process.exit(0)
}

let changed = 0
const normalized = content.replace(/^SF:(.+)$/gm, (_match, p1: string) => {
  changed++
  return `SF:${p1.replace(/\\/g, '/')}`
})

if (changed > 0) {
  writeFileSync(lcovPath, normalized)
  console.log(`[normalize-coverage] 已规范 ${changed} 条 SF 路径（\\ → /）`)
}
else {
  console.log('[normalize-coverage] 路径已是正斜杠，无需处理')
}
