import fs from 'node:fs'
import path from 'node:path'

const dirs = ['apps/server/test', 'apps/worker/test', 'apps/web-business/test', 'packages']
const exts = ['.test.ts', '.test.tsx']
const results = []

function scan(d) {
  if (!fs.existsSync(d)) {
    return
  }
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory() && !e.name.includes('node_modules') && !e.name.includes('dist')) {
      scan(p)
    }
    else if (exts.some(x => e.name.endsWith(x))) {
      const c = fs.readFileSync(p, 'utf8')
      const m = [...c.matchAll(/\b(?:it|test)\(\s*['"`]([A-Za-z][^'"`\n]*)['"`]/g)]
      if (m.length > 0) {
        results.push({ f: p, n: m.length })
      }
    }
  }
}

dirs.forEach(scan)
results.sort((a, b) => b.n - a.n)
results.forEach(r => console.log(`${r.n}\t${r.f}`))
console.log('---')
console.log(`Total: ${results.length} files, ${results.reduce((s, r) => s + r.n, 0)} EN`)
