import { describe, expect, it } from 'vitest'
import { cn } from '../src/lib/utils'

describe('cn', () => {
  it('合并多个类名', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('过滤 falsy 值', () => {
    expect(cn('foo', false && 'bar', undefined, null, 'baz')).toBe('foo baz')
  })

  it('合并冲突的 Tailwind 类', () => {
    // tailwind-merge 应该解决冲突
    expect(cn('px-2', 'px-4')).toBe('px-4')
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500')
  })

  it('处理空输入', () => {
    expect(cn()).toBe('')
    expect(cn('')).toBe('')
  })

  it('处理对象类名', () => {
    expect(cn({ active: true, disabled: false })).toBe('active')
  })

  it('处理数组类名', () => {
    expect(cn(['foo', 'bar'])).toBe('foo bar')
  })
})
