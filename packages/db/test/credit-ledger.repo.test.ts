import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { eq, inArray, like } from 'drizzle-orm'
import { getDb } from '../src/db'
import { creditBalance, CreditError, debitCredit, getCreditAccount, getOrCreateCreditAccount, refundCredit, reserveCredit } from '../src/repositories/credit.repo'
import { createGenerationRecord } from '../src/repositories/generation-records.repo'
import { accounts, creditAccounts, creditTransactions, generationRecords, usageEvents } from '../src/schema'
import { teardownTestDb, useMigratedTestDb } from './helpers/test-db'

const TEST_EMAIL_PREFIX = 'credit-ledger-'

async function cleanup() {
  const testAccounts = await getDb()
    .select({ id: accounts.id })
    .from(accounts)
    .where(like(accounts.email, `${TEST_EMAIL_PREFIX}%`))

  const accountIds = testAccounts.map(account => account.id)
  if (accountIds.length === 0)
    return

  await getDb().delete(usageEvents).where(inArray(usageEvents.accountId, accountIds))
  await getDb().delete(creditTransactions).where(inArray(creditTransactions.accountId, accountIds))
  await getDb().delete(creditAccounts).where(inArray(creditAccounts.accountId, accountIds))
  await getDb().delete(generationRecords).where(inArray(generationRecords.accountId, accountIds))
  await getDb().delete(accounts).where(inArray(accounts.id, accountIds))
}

async function createLedgerSubject(initialBalanceCents = 1000) {
  const suffix = crypto.randomUUID().slice(0, 8)
  const [account] = await getDb()
    .insert(accounts)
    .values({
      username: `${TEST_EMAIL_PREFIX}${suffix}`,
      email: `${TEST_EMAIL_PREFIX}${suffix}@example.com`,
      password: 'hashed_password',
    })
    .returning()

  const accountId = account!.id
  await getOrCreateCreditAccount(accountId)
  await creditBalance({ accountId, amountCents: initialBalanceCents, description: '测试充值' })
  const record = await createGenerationRecord({
    accountId,
    model: 'qwen-plus',
    category: 'text',
    status: 'pending',
    inputParams: { prompt: 'billing lifecycle test' },
    cost: {
      unit: 'token',
      totalPriceCents: 300,
      totalPrice: 3,
      estimated: true,
      billable: false,
      source: 'estimated',
    },
  })

  return { accountId, recordId: record.id }
}

async function listGenerationCreditTransactions(generationRecordId: string) {
  return getDb()
    .select()
    .from(creditTransactions)
    .where(eq(creditTransactions.generationRecordId, generationRecordId))
}

describe('credit ledger repository', () => {
  beforeAll(async () => {
    await useMigratedTestDb()
  })

  afterAll(async () => {
    await cleanup()
    await teardownTestDb()
  })

  afterEach(async () => {
    await cleanup()
  })

  it('重复 reserve 同一生成记录不会重复冻结余额', async () => {
    const { accountId, recordId } = await createLedgerSubject()

    const first = await reserveCredit({ accountId, generationRecordId: recordId, amountCents: 300 })
    const second = await reserveCredit({ accountId, generationRecordId: recordId, amountCents: 300 })

    expect(second.id).toBe(first.id)
    const account = await getCreditAccount(accountId)
    expect(account!.availableCents).toBe(700)
    expect(account!.frozenCents).toBe(300)

    const txs = await listGenerationCreditTransactions(recordId)
    expect(txs.filter(tx => tx.type === 'reserve')).toHaveLength(1)
  })

  it('debit 后禁止 refund，且余额不会再次变化', async () => {
    const { accountId, recordId } = await createLedgerSubject()
    await reserveCredit({ accountId, generationRecordId: recordId, amountCents: 300 })
    await debitCredit({ accountId, generationRecordId: recordId, actualCents: 200 })

    const beforeRefund = await getCreditAccount(accountId)
    expect(beforeRefund!.availableCents).toBe(800)
    expect(beforeRefund!.frozenCents).toBe(0)

    await expect(refundCredit({ accountId, generationRecordId: recordId })).rejects.toBeInstanceOf(CreditError)
    await expect(refundCredit({ accountId, generationRecordId: recordId })).rejects.toMatchObject({ code: 'ALREADY_SETTLED' })

    const afterRefund = await getCreditAccount(accountId)
    expect(afterRefund!.availableCents).toBe(beforeRefund!.availableCents)
    expect(afterRefund!.frozenCents).toBe(beforeRefund!.frozenCents)

    const txs = await listGenerationCreditTransactions(recordId)
    expect(txs.filter(tx => tx.type === 'debit')).toHaveLength(1)
    expect(txs.filter(tx => tx.type === 'refund')).toHaveLength(0)
  })

  it('refund 后禁止 debit，且余额不会再次变化', async () => {
    const { accountId, recordId } = await createLedgerSubject()
    await reserveCredit({ accountId, generationRecordId: recordId, amountCents: 300 })
    await refundCredit({ accountId, generationRecordId: recordId })

    const beforeDebit = await getCreditAccount(accountId)
    expect(beforeDebit!.availableCents).toBe(1000)
    expect(beforeDebit!.frozenCents).toBe(0)

    await expect(debitCredit({ accountId, generationRecordId: recordId, actualCents: 200 })).rejects.toMatchObject({ code: 'ALREADY_SETTLED' })

    const afterDebit = await getCreditAccount(accountId)
    expect(afterDebit!.availableCents).toBe(beforeDebit!.availableCents)
    expect(afterDebit!.frozenCents).toBe(beforeDebit!.frozenCents)

    const txs = await listGenerationCreditTransactions(recordId)
    expect(txs.filter(tx => tx.type === 'refund')).toHaveLength(1)
    expect(txs.filter(tx => tx.type === 'debit')).toHaveLength(0)
  })
})
