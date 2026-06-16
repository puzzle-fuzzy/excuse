import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

export interface BoundaryRule {
  roots: string[]
  forbidden: RegExp
  message: string
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx'])

export const DEFAULT_BOUNDARY_RULES: BoundaryRule[] = [
  {
    roots: ['packages/shared/src', 'packages/shared/test'],
    forbidden: /from\s+['"]@excuse\/(?:db|provider|storage|ffmpeg|billing|canvas-runtime)['"]|import\s*\(\s*['"]@excuse\/(?:db|provider|storage|ffmpeg|billing|canvas-runtime)['"]|from\s+['"][^'"]*apps\//,
    message: '@excuse/shared must stay a base layer and cannot import runtime packages or apps',
  },
  {
    roots: [
      'packages/task-engine/src',
      'packages/task-engine/test',
      'packages/workflow-engine/src',
      'packages/workflow-engine/test',
      'packages/events/src',
      'packages/events/test',
      'packages/gateway/src',
      'packages/gateway/test',
      'packages/metrics/src',
      'packages/metrics/test',
      'packages/rate-limit/src',
      'packages/rate-limit/test',
      'packages/provider-health/src',
      'packages/provider-health/test',
      'packages/subtitle-engine/src',
      'packages/subtitle-engine/test',
      'packages/auth/src',
      'packages/auth/test',
    ],
    forbidden: /from\s+['"]@excuse\/(?:db|provider|storage|ffmpeg|billing|canvas-runtime)['"]|import\s*\(\s*['"]@excuse\/(?:db|provider|storage|ffmpeg|billing|canvas-runtime)['"]|from\s+['"][^'"]*apps\//,
    message: 'pure packages cannot import DB/provider/runtime packages or apps',
  },
]

function walk(dir: string): string[] {
  let entries: string[] = []
  let children: string[]
  try {
    children = readdirSync(dir)
  }
  catch {
    return entries
  }

  for (const child of children) {
    const path = join(dir, child)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      entries = entries.concat(walk(path))
      continue
    }

    const dot = child.lastIndexOf('.')
    const ext = dot >= 0 ? child.slice(dot) : ''
    if (SOURCE_EXTENSIONS.has(ext))
      entries.push(path)
  }
  return entries
}

export function checkPackageBoundaries(
  rules: BoundaryRule[] = DEFAULT_BOUNDARY_RULES,
  cwd = process.cwd(),
): string[] {
  const violations: string[] = []

  for (const rule of rules) {
    for (const root of rule.roots) {
      for (const file of walk(join(cwd, root))) {
        const source = readFileSync(file, 'utf8')
        if (!rule.forbidden.test(source))
          continue

        violations.push(`${relative(cwd, file)}: ${rule.message}`)
      }
    }
  }

  return violations
}

if (import.meta.main) {
  const violations = checkPackageBoundaries()

  if (violations.length > 0) {
    console.error('Package boundary violations:')
    for (const violation of violations)
      console.error(`- ${violation}`)
    process.exit(1)
  }

  console.log('Package boundary checks passed')
}
