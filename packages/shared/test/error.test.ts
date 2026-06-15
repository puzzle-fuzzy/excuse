import { describe, expect, it } from 'bun:test'
import { getErrorMessage, getPgErrorCode, isPgTableNotFoundError } from '../src/error'

// ===== getErrorMessage =====

describe('getErrorMessage', () => {
  it('Error 实例提取 message', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom')
  })

  it('字符串直接返回', () => {
    expect(getErrorMessage('some error')).toBe('some error')
  })

  it('数字转字符串', () => {
    expect(getErrorMessage(42)).toBe('42')
  })

  it('null 转字符串', () => {
    expect(getErrorMessage(null)).toBe('null')
  })

  it('undefined 转字符串', () => {
    expect(getErrorMessage(undefined)).toBe('undefined')
  })

  it('对象转字符串', () => {
    expect(getErrorMessage({ code: 500 })).toBe('[object Object]')
  })
})

// ===== isPgTableNotFoundError =====

describe('isPgTableNotFoundError', () => {
  it('非 Error 返回 false', () => {
    expect(isPgTableNotFoundError('string')).toBe(false)
    expect(isPgTableNotFoundError(null)).toBe(false)
    expect(isPgTableNotFoundError(42)).toBe(false)
  })

  it('DrizzleQueryError: cause.code=42P01 返回 true', () => {
    const err = new Error('query failed')
    ;(err as any).cause = { code: '42P01' }
    expect(isPgTableNotFoundError(err)).toBe(true)
  })

  it('PostgresError: code=42P01 返回 true', () => {
    const err = new Error('relation not found')
    ;(err as any).code = '42P01'
    expect(isPgTableNotFoundError(err)).toBe(true)
  })

  it('message 包含 "does not exist" 返回 true', () => {
    const err = new Error('relation "users" does not exist')
    expect(isPgTableNotFoundError(err)).toBe(true)
  })

  it('其他 PG 错误码返回 false', () => {
    const err = new Error('constraint violation')
    ;(err as any).cause = { code: '23505' }
    expect(isPgTableNotFoundError(err)).toBe(false)
  })

  it('无关错误返回 false', () => {
    expect(isPgTableNotFoundError(new Error('network timeout'))).toBe(false)
  })
})

// ===== getPgErrorCode =====

describe('getPgErrorCode', () => {
  it('非 Error 返回 undefined', () => {
    expect(getPgErrorCode('string')).toBeUndefined()
    expect(getPgErrorCode(null)).toBeUndefined()
  })

  it('从 cause.code 提取（DrizzleQueryError）', () => {
    const err = new Error('query failed')
    ;(err as any).cause = { code: '23505' }
    expect(getPgErrorCode(err)).toBe('23505')
  })

  it('从 err.code 提取（PostgresError）', () => {
    const err = new Error('pg error')
    ;(err as any).code = '42P01'
    expect(getPgErrorCode(err)).toBe('42P01')
  })

  it('cause.code 优先于 err.code', () => {
    const err = new Error('both')
    ;(err as any).cause = { code: '23505' }
    ;(err as any).code = '42P01'
    expect(getPgErrorCode(err)).toBe('23505')
  })

  it('无 code 时返回 undefined', () => {
    expect(getPgErrorCode(new Error('plain error'))).toBeUndefined()
  })
})
