import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import {
  createAccount,
  getAccountByEmail,
  getAccountById,
  getAccountByUsername,
} from '../src/repositories/accounts.repo'
import {
  beginTestTransaction,
  expectDbConstraintError,
  initTestDb,
  rollbackTestTransaction,
  teardownTestDb,
} from './helpers/test-db'

describe('accounts repository', () => {
  let accountId: string

  beforeAll(async () => {
    await initTestDb()
  })

  afterAll(async () => {
    await teardownTestDb()
  })

  beforeEach(async () => {
    const ctx = await beginTestTransaction()
    accountId = ctx.accountId
  })

  afterEach(async () => {
    await rollbackTestTransaction()
  })

  // ─── createAccount ─────────────────────────────────

  describe('createAccount', () => {
    it('插入并返回包含所有字段的账户', async () => {
      const result = await createAccount({
        username: 'newuser',
        email: 'new@example.com',
        password: 'hashed_pw_123',
        isActive: true,
      })

      expect(result.id).toBeDefined()
      expect(typeof result.id).toBe('string')
      expect(result.username).toBe('newuser')
      expect(result.email).toBe('new@example.com')
      expect(result.password).toBe('hashed_pw_123')
      expect(result.isActive).toBe(true)
      expect(result.createdAt).toBeInstanceOf(Date)
      expect(result.updatedAt).toBeInstanceOf(Date)
    })

    it('isActive 默认为 true', async () => {
      const result = await createAccount({
        username: 'defaultactive',
        email: 'default@example.com',
        password: 'hashed',
      })

      expect(result.isActive).toBe(true)
    })

    it('创建带 avatar 的账户', async () => {
      const result = await createAccount({
        username: 'avataruser',
        email: 'avatar@example.com',
        password: 'hashed',
        avatar: 'https://example.com/avatar.png',
      })

      expect(result.avatar).toBe('https://example.com/avatar.png')
    })
  })

  // ─── getAccountByEmail ─────────────────────────────

  describe('getAccountByEmail', () => {
    it('找到时返回账户', async () => {
      const created = await createAccount({
        username: 'emailuser',
        email: 'find@example.com',
        password: 'hashed',
      })

      const found = await getAccountByEmail('find@example.com')

      expect(found).not.toBeNull()
      expect(found!.id).toBe(created.id)
      expect(found!.email).toBe('find@example.com')
      expect(found!.username).toBe('emailuser')
    })

    it('邮箱不存在时返回 null', async () => {
      const result = await getAccountByEmail('nonexistent@example.com')
      expect(result).toBeNull()
    })

    it('邮箱查找区分大小写', async () => {
      await createAccount({
        username: 'casesensitive',
        email: 'Case@Example.com',
        password: 'hashed',
      })

      const lower = await getAccountByEmail('case@example.com')
      expect(lower).toBeNull()

      const exact = await getAccountByEmail('Case@Example.com')
      expect(exact).not.toBeNull()
      expect(exact!.email).toBe('Case@Example.com')
    })
  })

  // ─── getAccountByUsername ──────────────────────────

  describe('getAccountByUsername', () => {
    it('找到时返回账户', async () => {
      const created = await createAccount({
        username: 'findme',
        email: 'findme@example.com',
        password: 'hashed',
      })

      const found = await getAccountByUsername('findme')

      expect(found).not.toBeNull()
      expect(found!.id).toBe(created.id)
      expect(found!.username).toBe('findme')
    })

    it('用户名不存在时返回 null', async () => {
      const result = await getAccountByUsername('nonexistent_user')
      expect(result).toBeNull()
    })
  })

  // ─── getAccountById ────────────────────────────────

  describe('getAccountById', () => {
    it('找到时返回账户', async () => {
      const found = await getAccountById(accountId)

      expect(found).not.toBeNull()
      expect(found!.id).toBe(accountId)
    })

    it('ID 不存在时返回 null', async () => {
      const result = await getAccountById('00000000-0000-0000-0000-000000000000')
      expect(result).toBeNull()
    })
  })

  // ─── 约束验证 ─────────────────────────────────────

  describe('constraints', () => {
    it('拒绝重复邮箱（唯一约束）', async () => {
      await createAccount({
        username: 'user1',
        email: 'dup@example.com',
        password: 'hashed',
      })

      const error = await expectDbConstraintError(() =>
        createAccount({
          username: 'user2',
          email: 'dup@example.com',
          password: 'hashed',
        }),
      )
      expect(error).toBeInstanceOf(Error)
    })

    it('拒绝重复用户名（唯一约束）', async () => {
      await createAccount({
        username: 'dupuser',
        email: 'a@example.com',
        password: 'hashed',
      })

      const error = await expectDbConstraintError(() =>
        createAccount({
          username: 'dupuser',
          email: 'b@example.com',
          password: 'hashed',
        }),
      )
      expect(error).toBeInstanceOf(Error)
    })
  })
})
