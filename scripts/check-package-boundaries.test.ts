import type { BoundaryRule } from './check-package-boundaries'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { checkPackageBoundaries } from './check-package-boundaries'

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
