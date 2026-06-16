import { describe, expect, it } from 'bun:test'
import { serialize } from '../src/types'

describe('serialize', () => {
  it('converts a top-level Date to an ISO string', () => {
    const out = serialize({ id: '1', createdAt: new Date('2026-06-16T00:00:00.000Z') })
    expect(out).toEqual({ id: '1', createdAt: '2026-06-16T00:00:00.000Z' })
  })

  it('converts nullable Date | null while keeping null', () => {
    const out = serialize({
      a: new Date('2026-01-01T00:00:00.000Z'),
      b: null,
    })
    expect(out).toEqual({ a: '2026-01-01T00:00:00.000Z', b: null })
  })

  it('recurses into arrays and nested objects', () => {
    const out = serialize({
      items: [{ at: new Date('2026-01-01T00:00:00.000Z') }],
      meta: { updated: new Date('2026-02-02T00:00:00.000Z') },
    })
    expect(out).toEqual({
      items: [{ at: '2026-01-01T00:00:00.000Z' }],
      meta: { updated: '2026-02-02T00:00:00.000Z' },
    })
  })

  it('preserves non-Date JSONB content structurally unchanged', () => {
    const out = serialize({ meta: { count: 3, name: 'x', nested: { ok: true } } })
    expect(out).toEqual({ meta: { count: 3, name: 'x', nested: { ok: true } } })
  })

  it('passes primitives and null through unchanged', () => {
    expect(serialize(42)).toBe(42)
    expect(serialize('hi')).toBe('hi')
    expect(serialize(true)).toBe(true)
    expect(serialize(null)).toBeNull()
  })

  it('converts a bare Date argument to an ISO string', () => {
    expect(serialize(new Date('2026-03-03T00:00:00.000Z'))).toBe('2026-03-03T00:00:00.000Z')
  })

  it('handles arrays of dates', () => {
    const out = serialize([new Date('2026-01-01T00:00:00.000Z'), null])
    expect(out).toEqual(['2026-01-01T00:00:00.000Z', null])
  })
})
