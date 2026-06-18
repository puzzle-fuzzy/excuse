import type { BoundaryRule } from './check-package-boundaries'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { checkPackageBoundaries, DEFAULT_BOUNDARY_RULES } from './check-package-boundaries'

describe('checkPackageBoundaries', () => {
  let cwd: string

  const rules: BoundaryRule[] = [
    {
      roots: ['packages/shared/src'],
      forbidden: /from\s+['"]@excuse\/db['"]/,
      message: 'shared cannot import db',
    },
  ]

  beforeEach(() => {
    cwd = join(tmpdir(), `excuse-boundary-${crypto.randomUUID()}`)
    mkdirSync(join(cwd, 'packages/shared/src'), { recursive: true })
  })

  afterEach(() => {
    rmSync(cwd, { force: true, recursive: true })
  })

  it('reports forbidden imports with a relative path', () => {
    writeFileSync(
      join(cwd, 'packages/shared/src/auth.ts'),
      'import type { Account } from \'@excuse/db\'\n',
    )

    expect(checkPackageBoundaries(rules, cwd)).toEqual([
      'packages/shared/src/auth.ts: shared cannot import db',
    ])
  })

  it('passes when imports stay within the allowed boundary', () => {
    writeFileSync(
      join(cwd, 'packages/shared/src/auth.ts'),
      'import type { AuthUser } from \'./domain-types\'\n',
    )

    expect(checkPackageBoundaries(rules, cwd)).toEqual([])
  })
})

// ── DEFAULT_BOUNDARY_RULES 覆盖（TODO2 §六：补强 error-recovery / canvas-engine / prompt-engine）──

describe('DEFAULT_BOUNDARY_RULES — 新增纯/domain 包规则', () => {
  let cwd: string

  beforeEach(() => {
    cwd = join(tmpdir(), `excuse-boundary-default-${crypto.randomUUID()}`)
  })

  afterEach(() => {
    rmSync(cwd, { force: true, recursive: true })
  })

  it('error-recovery 导入 @excuse/db 被纯包规则拦下', () => {
    mkdirSync(join(cwd, 'packages/error-recovery/src'), { recursive: true })
    writeFileSync(
      join(cwd, 'packages/error-recovery/src/index.ts'),
      'import { x } from \'@excuse/db\'\n',
    )

    const violations = checkPackageBoundaries(DEFAULT_BOUNDARY_RULES, cwd)
    expect(violations.some(v => v.includes('error-recovery/src/index.ts'))).toBe(true)
  })

  it('canvas-engine 导入 @excuse/provider 被 domain 规则拦下', () => {
    mkdirSync(join(cwd, 'packages/canvas-engine/src'), { recursive: true })
    writeFileSync(
      join(cwd, 'packages/canvas-engine/src/index.ts'),
      'import { DashScopeClient } from \'@excuse/provider\'\n',
    )

    const violations = checkPackageBoundaries(DEFAULT_BOUNDARY_RULES, cwd)
    expect(violations.some(v => v.includes('canvas-engine/src/index.ts'))).toBe(true)
  })

  it('prompt-engine 导入 @excuse/ffmpeg 被 domain 规则拦下', () => {
    mkdirSync(join(cwd, 'packages/prompt-engine/src'), { recursive: true })
    writeFileSync(
      join(cwd, 'packages/prompt-engine/src/index.ts'),
      'import { burnSubtitle } from \'@excuse/ffmpeg\'\n',
    )

    const violations = checkPackageBoundaries(DEFAULT_BOUNDARY_RULES, cwd)
    expect(violations.some(v => v.includes('prompt-engine/src/index.ts'))).toBe(true)
  })
})
